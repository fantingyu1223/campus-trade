/**
 * review-default.cron.ts —— 超时默认好评定时调度（自含，不依赖 @nestjs/schedule）
 *
 * @module PIM-BC-05 交易评价
 * @rule F17 超时默认好评：每 24h 扫描一轮，驱动 ReviewService.applyDefaultReviews
 * 开关：env REVIEW_DEFAULT_CRON_ENABLED==='1' 时 onModuleInit 自动启动；缺省不启动
 * （测试/开发环境默认关闭，避免悬挂定时器）。
 */
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ReviewService } from './review.service';

/** 调度周期：24h */
const INTERVAL_MS = 24 * 3600 * 1000;

@Injectable()
export class ReviewDefaultCron implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly reviewService: ReviewService) {}

  onModuleInit(): void {
    if (process.env.REVIEW_DEFAULT_CRON_ENABLED === '1') {
      this.start();
    }
  }

  onModuleDestroy(): void {
    this.stop();
  }

  /** 启动 24h 轮询（幂等：重复调用不叠加定时器） */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runOnce();
    }, INTERVAL_MS);
  }

  /** 停止轮询（幂等） */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  /** 单轮执行：异常吞掉（记录于日志预留），等待下一轮重试，不中断调度 */
  private async runOnce(): Promise<void> {
    try {
      await this.reviewService.applyDefaultReviews();
    } catch {
      // 本轮失败不抛出，下轮（24h 后）自愈重试
    }
  }
}
