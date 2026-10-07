/**
 * cancel.service.ts —— 订单取消/响应取消/现场拒收（F35）
 *
 * @module PIM-BC-04 交易订单
 * @model PIM-AG-06 交易订单聚合（CancelRequest 值对象，24h 响应窗口）
 * @statemachine PIM-SM-01 订单状态机·取消请求子状态：
 *   取消请求中不立主枚举，以 cancel_* 字段组承载（PSM-03-1）；
 *   主状态不变（pending_delivery/pending_confirm），子状态 none→requested→agreed/rejected；
 *   agreed → 主态迁移 cancelled（终态）；rejected → 清字段组回原态并留痕。
 * @rule CIM-R-15 取消仅限未确认收货、24h 超时默认同意、拒绝回原态留痕
 * @rule CIM-R-16 退款原路退回、平台不经手资金（§6 对策 B 留痕口径）
 * @rule CIM-R-17 取消成功商品自动恢复上架
 * @rule CIM-R-18 已确认收货（completed）不可取消，售后异议引导 F30 申诉
 * @rule CIM-R-19 拒收必须现场发起并留痕（时间+说明）
 * @event PIM-EV-05 订单已取消（副作用：product 回 on_sale）
 * @api §5.2 #33 POST /orders/{id}/cancel、#34 POST /orders/{id}/cancel/respond、#35 POST /orders/{id}/reject-onsite
 * @ac F35-AC1/F35-AC2/F35-AC4
 */
import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@contract/index';
import { OrderRepository } from './order.repository';
import { BusinessError, BuyerContext } from './order.service';
import type {
  CancelRespondResult,
  CancelResult,
  RejectOnsiteInput,
  RejectOnsiteResult,
  RespondCancelInput,
} from './dto/cancel.dto';
import type { OrderStatusValue } from './dto/order.dto';

/** @rule CIM-R-15：取消响应时限 24h（自发起时刻起算，买卖双方同一规则） */
const CANCEL_WINDOW_24H_MS = 24 * 3600 * 1000;

/** 取消/拒收文本上限（trade_order.cancel_reason / cancel_reject_note VARCHAR(255)） */
const CANCEL_TEXT_MAX = 255;

/** 可发起取消的主状态（@rule CIM-R-18：未确认收货前） */
const CANCELLABLE_STATUSES: OrderStatusValue[] = ['pending_delivery', 'pending_confirm'];

type OrderRow = NonNullable<Awaited<ReturnType<OrderRepository['findOrderById']>>>;

/** 参与者角色判定：买卖双方 → buyer/seller；其余 → 1003 */
const requireParticipant = (order: OrderRow, actor: BuyerContext): 'buyer' | 'seller' => {
  if (order.buyer_id === actor.id) return 'buyer';
  if (order.seller_id === actor.id) return 'seller';
  throw new BusinessError(ERROR_CODES.PERMISSION_DENIED, '仅订单买卖双方可执行该操作');
};

/** 可选文本（≤255 字），缺省/空串归一为 null；类型非法 → 9001 */
const optionalText = (value: unknown, field: string): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > CANCEL_TEXT_MAX) {
    throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, `${field} 非法`);
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

/** #33 请求体校验：reason 可选 */
const validateCancelBody = (body: unknown): { reason: string | null } => {
  const input = (body ?? {}) as Record<string, unknown>;
  return { reason: optionalText(input.reason, 'reason') };
};

/** #34 请求体校验：action ∈ agree/reject 必填，note 可选 */
const validateRespondBody = (body: unknown): RespondCancelInput => {
  const input = (body ?? {}) as Record<string, unknown>;
  if (input.action !== 'agree' && input.action !== 'reject') {
    throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, 'action 仅支持 agree/reject');
  }
  return { action: input.action, note: optionalText(input.note, 'note') };
};

/** #35 请求体校验（@rule CIM-R-19 / @ac F35-AC4：reject_time+reason 必填，缺/非法 → 4005） */
const validateRejectOnsiteBody = (body: unknown): RejectOnsiteInput => {
  const input = (body ?? {}) as Record<string, unknown>;
  const rejectTime = typeof input.reject_time === 'string' ? new Date(input.reject_time) : null;
  if (!rejectTime || Number.isNaN(rejectTime.getTime())) {
    throw new BusinessError(ERROR_CODES.REJECT_ONSITE_INFO_MISSING, '现场拒收须填写拒收时间');
  }
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (reason === '' || reason.length > CANCEL_TEXT_MAX) {
    throw new BusinessError(ERROR_CODES.REJECT_ONSITE_INFO_MISSING, '现场拒收须填写拒收说明');
  }
  return { rejectTime, reason };
};

@Injectable()
export class CancelService {
  constructor(private readonly repo: OrderRepository) {}

