/**
 * notify/notify-query.service.ts —— 通知读侧服务（#44 列表 / #45 标记已读）。
 *
 * @module PIM-BC-06 触达支撑（notify 无聚合，仓储下沉 infra/notify-sender）
 * @api §5.2 #44 GET /notifications、#45 POST /notifications/read
 * @ac F15 通知中心读侧：本人列表倒序分页 + unread_count；批量/全部标记已读
 *
 * 纪律：
 *  - 参数校验失败一律抛 BusinessError(9001)（§5.1）；
 *  - 越权防护：查询/更新 where 恒带本人 user_id（仓储层强制）。
 */
import { Injectable } from '@nestjs/common';
import { ERROR_CODES, ErrorCode, NotificationType } from '@contract/index';
import { NotificationRepository } from '@infra/notify-sender/notification.repository';
import {
  MarkReadResult,
  NotificationListItem,
  NotificationListResult,
  NotificationRawQuery,
} from './dto/notify.dto';

/** 业务错误：携带契约错误码（§5.1），由全局过滤器翻译为统一响应包络。 */
export class BusinessError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BusinessError';
  }
}

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/** 正整数（≥1）字符串校验 */
function parsePositiveInt(raw: string | undefined, fallback: number, field: string): number {
  if (raw === undefined) {
    return fallback;
  }
  if (!/^\d+$/.test(raw)) {
    throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, `${field} 非法`);
  }
  const value = parseInt(raw, 10);
  if (value < 1) {
    throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, `${field} 非法`);
  }
  return value;
}

/** ids 元素统一转 BigInt：接受数字串或非负整数，其余抛 9001 */
function toNotificationId(raw: unknown): bigint {
  if (typeof raw === 'string') {
    if (!/^\d+$/.test(raw)) {
      throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, 'ids 元素非法');
    }
    return BigInt(raw);
  }
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) {
    return BigInt(raw);
  }
  throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, 'ids 元素非法');
}

@Injectable()
export class NotifyQueryService {
  constructor(private readonly repo: NotificationRepository) {}

  /**
   * #44 GET /notifications：本人通知列表，created_at 倒序分页 + unread_count。
   * @throws BusinessError(9001) type 非契约枚举成员 / page、pageSize 越界或非法
   */
  async list(uid: string, rawQuery: NotificationRawQuery): Promise<NotificationListResult> {
    const userId = BigInt(uid);

    let type: string | null = null;
    if (rawQuery.type !== undefined) {
      const allowed = Object.values(NotificationType) as string[];
      if (!allowed.includes(rawQuery.type)) {
        throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, 'type 非法');
      }
      type = rawQuery.type;
    }

    const page = parsePositiveInt(rawQuery.page, DEFAULT_PAGE, 'page');
    const pageSize = parsePositiveInt(rawQuery.pageSize, DEFAULT_PAGE_SIZE, 'pageSize');
    if (pageSize > MAX_PAGE_SIZE) {
      throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, 'pageSize 非法');
    }

    const [{ list, total }, unreadCount] = await Promise.all([
      this.repo.findPageByUser(userId, type, page, pageSize),
      this.repo.countUnread(userId),
    ]);

    const items: NotificationListItem[] = list.map((row) => ({
      id: row.id.toString(),
      type: row.type,
      title: row.title,
      payload: row.payload === undefined ? null : row.payload,
      is_read: row.is_read,
      created_at: row.created_at.toISOString(),
    }));

    return { list: items, total, unread_count: unreadCount, page, pageSize };
  }

  /**
   * #45 POST /notifications/read：批量标记已读（is_read=true + read_at）。
   * ids 空数组 = 全部已读；返回标记后重算的 unread_count。
   * @throws BusinessError(9001) ids 缺失/非数组/元素非数字（不落库）
   */
  async markRead(uid: string, rawBody: unknown): Promise<MarkReadResult> {
    const userId = BigInt(uid);

    const body = (rawBody ?? {}) as { ids?: unknown };
    if (!Array.isArray(body.ids)) {
      throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, 'ids 必填且须为数组');
    }
    const ids = body.ids.map(toNotificationId);

    // 空数组时仓储省略 id 过滤 = 全部已读（§5.2 #45 口径）；where 恒带本人未读
    await this.repo.markRead(userId, ids, new Date());
    const unreadCount = await this.repo.countUnread(userId);
    return { unread_count: unreadCount };
  }
}
