/**
 * appeal.service.ts —— 申诉仲裁业务逻辑（§5.3 #65-67，PRD F30 纠纷申诉 / F31 处罚申诉）
 *
 * @module PIM-BC-05 信任与治理（后台治理子域 admin/governance）
 * @model PIM-AG-09 申诉聚合
 * @statemachine 申诉状态机（Modeling/pim/领域事件与状态机.md，PIM-AG-09）：
 *   pending 待介入 → processing 介入中 → resolved 已裁决（终态，对外口径 done）；
 *   expired 超有效期（仅可查看，不可裁决）。裁决守卫：仅 pending/processing 可裁决。
 * @rule CIM-R-24 被处置方 7 天申诉权（valid_until）；CIM-R-31 纠纷申诉 48h 内介入
 *   裁决并通知双方（intervene_deadline）；PIM-EV-07 申诉已结案 → 裁决结论必达双方。
 * @api §5.3 #65-67 + @ac F30-AC1（48h 介入裁决并通知双方）/ F31-AC1（复核结论通知）
 *
 * 对齐基准：admin-web/src/api/appeal.ts DTO。与契约 §5.3 #65/#66 字段名偏差
 * （related_no/intervene_deadline vs order_id/sla_deadline）以该前端 DTO 为准，
 * 已在设计文档 §5.3 appeal 分组备注留痕。
 */
import { Injectable } from '@nestjs/common';
import { NotificationType } from '@contract/index';
import { ERROR_CODES } from '@contract/error-codes';
import { NotifySenderService } from '@infra/notify-sender/notify-sender.service';
import {
  AppealRepository,
  toContractStatus,
  toDbResult,
  type AppealRow,
  type OrderContextRow,
} from './appeal.repository';
import { validateAdjudicateBody, validateAppealListQuery } from './appeal.validator';
import type { AdjudicateBody } from './dto/appeal.dto';

/** 业务异常载体：code 为契约错误码，全局 BusinessErrorFilter 映射统一包络 */
export class BusinessError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'BusinessError';
  }
}

@Injectable()
export class AppealService {
  constructor(
    private readonly repo: AppealRepository,
    private readonly notify: NotifySenderService,
  ) {}

  /**
   * §5.3 #65 申诉队列：按 48h 介入时限升序（最紧迫优先），
   * 列表项 {id,type,related_no,submitted_at,intervene_deadline,status}。
   */
  async getQueue(rawQuery: unknown, _now = new Date()) {
    const query = validateAppealListQuery(rawQuery);
    const { list, total } = await this.repo.findQueue(query);

    // related_no 解析：dispute → 订单号；punishment → 处罚记录引用（PUN-<id>）
    const disputeTargetIds = list
      .filter((r) => r.appeal_type === 'dispute')
      .map((r) => r.target_id);
    const orders = await this.repo.findOrdersByIds(disputeTargetIds);
    const orderNoById = new Map(orders.map((o) => [o.id.toString(), o.order_no]));

    return {
      page: query.page,
      pageSize: query.pageSize,
      total,
      list: list.map((row) => this.serializeListItem(row, orderNoById)),
    };
  }

  /**
   * §5.3 #66 申诉详情：理由/证据/关联上下文（订单快照或处罚记录引用 +
   * 申诉人/被申诉对象）/48h 介入截止。chat_summary 暂无会话摘要数据源，占位 null。
   */
  async getDetail(id: bigint, _now = new Date()) {
    const row = await this.repo.findById(id);
    if (!row) throw new BusinessError(ERROR_CODES.ORDER_STATUS_CONFLICT, '申诉不存在');

    const order = row.appeal_type === 'dispute' ? await this.repo.findOrderById(row.target_id) : null;
    const respondentId = order ? this.resolveRespondentId(row, order) : null;

    const userIds = [row.appellant_id, ...(respondentId !== null ? [respondentId] : [])];
    const users = await this.repo.findUsersByIds(userIds);
    const nicknameById = new Map(users.map((u) => [u.id.toString(), u.nickname]));

    // punishment：target_id 指向处罚记录（report 处置单），尽力带出处置上下文
    const punishment =
      row.appeal_type === 'punishment' ? await this.repo.findReportById(row.target_id) : null;

    const context: Record<string, unknown> = {
      appellant: {
        id: String(row.appellant_id),
        nickname: nicknameById.get(String(row.appellant_id)) ?? '',
      },
      respondent:
        respondentId !== null
          ? { id: String(respondentId), nickname: nicknameById.get(String(respondentId)) ?? '' }
          : null, // punishment 申诉的被申诉对象为平台处置，无个人 respondent
      order: order ? this.serializeOrder(order) : null,
      punishment: punishment
        ? {
            record_id: String(punishment.id),
            result: punishment.result,
            handle_note: punishment.handle_note,
            handled_at: punishment.handled_at?.toISOString() ?? null,
          }
        : null,
    };

    return {
      appeal: {
        id: String(row.id),
        type: row.appeal_type,
        related_no: this.resolveRelatedNo(row, order?.order_no),
        reason: row.reason,
        evidence_urls: this.parseEvidenceUrls(row.evidence_urls),
        context,
        chat_summary: null, // 占位字段：聊天摘要调阅（A8 授权流程）后续批次接入
        status: toContractStatus(row.status),
        submitted_at: row.created_at.toISOString(),
        intervene_deadline: row.intervene_deadline.toISOString(),
      },
    };
  }

