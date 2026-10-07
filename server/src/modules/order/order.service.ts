/**
 * order.service.ts —— 订单核心服务（创建锁单防超卖 / 详情五态 / 确认收货）
 *
 * @module PIM-BC-04 交易订单
 * @model PIM-AG-06 交易订单聚合
 * @statemachine PIM-SM-01 订单状态机（仅五态 pending_delivery/pending_confirm/completed/cancelled/appealing）
 * @rule CIM-R-10 付款前风险明示守卫 / CIM-R-11 付款锁商品防超卖 / CIM-R-12 48h 超时兜底 / CIM-R-14 意向不强制约束
 * @api §5.2 #30 POST /orders、#31 GET /orders/{id}、#32 POST /orders/{id}/confirm-receive
 * @ac F34-AC1 付款成功锁 trading / F34-AC2 当面自提标记已售完成 / F34-AC3 仅五态流转
 */
import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@contract/index';
import { OrderRepository } from './order.repository';
import { PaymentRecordService } from './payment-record.service';
import { validateCreateOrder } from './order.validator';
import type {
  ConfirmReceiveResult,
  CreateOrderResult,
  OrderDetailResult,
  OrderStatusValue,
} from './dto/order.dto';

/** 业务错误（统一异常过滤器据此映射 code/message 包络） */
export class BusinessError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'BusinessError';
  }
}

/** 认证用户上下文（controller 已将 JWT 载荷 uid 转 BigInt） */
export interface BuyerContext {
  id: bigint;
}

/** @rule CIM-R-12：48h 超时兜底毫秒数 */
const TIMEOUT_48H_MS = 48 * 3600 * 1000;

const ORDER_NO_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** order_no 生成：ES + yyyyMMdd + 6 位随机 [0-9A-Z]（^ES\d{8}[0-9A-Z]{6}$） */
const generateOrderNo = (now: Date): string => {
  const ymd = [
    now.getUTCFullYear().toString().padStart(4, '0'),
    (now.getUTCMonth() + 1).toString().padStart(2, '0'),
    now.getUTCDate().toString().padStart(2, '0'),
  ].join('');
  let rand = '';
  for (let i = 0; i < 6; i += 1) {
    rand += ORDER_NO_CHARS[Math.floor(Math.random() * ORDER_NO_CHARS.length)];
  }
  return `ES${ymd}${rand}`;
};

/** 距截止剩余秒数（无截止或已过点为 0） */
const countdownSec = (deadline: Date | null): number => {
  if (!deadline) return 0;
  return Math.max(0, Math.floor((deadline.getTime() - Date.now()) / 1000));
};

/** 订单行 → #30 创建响应（含幂等命中复用） */
const toCreateResult = (order: {
  id: bigint;
  order_no: string;
  status: string;
  timeout_deadline: Date | null;
}): CreateOrderResult => ({
  order_id: order.id.toString(),
  order_no: order.order_no,
  status: order.status as OrderStatusValue,
  pay_deadline: order.timeout_deadline ? order.timeout_deadline.toISOString() : '',
  countdown_sec: countdownSec(order.timeout_deadline),
});

@Injectable()
export class OrderService {
  constructor(
    private readonly repo: OrderRepository,
    private readonly paymentService: PaymentRecordService,
  ) {}

