/**
 * risk-warning.repository.ts —— 黄牛预警数据访问层（T-304）
 * @module PIM-BC-05
 * @rule CIM-R-36
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infra/prisma.service';

export type RiskRuleCode = 'daily_ge5' | 'cross_ge3_cat' | 'suspected_merchant';

export interface WarningQuery {
  status?: 'pending' | 'handled';
  ruleCode?: RiskRuleCode;
  page: number;
  pageSize: number;
}

export interface CreateWarningData {
  user_id: bigint;
  rule_code: RiskRuleCode;
  rule_snapshot: Record<string, unknown>;
}

@Injectable()
export class RiskWarningRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 当日各卖家发布数（published_at ∈ [dayStart, dayEnd)） */
  countDailyPublished(dayStart: Date, dayEnd: Date) {
    return this.prisma.product.groupBy({
      by: ['seller_id'],
      where: { published_at: { gte: dayStart, lt: dayEnd } },
      _count: { _all: true },
    });
  }

  /** 在售商品的 卖家-类目 明细 */
  listOnSaleSellerCategory() {
    return this.prisma.product.findMany({
      where: { status: 'on_sale' },
      select: { seller_id: true, category_id: true },
    });
  }

  /** 近 30 天各用户被拦截次数 */
  countBlockedSince(since: Date) {
    return this.prisma.violationInterceptLog.groupBy({
      by: ['user_id'],
      where: { action: 'blocked', created_at: { gte: since } },
      _count: { _all: true },
    });
  }

  findUserIdentities(ids: bigint[]) {
    return this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, identity_type: true },
    });
  }

  existsPending(userId: bigint, ruleCode: RiskRuleCode) {
    return this.prisma.riskWarning.findFirst({
      where: { user_id: userId, rule_code: ruleCode, status: 'pending' },
    });
  }

  createWarning(data: CreateWarningData) {
    return this.prisma.riskWarning.create({
      data: {
        ...data,
        rule_snapshot: data.rule_snapshot as never,
        status: 'pending',
      },
    });
  }

  async findWarnings(q: WarningQuery) {
    const where: Record<string, unknown> = {};
    if (q.status === 'handled') where.status = { in: ['confirmed', 'false_alarm'] };
    else if (q.status === 'pending') where.status = 'pending';
    if (q.ruleCode) where.rule_code = q.ruleCode;
    const [list, total] = await Promise.all([
      this.prisma.riskWarning.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.riskWarning.count({ where }),
    ]);
    return { list, total };
  }

  findById(id: bigint) {
    return this.prisma.riskWarning.findUnique({ where: { id } });
  }

  markReviewed(id: bigint, data: Record<string, unknown>) {
    return this.prisma.riskWarning.update({ where: { id }, data });
  }
}
