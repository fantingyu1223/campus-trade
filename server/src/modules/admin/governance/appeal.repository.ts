/**
 * appeal.repository.ts —— 申诉仲裁（后台）数据访问（§5.3 #65-67）
 *
 * @module PIM-BC-05 信任与治理（后台治理子域 admin/governance）
 * @model PIM-AG-09 申诉聚合
 * @table appeal → PIM-AG-09（本聚合写）；
 *        trade_order/product/user → 跨 schema 读写（裁决关联上下文与 linked_action
 *        处置联动回写，口径同 report.repository：架构未建模跨聚合事件，按契约
 *        同步直写并注释留痕）；
 *        admin_operation_log → 无聚合 BC-06（§4.27 不可变日志，仅 create）
 *
 * 口径：契约层 status='done' ↔ DB 枚举 resolved/expired 的映射集中于本层
 * （schema AppealStatus: pending/processing/resolved/expired；
 * 契约/前端口径 pending/processing/done，见 admin-web/src/api/appeal.ts）。
 * 契约层裁决 result（buyer_win/seller_win/both_warning/invalid）→
 * DB AppealResult（support/reject/partial）映射亦集中于本层。
 */
import { Injectable } from '@nestjs/common';
import { Prisma, AppealResult as PrismaAppealResult } from '@prisma/client';
import { PrismaService } from '@infra/prisma.service';
import type { AdjudicateResult, AppealListQuery, AppealStatusFilter } from './dto/appeal.dto';

/** appeal 表行（本模块消费字段集） */
export interface AppealRow {
  id: bigint;
  appellant_id: bigint;
  appeal_type: string;
  target_id: bigint;
  reason: string;
  evidence_urls: unknown;
  status: string;
  intervene_deadline: Date;
  valid_until: Date;
  result: string | null;
  handled_by: bigint | null;
  handled_at: Date | null;
  handle_note: string | null;
  created_at: Date;
  updated_at: Date;
}

/** 关联订单上下文（dispute 申诉 target_id → trade_order） */
export interface OrderContextRow {
  id: bigint;
  order_no: string;
  buyer_id: bigint;
  seller_id: bigint;
  product_id: bigint;
  product_title: string;
  amount: unknown;
  status: string;
}

/** 契约口径 'done' → DB 枚举过滤：resolved|expired 均属已结案；其余原样 */
export function toDbStatusWhere(status: AppealStatusFilter): string | { in: string[] } {
  return status === 'done' ? { in: ['resolved', 'expired'] } : status;
}

/** DB 枚举 → 契约口径：resolved/expired → 'done'；其余原样 */
export function toContractStatus(dbStatus: string): string {
  return dbStatus === 'resolved' || dbStatus === 'expired' ? 'done' : dbStatus;
}

/**
 * 契约裁决结果 → DB AppealResult 映射：
 * buyer_win（支持申诉方-买家）→ support；seller_win → reject；
 * both_warning → partial；invalid（申诉无效驳回）→ reject。
 * 契约原值由 admin_operation_log.detail 精确保留（裁决留痕）。
 */
export function toDbResult(result: AdjudicateResult): PrismaAppealResult {
  switch (result) {
    case 'buyer_win':
      return 'support';
    case 'both_warning':
      return 'partial';
    case 'seller_win':
    case 'invalid':
      return 'reject';
  }
}

/** 裁决回写数据（service 已完成校验与状态机判定） */
export interface AdjudicationUpdateData {
  dbResult: PrismaAppealResult;
  handledBy: bigint;
  handledAt: Date;
  handleNote: string;
}

