/**
 * wantbuy.repository.ts —— 求购模块自含数据访问
 *
 * @table want_buy → PIM-AG-04 求购聚合
 * @module PIM-BC-02 商品与供给（求购子域）
 * @rule CIM-R-08 词拦截留痕（violation_intercept_log，scene=want_buy 固定）
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infra/prisma.service';

/** 违规拦截留痕入参（scene/action/target_id 由本仓储固定补全为 want_buy/blocked/null） */
export interface WantBuyViolationLogEntry {
  user_id: bigint;
  hit_word: string;
  content_snapshot: string;
}

@Injectable()
export class WantBuyRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 按主键查品类（category_id 存在性校验；求购允许非叶子品类，§4.11） */
  findCategoryById(id: bigint) {
    return this.prisma.category.findUnique({ where: { id } });
  }

  /** 新建求购（初始 status=active、expire_at=now+30 天由 service 计算后传入） */
  createWantBuy(data: Prisma.WantBuyUncheckedCreateInput) {
    return this.prisma.wantBuy.create({ data });
  }

  /** 按主键查求购（归属/状态守卫前置读取） */
  findById(id: bigint) {
    return this.prisma.wantBuy.findUnique({ where: { id } });
  }

  /**
   * @rule CIM-R-33 续期：expire_at 重置为 now+30 天（口径 PSM-INC-02，非契约错标的 7 天），
   * renewed_count 在原值上 +1，renewed_at 落时。
   */
  renew(id: bigint, expireAt: Date, renewedCount: number, renewedAt: Date) {
    return this.prisma.wantBuy.update({
      where: { id },
      data: { expire_at: expireAt, renewed_count: renewedCount, renewed_at: renewedAt },
    });
  }

  /**
   * @statemachine PIM-SM-03 active → closed/bought 终态迁移，closed_at 落时。
   * 终态不可复活（无回迁方法）；进入终态即停止一切撮合通知（F9-AC3）。
   */
  transitionTo(id: bigint, status: 'closed' | 'bought', closedAt: Date) {
    return this.prisma.wantBuy.update({
      where: { id },
      data: { status, closed_at: closedAt },
    });
  }

  /** #24 列表：仅 active（由 where 保证），created_at desc，分页 skip/take + total 并发 */
  async findPage(where: Prisma.WantBuyWhereInput, page: number, pageSize: number) {
    const [list, total] = await Promise.all([
      this.prisma.wantBuy.findMany({
        where,
        orderBy: { created_at: 'desc' as const },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.wantBuy.count({ where }),
    ]);
    return { list, total };
  }

  /** @rule CIM-R-08 拦截留痕：scene=want_buy、action=blocked、target_id=null 固定 */
  createViolationLog(entry: WantBuyViolationLogEntry) {
    return this.prisma.violationInterceptLog.create({
      data: {
        scene: 'want_buy',
        action: 'blocked',
        user_id: entry.user_id,
        target_id: null,
        hit_word: entry.hit_word,
        content_snapshot: entry.content_snapshot,
      },
    });
  }
}
