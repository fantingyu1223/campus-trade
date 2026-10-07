/**
 * report-sla.cron.ts —— 举报 SLA 超时扫描定时任务（T-302）
 *
 * @module PIM-BC-05 信任与治理
 * @model PIM-AG-08 举报聚合
 * @rule CIM-R-21
 *
 * 自含调度：REPORT_SLA_CRON_ENABLED==='1' 时 start() 生效，24h 周期扫描；
 * runOnce(now) 可独立调用（测试/手动触发）。
 * admin_operation_log 的 admin_id=0n 为系统占位口径（cron 无人工操作员）。
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infra/prisma.service';
import { ReportRepository } from './report.repository';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ReportSlaCron {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: ReportRepository,
  ) {}

  /** 启动调度（env REPORT_SLA_CRON_ENABLED==='1' 才生效） */
  start(): void {
    if (this.timer || process.env.REPORT_SLA_CRON_ENABLED !== '1') return;
    this.timer = setInterval(() => {
      void this.runOnce().catch(() => undefined);
    }, DAY_MS);
    this.timer.unref?.();
  }

  /** 停止调度 */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 调度是否在运行 */
  isRunning(): boolean {
    return this.timer !== null;
  }

  /**
   * 扫描一轮：status in [pending,processing] 且 sla_deadline ≤ now 且 is_timeout=false
   * → 逐条标记 is_timeout=true + 写超时升级日志（admin_id=0n 系统占位）。
   */
  async runOnce(now = new Date()): Promise<number> {
    const candidates = await this.prisma.report.findMany({
      where: {
        status: { in: ['pending', 'processing'] },
        sla_deadline: { lte: now },
        is_timeout: false,
      },
      select: { id: true },
    });

    for (const c of candidates as Array<{ id: bigint }>) {
      await this.prisma.report.update({
        where: { id: c.id },
        data: { is_timeout: true },
      });
      await this.repo.createSlaLog({
        reportId: c.id,
        slaDeadline: now,
        reason: `举报 SLA 超时升级：#${c.id} 已过 sla_deadline，请尽快处理`,
      });
    }
    return candidates.length;
  }
}
