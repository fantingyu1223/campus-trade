/**
 * services/api/order.ts —— order 订单分组接口封装（F34/F35）。
 * @api §5.2 order 分组（#30 POST /orders 创建订单 / #31 GET /orders/{id} 详情 /
 *      #32 POST /orders/{id}/confirm-receive 确认收货 / #33 POST /orders/{id}/cancel 发起取消 /
 *      #35 POST /orders/{id}/reject-onsite 现场拒收 / #37 GET /orders 我的订单列表）
 * 复用 auth.ts 导出的通用 request；统一响应包络由 request 解析。
 *
 * 契约偏离说明（待后端确认）：
 * 1. 订单五态：#31 表格写作 pending_pay/paid/completed/cancelled/rejected，
 *    与 types/contract.ts OrderStatus（pending_delivery/pending_confirm/completed/cancelled/appealing，
 *    F34-AC3 五态枚举）不一致；此处按 types/contract.ts 为准，需契约修订确认。
 * 2. confirm_deadline：#31 响应含 countdown_sec，U17 需要 48h 倒计时绝对时刻
 *    （F35 裁决#4：未录入约定交货时间时以付款成功时刻+48h 起算），此处扩展 confirm_deadline 字段。
 * 3. #34 取消响应（agree/reject）属对方操作，本期前端未实现对应入口。
 */
import { request } from './auth';
import { OrderStatus } from '../../types/contract';

// ---------- 类型定义（对齐 §5.2 #30-37 / types/contract.ts OrderStatus） ----------
export type OrderStatusStr = `${OrderStatus}`;

/** 订单内商品摘要（§5.2 #31 product{...}） */
export interface OrderProduct {
  id: number;
  title: string;
  cover?: string;
  price: number;
}

/** 订单交易方 */
export interface OrderParty {
  id: number;
  nickname: string;
  identity_type?: string;
}

/** 订单事件时间线（全程留痕，F34/N9） */
export interface OrderTimelineItem {
  time: string;
  event: string;
}

/** 订单详情（§5.2 #31 响应 order 结构；confirm_deadline 见头注释偏离 2） */
export interface OrderDetailResult {
  order: {
    order_id: number;
    order_no: string;
    status: OrderStatusStr;
    channel: 'online' | 'offline';
    product: OrderProduct;
    buyer: OrderParty;
    seller: OrderParty;
    amount: number;
    trade_point?: string;
    trade_time?: string;
    confirm_deadline?: string;
    countdown_sec?: number;
    timeline: OrderTimelineItem[];
  };
}

/** 我的订单列表项（§5.2 #37 分页列表） */
export interface OrderListItem {
  order_id: number;
  order_no: string;
  status: OrderStatusStr;
  amount: number;
  product: OrderProduct;
  peer: OrderParty;
  created_at: string;
}

export interface OrderListResult {
  list: OrderListItem[];
  has_more: boolean;
}

/** 创建订单响应（§5.2 #30） */
export interface CreateOrderResult {
  order_id: number;
  order_no: string;
  status: string;
  pay_deadline?: string;
  countdown_sec?: number;
}

// ---------- #30 POST /orders 创建订单（线上支付锁单防超卖，F34-AC1） ----------
export function createOrder(payload: {
  product_id: number;
  intent_id?: number;
}): Promise<CreateOrderResult> {
  return request<CreateOrderResult>({
    url: '/orders',
    method: 'POST',
    data: payload as unknown as Record<string, unknown>,
  });
}

// ---------- #31 GET /orders/{id} 订单详情（五态+倒计时，U17） ----------
export function getOrderDetail(orderId: number): Promise<OrderDetailResult> {
  return request<OrderDetailResult>({ url: `/orders/${orderId}`, method: 'GET' });
}

// ---------- #32 POST /orders/{id}/confirm-receive 确认收货（F34，→completed） ----------
export function confirmReceive(orderId: number): Promise<{ status: OrderStatusStr; review_pending?: boolean }> {
  return request<{ status: OrderStatusStr; review_pending?: boolean }>({
    url: `/orders/${orderId}/confirm-receive`,
    method: 'POST',
  });
}

// ---------- #33 POST /orders/{id}/cancel 发起取消（F35，对方 24h 未响应默认同意） ----------
export function requestCancel(orderId: number, reason: string): Promise<{ status: string; respond_deadline?: string }> {
  return request<{ status: string; respond_deadline?: string }>({
    url: `/orders/${orderId}/cancel`,
    method: 'POST',
    data: { reason },
  });
}

// ---------- #35 POST /orders/{id}/reject-onsite 现场拒收（F35-AC4，时间+说明必填留痕） ----------
export function rejectOnsite(orderId: number, payload: { reject_time: string; reason: string }): Promise<{ status: string }> {
  return request<{ status: string }>({
    url: `/orders/${orderId}/reject-onsite`,
    method: 'POST',
    data: payload,
  });
}

// ---------- #37 GET /orders 我的订单列表（U17 入口列表） ----------
export function getMyOrders(
  role: 'buyer' | 'seller' = 'buyer',
  status?: OrderStatusStr,
  page = 1,
  pageSize = 20,
): Promise<OrderListResult> {
  const data: Record<string, unknown> = { role, page, pageSize };
  if (status) data.status = status;
  return request<OrderListResult>({ url: '/orders', method: 'GET', data });
}