  /**
   * @api §5.2 #33 发起取消（@statemachine PIM-SM-01 取消子状态 none → requested）
   * @rule CIM-R-15：买卖双方均可发起，仅未确认收货状态；cancel_deadline=now+24h；
   *       主状态不变，取消子状态以字段组承载。
   * @rule CIM-R-18 / @ac F35-AC2：已 completed 拦截并引导 F30 申诉。
   */
  async requestCancel(orderId: bigint, actor: BuyerContext, body: unknown): Promise<CancelResult> {
    const { reason } = validateCancelBody(body);

    const order = await this.repo.findOrderById(orderId);
    if (!order) {
      throw new BusinessError(ERROR_CODES.ORDER_NOT_FOUND, '订单不存在');
    }
    const role = requireParticipant(order, actor);
    if (order.status === 'completed') {
      // @rule CIM-R-18：已确认收货不可取消；售后异议引导至 F30 申诉通道（POST /appeals）
      throw new BusinessError(
        ERROR_CODES.ORDER_STATUS_CONFLICT,
        '订单已完成，不可取消；如有售后异议请通过申诉通道（F30）反馈',
      );
    }
    if (!CANCELLABLE_STATUSES.includes(order.status as OrderStatusValue)) {
      throw new BusinessError(ERROR_CODES.ORDER_STATUS_CONFLICT, '当前订单状态不允许发起取消');
    }
    if (order.cancel_initiator_id !== null) {
      throw new BusinessError(ERROR_CODES.ORDER_STATUS_CONFLICT, '已有待响应的取消申请，请勿重复发起');
    }

    const now = new Date();
    const deadline = new Date(now.getTime() + CANCEL_WINDOW_24H_MS);
    const ok = await this.repo.requestCancel({
      orderId: order.id,
      initiatorId: actor.id,
      initiatorRole: role,
      fromStatus: order.status as OrderStatusValue,
      reason,
      requestedAt: now,
      deadline,
    });
    if (!ok) {
      // 并发竞争：他人抢先发起或状态已迁移，事务回滚
      throw new BusinessError(ERROR_CODES.ORDER_STATUS_CONFLICT, '当前订单状态不允许发起取消');
    }
    return { status: 'cancel_pending', respond_deadline: deadline.toISOString() };
  }

  /**
   * @api §5.2 #34 响应取消（取消子状态 requested → agreed/rejected）
   * 守卫：仅对方可响应（发起者本人 1003）；须在 cancel_deadline 内（超时 4004，
   * 超时默认同意由 jobs cron 扫描 idx_cancel_deadline 执行）。
   * agree → @rule CIM-R-16 退款留痕口径 + @rule CIM-R-17 商品恢复上架（@event PIM-EV-05）；
   * reject → 清字段组回原态 + order_event 留痕（裁决 3）。
   */
  async respondCancel(
    orderId: bigint,
    actor: BuyerContext,
    body: unknown,
  ): Promise<CancelRespondResult> {
    const input = validateRespondBody(body);

    const order = await this.repo.findOrderById(orderId);
    if (!order) {
      throw new BusinessError(ERROR_CODES.ORDER_NOT_FOUND, '订单不存在');
    }
    const role = requireParticipant(order, actor);
    if (order.cancel_initiator_id === null || order.cancel_deadline === null) {
      throw new BusinessError(ERROR_CODES.ORDER_STATUS_CONFLICT, '当前订单无待响应的取消申请');
    }
    if (order.cancel_initiator_id === actor.id) {
      throw new BusinessError(ERROR_CODES.PERMISSION_DENIED, '发起者不能响应自己的取消申请');
    }
    if (Date.now() > order.cancel_deadline.getTime()) {
      // 超过 24h 未响应视为默认同意（@rule CIM-R-15），由超时任务执行，不再接受人工响应
      throw new BusinessError(ERROR_CODES.CANCEL_RESPOND_TIMEOUT, '取消响应已超时');
    }

    if (input.action === 'agree') {
      const ok = await this.repo.agreeCancel({
        orderId: order.id,
        productId: order.product_id,
        responderId: actor.id,
        responderRole: role,
        fromStatus: order.status as OrderStatusValue,
        amount: String(order.amount),
        at: new Date(),
      });
      if (!ok) {
        throw new BusinessError(ERROR_CODES.ORDER_STATUS_CONFLICT, '当前订单状态不允许响应取消');
      }
      return { status: 'cancelled' };
    }

    const ok = await this.repo.rejectCancel({
      orderId: order.id,
      responderId: actor.id,
      responderRole: role,
      fromStatus: order.status as OrderStatusValue,
      note: input.note,
    });
    if (!ok) {
      throw new BusinessError(ERROR_CODES.ORDER_STATUS_CONFLICT, '当前订单状态不允许响应取消');
    }
    // 裁决 3：取消被拒绝后订单回到原状态（待交货/待确认），交易继续
    return { status: order.status as OrderStatusValue };
  }

  /**
   * @api §5.2 #35 现场拒收（@rule CIM-R-19 / @ac F35-AC4）
   * 守卫：仅买家、仅 pending_confirm；reject_time+reason 必填（缺 4005）。
   * 留痕后进入取消流程（同 agree 路径：cancelled + 退款口径 + 商品恢复上架）。
   */
  async rejectOnsite(orderId: bigint, actor: BuyerContext, body: unknown): Promise<RejectOnsiteResult> {
    const input = validateRejectOnsiteBody(body);

    const order = await this.repo.findOrderById(orderId);
    if (!order) {
      throw new BusinessError(ERROR_CODES.ORDER_NOT_FOUND, '订单不存在');
    }
    if (order.buyer_id !== actor.id) {
      throw new BusinessError(ERROR_CODES.PERMISSION_DENIED, '仅买家可现场拒收');
    }
    if (order.status !== 'pending_confirm') {
      throw new BusinessError(ERROR_CODES.ORDER_STATUS_CONFLICT, '当前订单状态不允许现场拒收');
    }

    const ok = await this.repo.rejectOnsiteCancel({
      orderId: order.id,
      productId: order.product_id,
      buyerId: actor.id,
      rejectTime: input.rejectTime,
      reason: input.reason,
      amount: String(order.amount),
      at: new Date(),
    });
    if (!ok) {
      // 并发竞争：状态已被迁移（如买家已确认收货），事务回滚
      throw new BusinessError(ERROR_CODES.ORDER_STATUS_CONFLICT, '当前订单状态不允许现场拒收');
    }
    return { status: 'cancelled' };
  }
}
