/**
 * review.service.ts —— 交易评价核心服务（提交评价 / 公开列表 / 超时默认好评）
 *
 * @module PIM-BC-05 交易评价
 * @rule F17：7 天评价窗口、延迟公开（双方互评后立即公开）、超时默认好评
 * @decision PIM-D-2 裁决：评价窗口不顺延——无论订单是否曾申诉冻结，
 *   review_deadline 恒等于 completed_at + 7 天
 * @api §5.2 #38 POST /reviews、#39 GET /users/{id}/reviews
 */
import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@contract/index';
import { ReviewRepository } from './review.repository';
import { validateSubmitReview } from './review.validator';
import type {
  PublicReviewItem,
  PublicReviewListResult,
  ReviewerRoleValue,
  SubmitReviewResult,
} from './dto/review.dto';

/** 业务错误（统一异常过滤器据此映射 code/message 包络） */
export class BusinessError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'BusinessError';
  }
}

/** @rule F17：评价窗口 7 天毫秒数（PIM-D-2：恒等 completed_at+7d，不顺延） */
const REVIEW_WINDOW_MS = 7 * 24 * 3600 * 1000;

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/** 分页参数归一：数字/数字字符串兼容，缺省 1/20，pageSize 上限 50 */
const normalizePage = (query: unknown): { page: number; pageSize: number } => {
  const q = (query && typeof query === 'object' ? query : {}) as Record<string, unknown>;
  const toInt = (v: unknown, fallback: number): number => {
    const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
    return Number.isInteger(n) && n > 0 ? n : fallback;
  };
  const page = toInt(q.page, DEFAULT_PAGE);
  const pageSize = Math.min(toInt(q.pageSize ?? q.page_size, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  return { page, pageSize };
};

@Injectable()
export class ReviewService {
  constructor(private readonly repo: ReviewRepository) {}

  /**
   * @api §5.2 #38 提交评价
   * 链路口径：validator（9001 前置）→ 订单不存在/非 completed 5001 → completed_at 为 null 5001
   * → 非买卖双方 1003 → 超窗（now > completed_at+7d）5001 → 重复提交 5002
   * → 落库 is_public=false（review_deadline=completed_at+7d）→ 对方已评则双方立即公开。
   *
   * @decision PIM-D-2：deadline 恒等于 completed_at+7d，即使订单曾申诉冻结窗口也不顺延。
   */
  async submitReview(reviewerId: bigint, raw: unknown, now = new Date()): Promise<SubmitReviewResult> {
    const input = validateSubmitReview(raw);

    const order = await this.repo.findOrderById(input.orderId);
    if (!order || order.status !== 'completed') {
      throw new BusinessError(ERROR_CODES.ORDER_NOT_REVIEWABLE, '订单不存在或当前状态不可评价');
    }
    if (!order.completed_at) {
      // 数据防御：completed 单必带 completed_at，缺失视为不可评价
      throw new BusinessError(ERROR_CODES.ORDER_NOT_REVIEWABLE, '订单完成时间缺失，不可评价');
    }
    if (reviewerId !== order.buyer_id && reviewerId !== order.seller_id) {
      throw new BusinessError(ERROR_CODES.PERMISSION_DENIED, '仅订单买卖双方可评价');
    }
    // PIM-D-2 裁决注释：无论是否曾申诉冻结，deadline 恒等于 completed_at + 7d，窗口不顺延
    const deadline = new Date(order.completed_at.getTime() + REVIEW_WINDOW_MS);
    if (now.getTime() > deadline.getTime()) {
      throw new BusinessError(ERROR_CODES.ORDER_NOT_REVIEWABLE, '评价窗口已过（订单完成后 7 天内可评）');
    }

    const existing = await this.repo.findReview(order.id, reviewerId);
    if (existing) {
      throw new BusinessError(ERROR_CODES.DUPLICATE_REVIEW, '该订单已提交过评价');
    }

    const revieweeId = reviewerId === order.buyer_id ? order.seller_id : order.buyer_id;
    const review = await this.repo.createReview({
      orderId: order.id,
      reviewerId,
      revieweeId,
      rating: input.rating,
      content: input.content,
      isDefault: false,
      reviewDeadline: deadline,
    });

    // 延迟公开规则：对方已评 → 双方互评成立，立即公开
    const peer = await this.repo.findReview(order.id, revieweeId);
    let publishedAt: Date | null = null;
    if (peer) {
      await this.repo.publishOrderReviews(order.id, now);
      publishedAt = now;
    }
    return { review_id: review.id.toString(), published_at: publishedAt ? publishedAt.toISOString() : null };
  }

  /**
   * @api §5.2 #39 用户公开评价列表（游客可读）
   * 仅 is_public=true（延迟公开期内的不出站）；reviewer_role 按订单 buyer_id 判定；
   * 订单缺失的条目跳过（数据防御，不阻断整页）。
   */
  async listPublicReviews(userId: bigint, query: unknown): Promise<PublicReviewListResult> {
    const { page, pageSize } = normalizePage(query);
    const [rows, total] = await Promise.all([
      this.repo.findPublicReviews(userId, (page - 1) * pageSize, pageSize),
      this.repo.countPublicReviews(userId),
    ]);

    const orderIds = [...new Set(rows.map((r) => r.order_id))];
    const orders = orderIds.length > 0 ? await this.repo.findOrdersByIds(orderIds) : [];
    const orderMap = new Map(orders.map((o) => [o.id.toString(), o]));

    const list: PublicReviewItem[] = [];
    for (const r of rows) {
      const order = orderMap.get(r.order_id.toString());
      if (!order) continue; // 订单缺失跳过该条
      const reviewerRole: ReviewerRoleValue = r.reviewer_id === order.buyer_id ? 'buyer' : 'seller';
      list.push({
        review_id: r.id.toString(),
        score: r.rating,
        content: r.content,
        reviewer_role: reviewerRole,
        is_default: r.is_default,
        created_at: r.created_at.toISOString(),
      });
    }
    return { list, page, page_size: pageSize, total };
  }

  /**
   * @rule F17 超时默认好评（review-default.cron 驱动）：
   * 扫描 completed 且 completed_at ≤ now-7d 的订单，逐单为缺评方补录
   * is_default=true / rating=5 / content=null / review_deadline=completed_at+7d 的默认好评，
   * 随后统一公开该单全部评价。
   * 防御口径：completed_at null 跳过；deadline > now 跳过（repository 口径外脏数据）；
   * 双方均已公开跳过；双方已提交未公开只公开不补录。
   * 返回补录条数。
   */
  async applyDefaultReviews(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - REVIEW_WINDOW_MS);
    const orders = await this.repo.findExpiredCompletedOrders(cutoff);

    let created = 0;
    for (const order of orders) {
      if (!order.completed_at) continue; // 防御：completed 单缺完成时间
      // PIM-D-2：deadline 恒等 completed_at+7d（窗口不顺延）
      const deadline = new Date(order.completed_at.getTime() + REVIEW_WINDOW_MS);
      if (deadline.getTime() > now.getTime()) continue; // 防御：窗口未到期不补录

      const reviews = await this.repo.findReviewsByOrder(order.id);
      const buyerReview = reviews.find((r) => r.reviewer_id === order.buyer_id);
      const sellerReview = reviews.find((r) => r.reviewer_id === order.seller_id);
      if (buyerReview?.is_public && sellerReview?.is_public) continue; // 双方均已公开

      // 为缺评方补默认好评（双方已提交未公开时不补录，仅走到统一公开）
      const sides: Array<[bigint, bigint, typeof buyerReview]> = [
        [order.buyer_id, order.seller_id, buyerReview],
        [order.seller_id, order.buyer_id, sellerReview],
      ];
      for (const [reviewerId, revieweeId, existing] of sides) {
        if (existing) continue;
        await this.repo.createReview({
          orderId: order.id,
          reviewerId,
          revieweeId,
          rating: 5,
          content: null,
          isDefault: true,
          reviewDeadline: deadline,
        });
        created += 1;
      }
      await this.repo.publishOrderReviews(order.id, now);
    }
    return created;
  }
}
