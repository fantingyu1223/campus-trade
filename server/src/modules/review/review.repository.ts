/**
 * review.repository.ts —— 交易评价模块自含数据访问
 *
 * @table review（PIM-BC-05 本聚合）；trade_order 只读（跨 schema 只读查询订单归属/完成时间）
 * @module PIM-BC-05 交易评价
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infra/prisma.service';

/** 建评入参（service 已完成校验与派生计算） */
export interface CreateReviewInput {
  orderId: bigint;
  reviewerId: bigint;
  revieweeId: bigint;
  rating: number;
  content: string | null;
  isDefault: boolean;
  reviewDeadline: Date;
}

@Injectable()
export class ReviewRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 按主键查订单（跨 schema 只读：评价守卫读取 status/completed_at/buyer_id/seller_id） */
  findOrderById(id: bigint) {
    return this.prisma.tradeOrder.findUnique({ where: { id } });
  }

  /** 按订单批量查订单（列表页 reviewer_role 判定用，跨 schema 只读） */
  findOrdersByIds(ids: bigint[]) {
    return this.prisma.tradeOrder.findMany({ where: { id: { in: ids } } });
  }

  /** 查某人在某订单的评价（重复提交 5002 / 对方是否已评判定） */
  findReview(orderId: bigint, reviewerId: bigint) {
    return this.prisma.review.findFirst({
      where: { order_id: orderId, reviewer_id: reviewerId },
    });
  }

  /** 查订单全部评价（默认好评补录缺评方判定） */
  findReviewsByOrder(orderId: bigint) {
    return this.prisma.review.findMany({ where: { order_id: orderId } });
  }

  /** 落库评价：is_public 恒 false（延迟公开，由 publishOrderReviews 统一公开） */
  createReview(input: CreateReviewInput) {
    return this.prisma.review.create({
      data: {
        order_id: input.orderId,
        reviewer_id: input.reviewerId,
        reviewee_id: input.revieweeId,
        rating: input.rating,
        content: input.content,
        is_default: input.isDefault,
        is_public: false,
        review_deadline: input.reviewDeadline,
      },
    });
  }

  /** 统一公开订单全部评价（双方互评后 / 窗口到期默认好评补录后） */
  publishOrderReviews(orderId: bigint, at: Date) {
    return this.prisma.review.updateMany({
      where: { order_id: orderId },
      data: { is_public: true, public_at: at },
    });
  }

  /** #39 公开评价分页：仅 is_public=true，按时间倒序 */
  findPublicReviews(revieweeId: bigint, skip: number, take: number) {
    return this.prisma.review.findMany({
      where: { reviewee_id: revieweeId, is_public: true },
      orderBy: { created_at: 'desc' },
      skip,
      take,
    });
  }

  /** #39 公开评价总数（分页 total） */
  countPublicReviews(revieweeId: bigint) {
    return this.prisma.review.count({
      where: { reviewee_id: revieweeId, is_public: true },
    });
  }

  /** 默认好评扫描口径：completed 且 completed_at ≤ cutoff（now-7d） */
  findExpiredCompletedOrders(cutoff: Date) {
    return this.prisma.tradeOrder.findMany({
      where: { status: 'completed', completed_at: { not: null, lte: cutoff } },
    });
  }
}
