/**
 * review.validator.ts —— 评价入参字段校验（9001 聚合式拦截）
 *
 * @module PIM-BC-05 交易评价
 * @api §5.2 #38 POST /reviews
 * 口径：order_id 必填正整数；rating 1-5 整数（兼容契约字段 score 别名，rating 优先）；
 * content 可缺省（null），提供时非空串且 ≤500 字。
 */
// BusinessError 自 service 导入（循环安全：service → validator 仅值引用 BusinessError 类本身）
import { BusinessError } from './review.service';
import { ERROR_CODES } from '@contract/index';
import type { SubmitReviewInput } from './dto/review.dto';

const asBody = (raw: unknown): Record<string, unknown> => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, '缺少必填字段：请求体');
  }
  return raw as Record<string, unknown>;
};

const toBigInt = (v: unknown, field: string): bigint => {
  if (typeof v !== 'string' && typeof v !== 'number') {
    throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, `缺少必填字段：${field}`);
  }
  try {
    const n = BigInt(v);
    if (n <= BigInt(0)) throw new Error();
    return n;
  } catch {
    throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, `${field} 非法`);
  }
};

const toRating = (body: Record<string, unknown>): number => {
  // rating 优先；契约字段 score 作为别名兼容（§5.2 #38 请求体为 score）
  const v = body.rating !== undefined ? body.rating : body.score;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 5) {
    throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, 'rating 须为 1-5 整数');
  }
  return v;
};

const toContent = (v: unknown): string | null => {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') {
    throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, 'content 非法');
  }
  if (v.trim().length === 0) {
    throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, 'content 不能为空串');
  }
  if (v.length > 500) {
    throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, 'content 不能超过 500 字');
  }
  return v;
};

/** #38 提交评价入参校验：order_id 必填 / rating 1-5 整数（score 别名）/ content ≤500 且非空串 */
export function validateSubmitReview(raw: unknown): SubmitReviewInput {
  const body = asBody(raw);
  return {
    orderId: toBigInt(body.order_id, 'order_id'),
    rating: toRating(body),
    content: toContent(body.content),
  };
}
