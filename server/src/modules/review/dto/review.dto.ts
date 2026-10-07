/**
 * dto/review.dto.ts —— 交易评价模块自含 DTO 声明（§3.1 自给自足，仅限声明不写逻辑）
 *
 * @module PIM-BC-05 交易评价
 * @api §5.2 #38 POST /reviews、#39 GET /users/{id}/reviews
 */

/** 评价人角色（按订单 buyer_id/seller_id 判定，reviewer_role） */
export type ReviewerRoleValue = 'buyer' | 'seller';

/** #38 提交评价：校验后的规范化入参（rating 兼容 score 别名，validator 归一） */
export interface SubmitReviewInput {
  orderId: bigint;
  /** 1-5 整数 */
  rating: number;
  /** 可空（默认好评 content=null；用户提交空串由 validator 9001 拦截） */
  content: string | null;
}

/** #38 提交评价响应（契约字段：review_id、published_at 延迟公开时间） */
export interface SubmitReviewResult {
  review_id: string;
  /** 双方互评后立即公开=提交时刻 ISO8601；单方提交延迟公开=null */
  published_at: string | null;
}

/** #39 公开评价列表查询（page/pageSize 缺省 1/20，pageSize 上限 50） */
export interface PublicReviewListQuery {
  page: number;
  pageSize: number;
}

/** #39 列表条目（契约字段：score/content/reviewer_role/created_at） */
export interface PublicReviewItem {
  review_id: string;
  score: number;
  content: string | null;
  reviewer_role: ReviewerRoleValue;
  is_default: boolean;
  created_at: string;
}

/** #39 分页响应 */
export interface PublicReviewListResult {
  list: PublicReviewItem[];
  page: number;
  page_size: number;
  total: number;
}