  /**
   * @api §5.2 #30 创建订单（@statemachine PIM-SM-01 [*] → pending_delivery）
   * 链路口径：validator 校验（9001 前置，@rule CIM-R-10）→ 商品状态守卫
   * （不存在 2001 / off_sale 2002 / trading|sold 4003）→ 幂等（buyer+product
   * 活跃单命中直接返回已有单）→ 事务四步写入（锁单→建单→留痕→支付留痕）。
   */
  async create(
    buyer: BuyerContext,
    body: unknown,
    _idempotencyKey?: string,
  ): Promise<CreateOrderResult> {
    // 9001 聚合式拦截（@rule CIM-R-10：online_pay 缺 risk_confirmed=true 在此拦截）
    const input = validateCreateOrder(body);

    const product = await this.repo.findProductById(input.productId);
    if (!product) {
      throw new BusinessError(ERROR_CODES.PRODUCT_NOT_FOUND, '商品不存在');
    }
    if (product.status === 'off_sale') {
      throw new BusinessError(ERROR_CODES.PRODUCT_OFF_SHELF, '商品已下架');
    }
    if (product.status !== 'on_sale') {
      // trading / sold：@rule CIM-R-11 防超卖前置守卫
      throw new BusinessError(ERROR_CODES.ORDER_LOCK_FAILED, '商品已被锁定或已售');
    }

    // 幂等：Idempotency-Key 去重口径 = buyer+product 活跃单，命中直接返回已有单
    const existing = await this.repo.findActiveOrder(buyer.id, input.productId);
    if (existing) {
      return toCreateResult(existing);
    }

    // @rule CIM-R-12：timeout_deadline =（meet_time ?? now）+ 48h
    const now = new Date();
    const timeoutDeadline = new Date((input.meetTime ?? now).getTime() + TIMEOUT_48H_MS);
    const orderNo = generateOrderNo(now);
    const amount = String(product.price);
    const payment = this.paymentService.buildOfflineScanPayload(amount);

    const order = await this.repo.createOrderWithLock({
      orderNo,
      productId: product.id,
      productTitle: product.title,
      buyerId: buyer.id,
      sellerId: product.seller_id,
      tradeMode: input.tradeMode,
      amount,
      meetTime: input.meetTime,
      timeoutDeadline,
      intentId: input.intentId,
      payment,
    });
    if (!order) {
      // 锁单竞争失败：并发被他人抢先锁定，事务已回滚不落单
      throw new BusinessError(ERROR_CODES.ORDER_LOCK_FAILED, '锁单失败：商品已被他人抢先锁定');
    }
    return toCreateResult(order);
  }

  /**
   * @api §5.2 #31 订单详情（@ac F34-AC3：五态 + countdown_sec 倒计时 + timeline + channel）
   */
  async detail(orderId: bigint): Promise<OrderDetailResult> {
    const order = await this.repo.findOrderById(orderId);
    if (!order) {
      throw new BusinessError(ERROR_CODES.ORDER_NOT_FOUND, '订单不存在');
    }
    const [payment, events] = await Promise.all([
      this.repo.findPaymentRecord(order.id),
      this.repo.findEvents(order.id),
    ]);
    return {
      order_id: order.id.toString(),
      order_no: order.order_no,
      status: order.status as OrderStatusValue,
      channel: payment ? payment.channel : null,
      product: { product_id: order.product_id.toString(), title: order.product_title },
      buyer_id: order.buyer_id.toString(),
      seller_id: order.seller_id.toString(),
      amount: String(order.amount),
      countdown_sec: countdownSec(order.timeout_deadline),
      timeline: events.map((e) => ({
        from_status: (e.from_status as OrderStatusValue | null) ?? null,
        to_status: e.to_status as OrderStatusValue,
        actor: e.actor,
        note: e.note,
        created_at: e.created_at.toISOString(),
      })),
    };
  }

  /**
   * @api §5.2 #32 确认收货（@statemachine PIM-SM-01 pending_confirm → completed，@ac F34-AC2）
   * 守卫：不存在 4001 / 非买家 1003 / 非 pending_confirm 4002（含并发竞争 count=0）。
   */
  async confirmReceive(orderId: bigint, buyer: BuyerContext): Promise<ConfirmReceiveResult> {
    const order = await this.repo.findOrderById(orderId);
    if (!order) {
      throw new BusinessError(ERROR_CODES.ORDER_NOT_FOUND, '订单不存在');
    }
    if (order.buyer_id !== buyer.id) {
      throw new BusinessError(ERROR_CODES.PERMISSION_DENIED, '仅买家可确认收货');
    }
    if (order.status !== 'pending_confirm') {
      throw new BusinessError(ERROR_CODES.ORDER_STATUS_CONFLICT, '当前订单状态不允许确认收货');
    }

    const ok = await this.repo.completeOrder({
      orderId: order.id,
      productId: order.product_id,
      buyerId: buyer.id,
      at: new Date(),
    });
    if (!ok) {
      // 并发竞争：状态已被迁移，事务回滚，商品不会被误标已售
      throw new BusinessError(ERROR_CODES.ORDER_STATUS_CONFLICT, '当前订单状态不允许确认收货');
    }
    // @api §5.2 #32：review_pending 双方评价入口开放（申诉中会冻结，裁决 8）
    return { status: 'completed', review_pending: { buyer: true, seller: true } };
  }
}
