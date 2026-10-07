/**
 * @module infra/admin-log
 * @table admin_operation_log → PIM-BC-06（§4.27 不可变日志，只增不改不删）
 * 运营操作日志仓储：create 落库；findPage 审计查询（operator/action/target_type/
 * 时间范围过滤取交集，created_at 倒序分页），只读不写。
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

export interface AdminLogCreateEntry {
  admin_id: bigint;
  action: string;
  target_type: string | null;
  target_id: bigint | null;
  reason: string;
  detail?: Record<string, unknown>;
  ip: string | null;
}

export interface AdminLogFilter {
  operatorId?: bigint;
  action?: string;
  targetType?: string;
  timeFrom?: Date;
  timeTo?: Date;
}

@Injectable()
export class AdminLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 落库一条操作日志（§4.27：只增不改不删） */
  async create(entry: AdminLogCreateEntry) {
    return this.prisma.adminOperationLog.create({
      data: {
        ...entry,
        detail: entry.detail as Prisma.InputJsonValue | undefined,
      },
    });
  }

  /** 审计查询：过滤条件取交集 + created_at 倒序分页 */
  async findPage(filter: AdminLogFilter, page = 1, pageSize = 20) {
    const where: Record<string, unknown> = {};
    if (filter.operatorId !== undefined) where.admin_id = filter.operatorId;
    if (filter.action !== undefined) where.action = filter.action;
    if (filter.targetType !== undefined) where.target_type = filter.targetType;
    if (filter.timeFrom !== undefined || filter.timeTo !== undefined) {
      where.created_at = {
        ...(filter.timeFrom !== undefined ? { gte: filter.timeFrom } : {}),
        ...(filter.timeTo !== undefined ? { lte: filter.timeTo } : {}),
      };
    }
    const [list, total] = await Promise.all([
      this.prisma.adminOperationLog.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.adminOperationLog.count({ where }),
    ]);
    return { list, total };
  }
}
