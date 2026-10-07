/**
 * notify/dto/notify.dto.ts —— 通知读侧 DTO（模块自含，§3.1）。
 *
 * @module PIM-BC-06 触达支撑
 * @api §5.2 #44 GET /notifications、#45 POST /notifications/read
 */

/** #44 列表项：id 字符串序列化，created_at ISO 8601 */
export interface NotificationListItem {
  id: string;
  type: string;
  title: string;
  /** 跳转负载（仅存 ID 引用），DB NULL 时返回 null */
  payload: unknown;
  is_read: boolean;
  created_at: string;
}

/** #44 列表结果：分页 + 未读计数 */
export interface NotificationListResult {
  list: NotificationListItem[];
  total: number;
  unread_count: number;
  page: number;
  pageSize: number;
}

/** #45 标记已读结果：标记后重算的未读计数 */
export interface MarkReadResult {
  unread_count: number;
}

/** #44 原始 query（未校验，HTTP 入参全为字符串） */
export interface NotificationRawQuery {
  type?: string;
  page?: string;
  pageSize?: string;
}
