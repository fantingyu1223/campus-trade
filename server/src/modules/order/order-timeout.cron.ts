/**
 * order-timeout.cron.ts —— 订单超时定时调度（自含，不依赖 @nestjs/schedule）
 *
 * @module PIM-BC-04 交易订单
 * @model PIM-AG-06 交易订单聚合
 * @statemachine PIM-SM-01 订单状态机：
 *   取消超时（@rule CIM-R-15）：cancel_deadline ≤ now 且取消子状态 requested
 *     （cancel_initiator_id 非空）且主状态 ∈ [pending_delivery, pending_confirm]
 *     → 默认同意 → cancelled（终态）+ cancelled_at + order_event(actor 'system')
 *     + payment 退款留痕口径（status 'refunded' / refund_status 'success'，对策 B 不经手资金）
 *     + product 恢复上架（on_sale，跨 schema 写入 @rule CIM-R-17，声明见 repository）；
 *   确认收货超时（@rule CIM-R-12）：timeout_deadline ≤ now 且 status = pending_confirm
 *     → 自动确认 → completed（终态）+ completed_at + order_event(actor 'system')
 *     + product sold + sold_buyer_id + sold_at（跨 schema 写入，声明见 repository）。
 * @rule CIM-R-19 超时调度自含：进程内 cron（§2.4 定时任务与主进程合一），
 *   start/stop 幂等、isRunning 可查；单条订单处理异常逐条隔离，不中断本轮其余订单。
 * @event PIM-EV-05 订单已取消（副作用：product 回 on_sale）
 *
 * 调度口径：
 * - 每小时一轮（同 §6 违规处置每小时扫描的进程内 cron 惯例）；
 *   env ORDER_TIMEOUT_CRON_ENABLED==='1' 时 onModuleInit 自动启动，缺省不启动
 *   （同 wantbuy-expire.cron / review-default.cron 口径，避免测试悬挂定时器）。
 * - deadline 恰等于 now 即触发（lte 含端点）。
 */
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { OrderRepository } from './order.repository';
import type { OrderStatusValue } from './dto/order.dto';

/** 调度周期：1h */
const INTERVAL_MS = 3600 * 1000;

type TimeoutOrderRow = NonNullable<
  Awaited<ReturnType<OrderRepository['findOrderById']>>
>;

@Injectable()
export class OrderTimeoutCron implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly repo: OrderRepository) {}

  onModuleInit(): void {
    if (process.env.ORDER_TIMEOUT_CRON_ENABLED === '1') {
      this.start();
    }
  }

  onModuleDestroy(): void {
    this.stop();
  }

  /** 启动 1h 轮询（幂等：重复调用不叠加定时器） */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.runOnce().catch(() => {
        // 本轮失败不抛出，下轮（1h 后）自愈重试
      });
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
   * 单轮执行：依次跑取消超时扫描（@rule CIM-R-15）与确认收货超时扫描（@rule CIM-R-12）。
   * 单条订单异常逐条隔离，不中断本轮其余订单（原子迁移 count=0 即竞态被抢，安全跳过）。
   */
  async runOnce(now: Date = new Date()): Promise<void> {
    await this.scanCancelTimeout(now);
    await this.scanConfirmTimeout(now);
  }

  /** @rule CIM-R-15：取消 24h 超时默认同意扫描（idx_cancel_deadline） */
  private async scanCancelTimeout(now: Date): Promise<void> {
    const rows = await this.repo.findCancelTimeoutOrders(now);
    for (const row of rows) {
      try {
        await this.applyCancelTimeout(row, now);
      } catch {
        // 单条失败不中断本轮其余订单，下轮重试
      }
    }
  }

  /** @rule CIM-R-12：确认收货 48h 超时自动确认扫描（idx_status_deadline） */
  private async scanConfirmTimeout(now: Date): Promise<void> {
    const rows = await this.repo.findConfirmTimeoutOrders(now);
    for (const row of rows) {
      try {
        await this.applyConfirmTimeout(row, now);
      } catch {
        // 单条失败不中断本轮其余订单，下轮重试
      }
    }
  }

  /** 取消超时逐条处置：防御性校验（竞态下 deadline 可能已被响应方清空/顺延）后默认同意 */
  private async applyCancelTimeout(row: TimeoutOrderRow, now: Date): Promise<void> {
    if (row.cancel_initiator_id === null || row.cancel_deadline === null) return;
    if (row.cancel_deadline.getTime() > now.getTime()) return;
    if (row.status !== 'pending_delivery' && row.status !== 'pending_confirm') return;

    await this.repo.systemAgreeCancel({
      orderId: row.id,
      productId: row.product_id,
      fromStatus: row.status as OrderStatusValue,
      amount: String(row.amount),
      at: now,
    });
  }

  /** 确认超时逐条处置：防御性校验后自动确认收货 */
  private async applyConfirmTimeout(row: TimeoutOrderRow, now: Date): Promise<void> {
    if (row.status !== 'pending_confirm') return;
    if (row.timeout_deadline === null || row.timeout_deadline.getTime() > now.getTime()) return;

    await this.repo.systemCompleteOrder({
      orderId: row.id,
      productId: row.product_id,
      buyerId: row.buyer_id,
      at: now,
    });
  }
}
