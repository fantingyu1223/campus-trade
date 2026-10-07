/**
 * dto/order.dto.ts —— 订单模块自含 DTO 声明（§3.1 自给自足，仅限声明不写逻辑）
 *
 * @module PIM-BC-04 交易订单
 * @model PIM-AG-06 交易订单聚合
 * @api §5.2 #30 POST /orders、#31 GET /orders/{id}、#32 POST /orders/{id}/confirm-receive
 */

/** 交易方式（trade_order.trade_mode，与 Prisma TradeIntentMode 值集一致） */
export type TradeModeValue = 'offline_meet' | 'online_pay';

/** 订单五态（PIM-SM-01，值集与 contract/enums.ts OrderStatus 一致） */
export type OrderStatusValue =
  | 'pending_delivery'
  | 'pending_confirm'
  | 'completed'
  | 'cancelled'
  | 'appealing';

/** #30 创建订单：校验后的规范化入参 */
export interface CreateOrderInput {
  productId: bigint;
  tradeMode: TradeModeValue;
  meetTime: Date | null;
  riskConfirmed: boolean;
  intentId: bigint | null;
}

/** #30 创建订单响应（契约字段：order_id/order_no/status/pay_deadline/countdown_sec） */
export interface CreateOrderResult {
  order_id: string;
  order_no: string;
  /** PIM-SM-01 五态；创建成功恒为 pending_delivery */
  status: OrderStatusValue;
  /** 超时兜底截止（timeout_deadline，ISO8601） */
  pay_deadline: string;
  /** 距 pay_deadline 剩余秒数 */
  countdown_sec: number;
}

/** #31 订单时间线条目（order_event 只增不改） */
export interface OrderTimelineItem {
  from_status: OrderStatusValue | null;
  to_status: OrderStatusValue;
  actor: string;
  note: string | null;
  created_at: string;
}

/** #31 订单详情响应（五态 + 倒计时 + timeline） */
export interface OrderDetailResult {
  order_id: string;
  order_no: string;
  status: OrderStatusValue;
  /** 支付通道（§6 对策 B 默认 offline_scan；无记录时为 null） */
  channel: string | null;
  product: { product_id: string; title: string };
  buyer_id: string;
  seller_id: string;
  amount: string;
  /** 距 timeout_deadline 剩余秒数（无截止时为 0） */
  countdown_sec: number;
  timeline: OrderTimelineItem[];
}

/** #32 确认收货响应（契约字段：status(completed)、review_pending(双方)） */
export interface ConfirmReceiveResult {
  status: 'completed';
  /** 双方评价入口开放口径：true=可评价（申诉中会冻结，裁决 8） */
  review_pending: { buyer: boolean; seller: boolean };
}
