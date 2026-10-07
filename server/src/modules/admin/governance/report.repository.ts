/**
 * report.repository.ts —— 举报治理（后台）数据访问（T-302）
 *
 * @module PIM-BC-05 举报（后台治理子域 admin/governance）
 * @model PIM-AG-08 举报聚合
 * @table report → PIM-AG-08（本聚合写）；
 *        product/user → 跨 schema 写（§5.3 #56 处置动作：下架/封禁回写，见方法注释）；
 *        admin_operation_log → 无聚合 BC-06（§4.27 不可变日志，仅 create）
 *
 * 口径：契约层 status='done' ↔ DB 枚举 'resolved' 的映射集中于本层
 * （schema ReportStatus 仅 pending/processing/resolved，契约 §5.3 #54/#56 用 done 口径）。
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infra/prisma.service';
import type { DisposalResult, QueueStatusFilter } from './dto/disposal.dto';

/** report 表行（本模块消费字段集；reporter_id 仅平台侧留存，读侧绝不外泄 @rule CIM-R-20） */
export interface ReportRow {
  id: bigint;
  reporter_id: bigint;
  target_type: string;
  target_id: bigint;
  category: string;
  content: string;
  evidence_urls: unknown;
  status: string;
  result: string | null;
  sla_level: string;
  sla_deadline: Date;
  is_timeout: boolean;
  handled_by: bigint | null;
  handled_at: Date | null;
  handle_note: string | null;
  created_at: Date;
  updated_at: Date;
}

/** 契约口径 'done' → DB 枚举 'resolved'；其余原样 */
export function toDbStatus(status: QueueStatusFilter | 'done'): string {
  return status === 'done' ? 'resolved' : status;
}

/** DB 枚举 'resolved' → 契约口径 'done'；其余原样 */
export function toContractStatus(dbStatus: string): string {
  return dbStatus === 'resolved' ? 'done' : dbStatus;
}

/** 处置回写数据（service 已完成校验与状态机判定） */
export interface DisposalUpdateData {
  result: DisposalResult;
  handledBy: bigint;
  handledAt: Date;
  handleNote: string | null;
}

/** SLA 超时升级日志数据（@rule CIM-R-21，admin_id=0n 系统占位） */
export interface SlaTimeoutLogData {
  reportId: bigint;
  slaDeadline: Date;
  reason: string;
}

@Injectable()
export class ReportRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * @api §5.3 #54 举报队列：status 可选过滤（契约 done→DB resolved），
   * 按 sla_deadline 升序（最紧迫优先），分页返回 {list,total}。
   */
  async findQueue(query: {
    status?: QueueStatusFilter;
    page: number;
    pageSize: number;
  }): Promise<{ list: ReportRow[]; total: number }> {
    const where: Record<string, unknown> = {};
    if (query.status !== undefined) where.status = toDbStatus(query.status);
    const [list, total] = await Promise.all([
      this.prisma.report.findMany({
        where,
        orderBy: { sla_deadline: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }) as Promise<ReportRow[]>,
      this.prisma.report.count({ where }),
    ]);
    return { list, total };
  }

  /** @api §5.3 #55/#56 按 ID 取举报（含 reporter_id，序列化层负责剥离） */
  async findById(id: bigint): Promise<ReportRow | null> {
    return (await this.prisma.report.findUnique({ where: { id } })) as ReportRow | null;
  }

  /**
   * 处置回写：status 置 DB 'resolved'（契约口径 'done'）+ result + handled_by/at + handle_note。
   */
  async updateForDisposal(id: bigint, data: DisposalUpdateData): Promise<ReportRow> {
    return (await this.prisma.report.update({
      where: { id },
      data: {
        status: 'resolved', // 契约口径 status='done' ↔ DB 枚举 resolved
        result: data.result,
        handled_by: data.handledBy,
        handled_at: data.handledAt,
        handle_note: data.handleNote,
      },
    })) as ReportRow;
  }

  /** 处置联动：取被举报商品（off_shelf 定位卖家用，跨 schema 只读） */
  async findProductById(id: bigint): Promise<{ id: bigint; seller_id: bigint; status: string } | null> {
    return (await this.prisma.product.findUnique({
      where: { id },
      select: { id: true, seller_id: true, status: true },
    })) as { id: bigint; seller_id: bigint; status: string } | null;
  }

  /**
   * 处置联动：商品下架（跨 schema 写：本聚合治理动作按 §5.3 #56 回写 product 聚合，
   * 架构未建模跨聚合事件，按契约同步直写口径，注释留痕）。
   */
  async offShelfProduct(id: bigint): Promise<void> {
    await this.prisma.product.update({
      where: { id },
      data: { status: 'off_sale' },
    });
  }

  /**
   * 处置联动：用户封禁（跨 schema 写：同上，按 §5.3 #56 回写 user 聚合，
   * banned_reason/banned_at 随单落库）。
   */
  async banUser(id: bigint, reason: string, bannedAt: Date): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { status: 'banned', banned_reason: reason, banned_at: bannedAt },
    });
  }

  /**
   * @rule CIM-R-21 SLA 超时升级日志（admin_operation_log 不可变日志，仅 create）；
   * admin_id=0n 为系统占位（定时任务无操作管理员，口径注明于 detail）。
   */
  async createSlaLog(data: SlaTimeoutLogData): Promise<void> {
    await this.prisma.adminOperationLog.create({
      data: {
        admin_id: 0n, // 系统占位：cron 自动升级，无人工操作员
        action: 'report.sla_timeout',
        target_type: 'report',
        target_id: data.reportId,
        reason: data.reason,
        detail: {
          system: true, // admin_id=0n 占位口径：本日志由 SLA 定时任务生成
          sla_deadline: data.slaDeadline.toISOString(),
        } as Prisma.InputJsonValue,
      },
    });
  }

  // ---------- SLA 扫描（@rule CIM-R-21，供 report-sla.cron 使用） ----------

  /** 扫描超时未标记的待办举报：status in [pending,processing] 且 sla_deadline ≤ now 且 is_timeout=false */
  async findSlaTimeoutCandidates(now: Date): Promise<ReportRow[]> {
    return (await this.prisma.report.findMany({
      where: {
        status: { in: ['pending', 'processing'] },
        sla_deadline: { lte: now },
        is_timeout: false,
      },
    })) as ReportRow[];
  }

  /** 回写超时标记 is_timeout=true（冗余标记，供队列/看板快速筛选） */
  async markTimeout(id: bigint): Promise<void> {
    await this.prisma.report.update({
      where: { id },
      data: { is_timeout: true },
    });
  }
}
