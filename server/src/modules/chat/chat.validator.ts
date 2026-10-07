/**
 * chat.validator.ts —— 聊天模块纯函数校验器（无 IO，9001 统一抛 BusinessError）
 *
 * @module PIM-BC-03 沟通与协商
 * @model PIM-AG-05 会话与消息聚合
 * @api §5.2 #25-27 + POST /conversations + POST /conversations/:id/read
 *
 * 落点：
 *  - 发起会话字段校验（product_id 正整数）
 *  - 发消息字段校验（type 枚举 / text 必填 content ≤2000 / image 必填 image_url）
 *  - 会话 id 与游标解析（before_id 正整数、limit 缺省 20 上限 50）
 *  - assertConversationMember：非会话成员 → 1003
 */
import { ERROR_CODES } from '@contract/index';
import { BusinessError } from './conversation.service';
import type { MessageTypeValue } from './dto/message.dto';

/** 文本消息最大长度（契约 §5.2 #27） */
const MAX_TEXT_LENGTH = 2000;
/** 消息分页缺省条数 */
const DEFAULT_LIMIT = 20;
/** 消息分页上限 */
const MAX_LIMIT = 50;

/** 正整数字符串判定（禁止 0 / 负数 / 非数字） */
function parsePositiveBigInt(raw: unknown, field: string): bigint {
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw.trim())) {
    throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, `字段 ${field} 必须为正整数字符串`);
  }
  return BigInt(raw.trim());
}

/** 发起会话字段校验：product_id 必填正整数 */
export function validateCreateConversationFields(raw: unknown): { productId: bigint } {
  const body = (raw ?? {}) as Record<string, unknown>;
  return { productId: parsePositiveBigInt(body.product_id, 'product_id') };
}

/** 发消息字段校验结果 */
export interface SendMessageFields {
  type: MessageTypeValue;
  content: string | null;
  imageUrl: string | null;
}

/** 发消息字段校验：type 仅 text/image；text 必传 content（trim 后非空、≤2000）；image 必传 image_url */
export function validateSendMessageFields(raw: unknown): SendMessageFields {
  const body = (raw ?? {}) as Record<string, unknown>;
  const type = body.type;
  if (type !== 'text' && type !== 'image') {
    throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, '字段 type 仅支持 text/image');
  }
  if (type === 'text') {
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (!content || content.length > MAX_TEXT_LENGTH) {
      throw new BusinessError(
        ERROR_CODES.PARAM_VALIDATION_FAILED,
        `字段 content 必填且长度不超过 ${MAX_TEXT_LENGTH}`,
      );
    }
    return { type, content, imageUrl: null };
  }
  const imageUrl = typeof body.image_url === 'string' ? body.image_url.trim() : '';
  if (!imageUrl) {
    throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, '字段 image_url 必填');
  }
  return { type, content: null, imageUrl };
}

/** 会话 id 路径参数解析：非正整数 → 9001 */
export function parseConversationId(raw: unknown): bigint {
  return parsePositiveBigInt(raw, 'id');
}

/** 游标分页参数解析结果 */
export interface CursorQuery {
  beforeId: bigint | null;
  limit: number;
}

/** 游标解析：before_id 缺省 null、非法 → 9001；limit 缺省 20、上限钳制 50 */
export function parseCursorQuery(raw: unknown): CursorQuery {
  const query = (raw ?? {}) as Record<string, unknown>;
  let beforeId: bigint | null = null;
  if (query.before_id !== undefined && query.before_id !== null && query.before_id !== '') {
    beforeId = parsePositiveBigInt(query.before_id, 'before_id');
  }
  let limit = DEFAULT_LIMIT;
  if (query.limit !== undefined && query.limit !== null && query.limit !== '') {
    const parsed = Number(query.limit);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, '字段 limit 必须为正整数');
    }
    limit = Math.min(parsed, MAX_LIMIT);
  }
  return { beforeId, limit };
}

/** 会话成员断言：非买方且非卖方 → 1003 */
export function assertConversationMember(
  conversation: { buyer_id: bigint; seller_id: bigint },
  userId: bigint,
): void {
  if (conversation.buyer_id !== userId && conversation.seller_id !== userId) {
    throw new BusinessError(ERROR_CODES.PERMISSION_DENIED, '非会话成员，无权操作');
  }
}