  /**
   * §5.3 #67 裁决提交：状态机守卫（仅 pending/processing）→ 回写 resolved →
   * linked_action 处置联动 → 处置留痕（admin_operation_log）→ 通知双方（@rule CIM-R-31 /
   * PIM-EV-07：裁决结论必达双方；punishment 申诉被申诉对象为平台，仅通知申诉人）。
   */
  async adjudicate(adminId: string, id: bigint, rawBody: unknown, now = new Date()) {
    const body: AdjudicateBody = validateAdjudicateBody(rawBody);

    const row = await this.repo.findById(id);
    if (!row) throw new BusinessError(ERROR_CODES.ORDER_STATUS_CONFLICT, '申诉不存在');
    if (row.status !== 'pending' && row.status !== 'processing') {
      throw new BusinessError(ERROR_CODES.ORDER_STATUS_CONFLICT, '该申诉已结案或超有效期，不可重复裁决');
    }

    const order = row.appeal_type === 'dispute' ? await this.repo.findOrderById(row.target_id) : null;
    const respondentId = order ? this.resolveRespondentId(row, order) : null;

    // linked_action 处置联动（@rule CIM-R-22 同款口径：off_shelf 下架 / ban 封禁 / warning·rejected 仅留痕）
    if (body.linked_action === 'off_shelf') {
      if (!order) {
        throw new BusinessError(ERROR_CODES.ORDER_STATUS_CONFLICT, 'off_shelf 仅适用于关联订单的纠纷申诉');
      }
      await this.repo.offShelfProduct(order.product_id);
    } else if (body.linked_action === 'ban') {
      if (respondentId === null) {
        throw new BusinessError(ERROR_CODES.ORDER_STATUS_CONFLICT, '无可处置对象（ban 需要明确的被申诉方）');
      }
      await this.repo.banUser(respondentId, body.note, now);
    }

    await this.repo.updateForAdjudication(id, {
      dbResult: toDbResult(body.result),
      handledBy: BigInt(adminId),
      handledAt: now,
      handleNote: body.note,
    });

    // 处置留痕：契约原值 result/linked_action 精确保留（DB 枚举映射有损）
    await this.repo.createAdjudicationLog({
      adminId: BigInt(adminId),
      appealId: row.id,
      reason: body.note,
      detail: {
        result: body.result,
        linked_action: body.linked_action ?? null,
        db_result: toDbResult(body.result),
        appeal_type: row.appeal_type,
        related_no: this.resolveRelatedNo(row, order?.order_no),
      },
    });

    // 通知双方（PIM-EV-07 同步直写口径，同 report-disposal；notify 走 infra NotifySenderService）
    const recipients = new Set<string>([String(row.appellant_id)]);
    if (respondentId !== null) recipients.add(String(respondentId));
    for (const uid of recipients) {
      await this.notify.send({
        user_id: BigInt(uid),
        type: NotificationType.APPEAL_RESULT,
        title: '你的申诉已有裁决结果',
        payload: { appeal_id: String(row.id), result: body.result },
      });
    }

    return { appeal: { status: 'done', result: body.result } };
  }

  /** 被申诉对象：纠纷申诉取订单另一方；申诉人非买卖双方时兜底为卖家 */
  private resolveRespondentId(row: AppealRow, order: OrderContextRow): bigint {
    return order.buyer_id === row.appellant_id ? order.seller_id : order.buyer_id;
  }

  /** related_no：dispute → 订单号（缺单兜底 ORD-<id>）；punishment → PUN-<处罚记录id> */
  private resolveRelatedNo(row: AppealRow, orderNo?: string): string {
    if (row.appeal_type === 'dispute') {
      return orderNo ?? `ORD-${row.target_id}`;
    }
    return `PUN-${row.target_id}`;
  }

  private serializeListItem(row: AppealRow, orderNoById: Map<string, string>) {
    return {
      id: String(row.id),
      type: row.appeal_type,
      related_no: this.resolveRelatedNo(row, orderNoById.get(String(row.target_id))),
      submitted_at: row.created_at.toISOString(),
      intervene_deadline: row.intervene_deadline.toISOString(),
      status: toContractStatus(row.status),
    };
  }

  private serializeOrder(order: OrderContextRow) {
    return {
      id: String(order.id),
      order_no: order.order_no,
      buyer_id: String(order.buyer_id),
      seller_id: String(order.seller_id),
      product_id: String(order.product_id),
      product_title: order.product_title,
      amount: String(order.amount),
      status: order.status,
    };
  }

  private parseEvidenceUrls(raw: unknown): string[] {
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
  }
}
