/**
 * services/api/review.ts —— review 评价分组接口封装（F17）。
 * @api §5.2 review 分组（#38 POST /reviews 提交评价 / #39 GET /reviews 某用户公开评价列表）
 * 复用 auth.ts 导出的通用 request；统一响应包络由 request 解析。
 * @module PIM-BC-05 评价与治理
 *
 * 延迟公开规则（§4.20）：双方均提交后立即公开；仅一方提交则在 review_deadline
 * （订单完成后 7 天）到期后统一公开；到期未评由 cron 补默认好评（is_default=1、rating=5）。
 */
import { request } from './auth';

// ---------- 类型定义（对齐 §5.2 #38-39） ----------
/** 提交评价请求（#38） */
export interface SubmitReviewPayload {
  order_id: number;
  /** 评分 1-5（契约字段名 score） */
  score: number;
  content?: string;
  tags?: string[];
  images?: string[];
}

/** 提交评价响应（#38：published_at 为延迟公开时间） */
export interface SubmitReviewResult {
  review_id: number;
  published_at: string;
}

/** 公开评价列表项（#39，仅返回已过延迟公开期的） */
export interface ReviewItem {
  score: number;
  content?: string;
  reviewer_role: 'buyer' | 'seller';
  created_at: string;
}

export interface ReviewListResult {
  list: ReviewItem[];
  has_more: boolean;
}

// ---------- #38 POST /reviews 提交评价（订单完成后 7 天窗口内、每订单每人限一次） ----------
export function submitReview(payload: SubmitReviewPayload): Promise<SubmitReviewResult> {
  return request<SubmitReviewResult>({
    url: '/reviews',
    method: 'POST',
    data: payload as unknown as Record<string, unknown>,
  });
}

// ---------- #39 GET /reviews 查看某用户公开评价 ----------
export function listReviews(userId: number, page = 1, pageSize = 20): Promise<ReviewListResult> {
  return request<ReviewListResult>({
    url: '/reviews',
    method: 'GET',
    data: { user_id: userId, page, pageSize },
  });
}
