/**
 * account.repository.ts —— 账号管理（后台）数据访问
 *
 * @module PIM-BC-05/06（后台治理子域 admin/governance）
 * @table user → PIM-AG-01（跨 schema 读写：检索/封禁状态回写，口径同
 *        report.repository.banUser——治理动作按契约同步直写并注释留痕）；
 *        product/trade_order/report → 跨 schema 只读（统计计数）；
 *        admin_operation_log → 无聚合 BC-06（操作留痕查询，ban_info 来源）；
 *        admin_user → 跨 schema 只读（操作人昵称）
 *
 * 口径：契约 status=deactivating ↔ DB clearance 的映射集中于本层；
 * readonly/cancelled 查询侧不支持过滤（契约无对应项），输出透传原文。
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infra/prisma.service';
import type { AccountListQuery } from './dto/account.dto';

/** user 表行（本模块消费字段集；不含 openid 等敏感字段，读侧绝不外泄 N6） */
export interface AccountRow {
  id: bigint;
  nickname: string;
  identity_type: string;
  status: string;
  banned_reason: string | null;
  banned_at: Date | null;
  created_at: Date;
}

/** 操作留痕行（admin_operation_log，target_type='user'） */
export interface AccountLogRow {
  id: bigint;
  admin_id: bigint;
  action: string;
  reason: string;
  detail: unknown;
  created_at: Date;
}

/** 契约 status → DB：deactivating→clearance；其余原样 */
export function toDbStatus(status: AccountListQuery['status'] & string): string {
  return status === 'deactivating' ? 'clearance' : status;
}

/** DB status → 契约：clearance→deactivating；readonly/cancelled 兜底原文透传 */
export function toContractStatus(dbStatus: string): string {
  return dbStatus === 'clearance' ? 'deactivating' : dbStatus;
}

@Injectable()
export class AccountRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 账号检索：keyword 昵称模糊、status（deactivating→clearance）、role→identity_type */
  async findPage(query: AccountListQuery): Promise<{ list: AccountRow[]; total: number }> {
    const where: Prisma.UserWhereInput = {};
    if (query.keyword !== undefined) where.nickname = { contains: query.keyword };
    if (query.status !== undefined) where.status = toDbStatus(query.status) as Prisma.UserWhereInput['status'];
    if (query.role !== undefined) where.identity_type = query.role as Prisma.UserWhereInput['identity_type'];
    const [list, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          nickname: true,
          identity_type: true,
          status: true,
          banned_reason: true,
          banned_at: true,
          created_at: true,
        },
      }) as Promise<AccountRow[]>,
      this.prisma.user.count({ where }),
    ]);
    return { list, total };
  }

  async findById(id: bigint): Promise<AccountRow | null> {
    return (await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        nickname: true,
        identity_type: true,
        status: true,
        banned_reason: true,
        banned_at: true,
        created_at: true,
      },
    })) as AccountRow | null;
  }

  /** 统计：发布数 / 订单数（买或卖）/ 被举报数 */
  async stats(userId: bigint): Promise<{ publish_count: number; order_count: number; report_count: number }> {
    const [publish, order, report] = await Promise.all([
      this.prisma.product.count({ where: { seller_id: userId } }),
      this.prisma.tradeOrder.count({ where: { OR: [{ buyer_id: userId }, { seller_id: userId }] } }),
      this.prisma.report.count({ where: { target_type: 'user', target_id: userId } }),
    ]);
    return { publish_count: publish, order_count: order, report_count: report };
  }

  /** 操作留痕（最新在前）；ban_info 取最近一条 account.ban 的 detail */
  async findLogs(userId: bigint, limit = 20): Promise<AccountLogRow[]> {
    return (await this.prisma.adminOperationLog.findMany({
      where: { target_type: 'user', target_id: userId },
      orderBy: { created_at: 'desc' },
      take: limit,
    })) as AccountLogRow[];
  }

  /** 封禁回写（@ac F21-AC2 处置即时生效；JwtAuthGuard 每请求校验 status 拦截） */
  async ban(id: bigint, reason: string, bannedAt: Date): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { status: 'banned', banned_reason: reason, banned_at: bannedAt },
    });
  }

  /** 解封回写：status=normal，清空封禁字段组 */
  async unban(id: bigint): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { status: 'normal', banned_reason: null, banned_at: null },
    });
  }

  /** 操作人昵称解析（admin_user 跨 schema 只读） */
  async findAdminNames(ids: bigint[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = (await this.prisma.adminUser.findMany({
      where: { id: { in: ids } },
      select: { id: true, username: true },
    })) as Array<{ id: bigint; username: string }>;
    return new Map(rows.map((r) => [r.id.toString(), r.username]));
  }
}
