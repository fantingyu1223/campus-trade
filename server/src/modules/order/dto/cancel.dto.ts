/**
 * dto/cancel.dto.ts —— 订单取消/拒收自含 DTO 声明（§3.1 自给自足，仅限声明不写逻辑）
 *
 * @module PIM-BC-04 交易订单
 * @model PIM-AG-06 交易订单聚合（CancelRequest 值对象）
 * @statemachine PIM-SM-01 订单状态机·取消请求子状态
 * @api §5.2 #33 POST /orders/{id}/cancel、#34 POST /orders/{id}/cancel/respond、#35 POST /orders/{id}/reject-onsite
 */
import type { OrderStatusValue } from './order.dto';

/** #34 响应取消动作（契约字段 action 值集） */
export type CancelAction = 'agree' | 'reject';

/** #34 校验后的规范化入参 */
export interface RespondCancelInput {
  action: CancelAction;
  /** 拒绝说明（action=reject 时写入 cancel_reject_note，可空） */
  note: string | null;
}

/** #35 校验后的规范化入参（@rule CIM-R-19：时间+说明必填留痕） */
export interface RejectOnsiteInput {
  rejectTime: Date;
  reason: string;
}

/**
 * #33 发起取消响应（契约字段：status(cancel_pending)、respond_deadline）。
 * 注：cancel_pending 为响应层子状态标签，非主状态枚举（PSM-03-1：取消请求中以字段组承载，不立枚举值）。
 */
export interface CancelResult {
  status: 'cancel_pending';
  /** 取消响应时限（cancel_deadline = 发起时刻+24h，ISO8601） */
  respond_deadline: string;
}

/** #34 响应取消响应（契约字段：status——agree→cancelled；reject→回原主态） */
export interface CancelRespondResult {
  status: OrderStatusValue;
}

/**
 * #35 现场拒收响应。
 * 口径说明（PSM-INC-01）：契约 #35 标注 status(rejected)，但 §4.17 表枚举无 rejected 主态，
 * 模型裁决以 §4.17+PRD 为准——拒收留痕后进入取消流程，主态落 cancelled（待契约评审会统一）。
 */
export interface RejectOnsiteResult {
  status: 'cancelled';
}
