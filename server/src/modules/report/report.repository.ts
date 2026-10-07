/**
 * report.repository.ts —— 举报模块自含数据访问
 *
 * @table report → PIM-AG-08 举报聚合（本聚合写）；product/user/trade_order/want_buy/message 只读（目标存在性校验）
 * @module PIM-BC-05 举报
 * @model PIM-AG-08
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infra/prisma.service';
import type { ReportCategory, ReportTargetType, SlaLevel } from './dto/report.dto';

/** 建报入参（service 已完成校验、防刷与 SLA 派生计算） */
export interface CreateReportInput {
  reporterId: bigint;
  targetType: ReportTargetType;
  targetId: bigint;
  category: ReportCategory;
  content: string;
  evidenceUrls: string[];
  slaLevel: SlaLevel;
  slaDeadline: Date;
}

@Injectable()
export class ReportRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- 目标存在性校验（跨 schema 只读） ----------

  findProductById(id: bigint) {
    return this.prisma.product.findUnique({ where: { id } });
  }

  findUserById(id: bigint) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findOrderById(id: bigint) {
    return this.prisma.tradeOrder.findUnique({ where: { id } });
  }

  findWantBuyById(id: bigint) {
    return this.prisma.wantBuy.findUnique({ where: { id } });
  }

  findMessageById(id: bigint) {
    return this.prisma.message.findUnique({ where: { id } });
  }

  // ---------- 本聚合 ----------

  /** 防刷查询（EV-13）：同举报人 + 同对象（target_type+target_id）+ created_at ≥ since */
  findRecentReport(reporterId: bigint, targetType: ReportTargetType, targetId: bigint, since: Date) {
    return this.prisma.report.findFirst({
      where: {
        reporter_id: reporterId,
        target_type: targetType as never, // T-301 口径含 order/want_buy/message，Prisma 枚举待 schema 扩展（见模块头注释/交接说明）
        target_id: targetId,
        created_at: { gte: since },
      },
    });
  }

  /** 落库举报：reporter_id 仅平台侧留存，任何响应/读侧不输出（CIM-R-20） */
  createReport(input: CreateReportInput) {
    return this.prisma.report.create({
      data: {
        reporter_id: input.reporterId,
        target_type: input.targetType as never, // 同上：T-301 口径枚举，schema 扩展前类型层断言
        target_id: input.targetId,
        category: input.category,
        content: input.content,
        evidence_urls: input.evidenceUrls,
        status: 'pending',
        sla_level: input.slaLevel,
        sla_deadline: input.slaDeadline,
      },
    });
  }
}