@Injectable()
export class AppealRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * @api §5.3 #65 申诉队列：type/status 可选过滤（契约 done→DB resolved|expired），
   * 按 intervene_deadline 升序（48h 介入时限，最紧迫优先），分页返回 {list,total}。
   */
  async findQueue(query: AppealListQuery): Promise<{ list: AppealRow[]; total: number }> {
    const where: Record<string, unknown> = {};
    if (query.type !== undefined) where.appeal_type = query.type;
    if (query.status !== undefined) where.status = toDbStatusWhere(query.status);
    const [list, total] = await Promise.all([
      this.prisma.appeal.findMany({
        where,
        orderBy: { intervene_deadline: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }) as Promise<AppealRow[]>,
      this.prisma.appeal.count({ where }),
    ]);
    return { list, total };
  }

  /** @api §5.3 #66/#67 按 ID 取申诉 */
  async findById(id: bigint): Promise<AppealRow | null> {
    return (await this.prisma.appeal.findUnique({ where: { id } })) as AppealRow | null;
  }

  /** 批量取关联订单（队列 related_no 解析用，跨 schema 只读） */
  async findOrdersByIds(ids: bigint[]): Promise<OrderContextRow[]> {
    if (ids.length === 0) return [];
    return (await this.prisma.tradeOrder.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        order_no: true,
        buyer_id: true,
        seller_id: true,
        product_id: true,
        product_title: true,
        amount: true,
        status: true,
      },
    })) as OrderContextRow[];
  }

  /** 取单条关联订单（详情/裁决联动用，跨 schema 只读） */
  async findOrderById(id: bigint): Promise<OrderContextRow | null> {
    return (await this.prisma.tradeOrder.findUnique({
      where: { id },
      select: {
        id: true,
        order_no: true,
        buyer_id: true,
        seller_id: true,
        product_id: true,
        product_title: true,
        amount: true,
        status: true,
      },
    })) as OrderContextRow | null;
  }

  /** 批量取用户昵称（申诉人/被申诉对象展示用，跨 schema 只读） */
  async findUsersByIds(ids: bigint[]): Promise<Array<{ id: bigint; nickname: string }>> {
    if (ids.length === 0) return [];
    return (await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, nickname: true },
    })) as Array<{ id: bigint; nickname: string }>;
  }

  /** 处罚申诉上下文：target_id 指向处置记录（report 处置单，跨聚合只读，可能不存在） */
  async findReportById(
    id: bigint,
  ): Promise<{ id: bigint; result: string | null; handle_note: string | null; handled_at: Date | null } | null> {
    return (await this.prisma.report.findUnique({
      where: { id },
      select: { id: true, result: true, handle_note: true, handled_at: true },
    })) as { id: bigint; result: string | null; handle_note: string | null; handled_at: Date | null } | null;
  }

  /**
   * 裁决回写：status 置 DB 'resolved'（契约口径 'done'）+ result（DB 枚举）
   * + handled_by/at + handle_note。
   */
  async updateForAdjudication(id: bigint, data: AdjudicationUpdateData): Promise<AppealRow> {
    return (await this.prisma.appeal.update({
      where: { id },
      data: {
        status: 'resolved', // 契约口径 status='done' ↔ DB 枚举 resolved
        result: data.dbResult,
        handled_by: data.handledBy,
        handled_at: data.handledAt,
        handle_note: data.handleNote,
      },
    })) as AppealRow;
  }

  /**
   * 裁决留痕（@rule CIM-R-34 / PRD N9：操作人/时间/事由/结论，不可变日志仅 create）。
   * detail 保留契约原值 result/linked_action（DB 枚举映射有损，留痕为唯一精确事实源）。
   */
  async createAdjudicationLog(entry: {
    adminId: bigint;
    appealId: bigint;
    reason: string;
    detail: Record<string, unknown>;
  }): Promise<void> {
    await this.prisma.adminOperationLog.create({
      data: {
        admin_id: entry.adminId,
        action: 'appeal.adjudicate',
        target_type: 'appeal',
        target_id: entry.appealId,
        reason: entry.reason,
        detail: entry.detail as Prisma.InputJsonValue,
      },
    });
  }

  /** 处置联动：商品下架（跨 schema 写，口径同 report.repository.offShelfProduct） */
  async offShelfProduct(id: bigint): Promise<void> {
    await this.prisma.product.update({
      where: { id },
      data: { status: 'off_sale' },
    });
  }

  /** 处置联动：用户封禁（跨 schema 写，口径同 report.repository.banUser） */
  async banUser(id: bigint, reason: string, bannedAt: Date): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { status: 'banned', banned_reason: reason, banned_at: bannedAt },
    });
  }
}
