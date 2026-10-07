/**
 * wantbuy-expire.cron.ts —— 求购到期提醒与自动失效定时调度（自含，不依赖 @nestjs/schedule）
 *
 * @module PIM-BC-02 商品与供给（求购子域）
 * @model PIM-AG-04 求购聚合（值对象 ValidityPeriod 含第 27 天提醒点）
 * @statemachine PIM-SM-03 求购状态机：
 *   active → expired（有效期届满未续期，由本 cron 处置）；expired 为终态，
 *   到达后停止一切撮合通知、不可复活（CIM-R-33）。
 * @event PIM-EV-12 求购到期提醒（第 27 天触发；提醒为纯通知动作，不改变状态，不建模为状态迁移）
 * @rule CIM-R-33 默认有效期 30 天，续期每次 +30 天不限次；到期前 3 天提醒
 * @ac F9-AC2 第 27 天发到期提醒；第 30 天未续期则求购失效并停止撮合
 *
 * 口径：
 * - 提醒窗口：expire_at-3d ≤ now < expire_at（即 now < expire_at ≤ now+3d），窗口右界含端点。
 * - 「未提醒过」判重：当前有效期（periodStart = expire_at - 30 天，续期重置后为新周期）
 *   内已存在 want_buy_expire 通知（按 payload.want_buy_id）则跳过，避免 3 天窗口内每日重复提醒。
 * - expire_at ≤ now（含恰到期边界）→ 置 expired；「未续期」由 active + expire_at≤now 蕴含
 *   （续期会将 expire_at 重置为未来时间）。
 * - 调度：每 24h 一轮（§2.4 定时任务与主进程合一）；env WANT_BUY_EXPIRE_CRON_ENABLED==='1'
 *   时 onModuleInit 自动启动，缺省不启动（同 review-default.cron 口径，避免测试悬挂定时器）。
 * - 单条处理异常逐条隔离，不中断本轮其余求购；整轮异常吞掉，下轮自愈。
 */
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { NotificationType, WantBuyStatus } from '@contract/index';
import { PrismaService } from '@infra/prisma.service';
import { NotifySenderService } from '@infra/notify-sender/notify-sender.service';

/** 调度周期：24h */
const INTERVAL_MS = 24 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;
/** 到期提醒窗口宽度：3 天（F9-AC2 / CIM-R-33） */
const REMIND_WINDOW_DAYS = 3;
/** 有效期长度：30 天（CIM-R-33 / PSM-INC-02），用于当前有效期判重起点 */
const VALIDITY_DAYS = 30;

@Injectable()
export class WantBuyExpireCron implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotifySenderService,
  ) {}

  onModuleInit(): void {
    if (process.env.WANT_BUY_EXPIRE_CRON_ENABLED === '1') {
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

  /**
   * 单轮日扫：扫描 active 且 expire_at ≤ now+3d 的求购——
   * 提醒窗口内且未提醒过 → 发 want_buy_expire 通知（@event PIM-EV-12）；
   * expire_at ≤ now → 置 expired（@statemachine PIM-SM-03 active → expired，停止撮合）。
   */
  async runDaily(now: Date = new Date()): Promise<void> {
    const windowEnd = new Date(now.getTime() + REMIND_WINDOW_DAYS * DAY_MS);
    const rows = await this.prisma.wantBuy.findMany({
      where: {
        status: WantBuyStatus.ACTIVE,
        expire_at: { lte: windowEnd },
      },
    });

    for (const row of rows) {
      try {
        await this.processOne(row, now);
      } catch {
        // 单条失败不中断本轮其余求购，下轮重试
      }
    }
  }

  /** 单轮执行：整轮异常吞掉（记录于日志预留），等待下一轮重试，不中断调度 */
  private async runOnce(): Promise<void> {
    try {
      await this.runDaily();
    } catch {
      // 本轮失败不抛出，下轮（24h 后）自愈重试
    }
  }

  /** 逐条处置：非 active 防御跳过；到期置 expired；窗口内未提醒发提醒 */
  private async processOne(
    row: { id: bigint; user_id: bigint; status: string; expire_at: Date },
    now: Date,
  ): Promise<void> {
    // @statemachine PIM-SM-03：closed/bought/expired 终态不可复活、不重复处理
    if (row.status !== WantBuyStatus.ACTIVE) return;

    if (row.expire_at.getTime() <= now.getTime()) {
      // active → expired：有效期届满未续期，停止一切撮合（撮合侧仅消费 active 未过期）
      await this.prisma.wantBuy.update({
        where: { id: row.id },
        data: { status: WantBuyStatus.EXPIRED },
      });
      return;
    }

    // 提醒窗口：now < expire_at ≤ now+3d（@event PIM-EV-12，提醒不改变状态）
    const reminded = await this.hasReminded(row);
    if (reminded) return;
    await this.notify.send({
      user_id: row.user_id,
      type: NotificationType.WANT_BUY_EXPIRE,
      title: '你的求购将于 3 天内到期，可前往续期',
      payload: { want_buy_id: row.id.toString() },
    });
  }

  /**
   * 判重：当前有效期（periodStart = expire_at - 30 天；续期重置 expire_at 后周期顺延，
   * 旧周期提醒自然落在新 periodStart 之前）内是否已存在本条求购的 want_buy_expire 通知。
   */
  private async hasReminded(row: { id: bigint; expire_at: Date }): Promise<boolean> {
    const periodStart = new Date(row.expire_at.getTime() - VALIDITY_DAYS * DAY_MS);
    const existing = await this.prisma.notification.findFirst({
      where: {
        type: NotificationType.WANT_BUY_EXPIRE,
        payload: { path: 'want_buy_id', equals: row.id.toString() },
        created_at: { gte: periodStart },
      },
    });
    return existing !== null;
  }
}
