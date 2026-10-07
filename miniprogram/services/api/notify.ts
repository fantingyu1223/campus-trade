/**
 * services/api/notify.ts —— notification 通知分组接口封装（F15）。
 * @api §5.2 notification 分组（#44 GET /notifications 列表+unread_count /
 *      #45 POST /notifications/read 标记已读，ids 空数组=全部已读）
 * 复用 auth.ts 导出的通用 request；统一响应包络由 request 解析。
 * @module PIM-BC-05 评价与治理（触达承接）
 *
 * type 枚举（§4.28）：U22 本期承接 5 类——want_buy_match 求购匹配 / order_status 订单状态 /
 * review_remind 评价提醒 / want_buy_expire 求购到期 / report_result 举报结果；
 * new_message/price_change/appeal_result 由对应页面各自承接，本期不落通知中心。
 */
import { request } from './auth';

// ---------- 类型定义（对齐 §5.2 #44-45 / §4.28 type 枚举） ----------
export type NotificationType =
  | 'want_buy_match'
  | 'order_status'
  | 'review_remind'
  | 'want_buy_expire'
  | 'report_result';

/** 通知跳转载荷（按类型携带对应 id） */
export interface NotificationPayload {
  product_id?: number;
  order_id?: number;
  want_buy_id?: number;
}

/** 通知列表项（#44） */
export interface NotificationItem {
  id: number;
  type: NotificationType;
  title: string;
  payload?: NotificationPayload;
  is_read: boolean;
  created_at: string;
}

export interface NotificationListResult {
  list: NotificationItem[];
  has_more: boolean;
  unread_count: number;
}

// ---------- #44 GET /notifications 通知列表 ----------
export function listNotifications(
  type?: NotificationType,
  page = 1,
  pageSize = 20,
): Promise<NotificationListResult> {
  const data: Record<string, unknown> = { page, pageSize };
  if (type) data.type = type;
  return request<NotificationListResult>({ url: '/notifications', method: 'GET', data });
}

// ---------- #45 POST /notifications/read 标记已读（空数组=全部已读） ----------
export function markNotificationsRead(ids: number[] = []): Promise<{ unread_count: number }> {
  return request<{ unread_count: number }>({
    url: '/notifications/read',
    method: 'POST',
    data: { ids },
  });
}
