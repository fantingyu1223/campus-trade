/**
 * merchant-sla.cron.ts —— 商家入驻审核 SLA 超时升级（T-306）
 * @module PIM-AG-10
 *
 * 每日扫描 pending 且已过 sla_deadline 的申请，以超时留痕日志
 * 作为超时标记与升级通知（admin_id=0n 系统占位）；幂等：已标记跳过。
 *
 * 自含调度：env MERCHANT_SLA_CRON_ENABLED==='1' 时 start() 生效，24h 一轮。
 */
import { Injectable, Logger } from '@nestjs/common';
import { MerchantReviewRepository } from './merchant-review.repository';

const DAY_MS = 24 * 3600 * 1000;

@Injectable()
export class MerchantSlaCron {
  private readonly logger = new Logger(MerchantSlaCron.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly repo: MerchantReviewRepository) {}

  start(): void {
    if (process.env.MERCHANT_SLA_CRON_ENABLED !== '1') return;
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.runDaily().catch((e) => this.logger.error(`merchant sla scan failed: ${e}`));
    }, DAY_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  /** 返回本次新标记的超时条数（已有标记的跳过，保证幂等） */
  async runDaily(now: Date = new Date()): Promise<number> {
    const overdue = await this.repo.findOverduePending(now);
    let marked = 0;
    for (const row of overdue as { id: bigint }[]) {
      const existing = await this.repo.findTimeoutMarker(row.id);
      if (existing) continue;
      // 以超时留痕日志作为超时标记与升级通知，admin_id=0n 系统占位
      await this.repo.createTimeoutMarker({
        admin_id: 0n,
        action: 'merchant_review.sla_timeout',
        target_type: 'merchant_application',
        target_id: row.id,
        reason:
          '商家入驻审核 SLA 超时升级通知：申请 #' +
          row.id +
          ' 已过 sla_deadline，请尽快处理',
      });
      marked += 1;
    }
    return marked;
  }
}
