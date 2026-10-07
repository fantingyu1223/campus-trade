/**
 * merchant-review.repository.ts —— 商家入驻审核数据访问层（T-306）
 * @module PIM-AG-10
 * @table merchant_application / user / admin_operation_log
 */
import { Injectable } from '@nestjs/common';
import { IdentityType } from '@prisma/client';
import { PrismaService } from '@infra/prisma.service';

export type MerchantAppStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface MerchantPageQuery {
  status: MerchantAppStatus;
  page: number;
  pageSize: number;
}

@Injectable()
export class MerchantReviewRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 分页查询：按提交时间升序（先到先审，对齐 SLA 口径） */
  async findPage({ status, page, pageSize }: MerchantPageQuery) {
    const where = { status };
    const [items, total] = await Promise.all([
      this.prisma.merchantApplication.findMany({
        where,
        orderBy: { submitted_at: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.merchantApplication.count({ where }),
    ]);
    return { items, total };
  }

  async findById(id: bigint) {
    return this.prisma.merchantApplication.findUnique({ where: { id } });
  }

  /** 乐观状态迁移：仅当当前状态仍为 fromStatus 时更新，返回受影响条数（0 = 已被并发处理） */
  async transition(id: bigint, fromStatus: MerchantAppStatus, data: Record<string, unknown>) {
    const r = await this.prisma.merchantApplication.updateMany({
      where: { id, status: fromStatus },
      data,
    });
    return r.count;
  }

  async updateUserIdentityType(userId: bigint, type: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { identity_type: type as IdentityType },
    });
  }

  async findUsersByIds(ids: bigint[]) {
    return this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, nickname: true },
    });
  }

  /** SLA 超时未审的申请（pending 且 sla_deadline <= now） */
  async findOverduePending(now: Date) {
    return this.prisma.merchantApplication.findMany({
      where: { status: 'pending', sla_deadline: { lte: now } },
    });
  }

  /** 超时标记查重（admin_operation_log 中的 sla_timeout 留痕） */
  async findTimeoutMarker(id: bigint) {
    return this.prisma.adminOperationLog.findFirst({
      where: { action: 'merchant_review.sla_timeout', target_id: id },
    });
  }

  async createTimeoutMarker(entry: {
    admin_id: bigint;
    action: string;
    target_type: string;
    target_id: bigint;
    reason: string;
  }) {
    await this.prisma.adminOperationLog.create({ data: entry });
  }
}
