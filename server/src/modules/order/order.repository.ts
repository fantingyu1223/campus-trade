/**
 * order.repository.ts —— 订单模块自含数据访问
 *
 * @table trade_order/order_event/payment_record → PIM-AG-06 交易订单聚合
 * @module PIM-BC-04 交易订单
 *
 * 跨 schema 写入声明：
 *  - createOrderWithLock 在单事务内同时写 product（PIM-BC-02 商品聚合，锁单 on_sale→trading）
 *    与 trade_order/order_event/payment_record（本聚合）。两表同属一个 MySQL 库，
 *    本地事务可保证原子性；后续拆库时需改为 Saga/消息最终一致，此处已集中收口。
 *  - completeOrder 同理（product sold 回写 + trade_order completed + order_event 留痕）。
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infra/prisma.service';
import type { PaymentRecordPayload } from './payment-record.service';
import type { OrderStatusValue, TradeModeValue } from './dto/order.dto';

/** 活跃单口径：买家对同一商品存在未完成单即视为活跃（幂等去重范围） */
const ACTIVE_ORDER_STATUSES = ['pending_delivery', 'pending_confirm'] as const;

/** 建单事务入参（service 已完成校验与派生计算） */
export interface CreateOrderTxInput {
  orderNo: string;
  productId: bigint;
  productTitle: string;
  buyerId: bigint;
  sellerId: bigint;
  tradeMode: TradeModeValue;
  amount: string;
  meetTime: Date | null;
  timeoutDeadline: Date;
  intentId: bigint | null;
  payment: PaymentRecordPayload;
}

@Injectable()
export class OrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 按主键查商品（建单前置状态守卫读取，跨 schema 只读） */
  findProductById(id: bigint) {
    return this.prisma.product.findUnique({ where: { id } });
  }

  /** 幂等去重：buyer+product 活跃单查询（命中即复用，不重复建单） */
  findActiveOrder(buyerId: bigint, productId: bigint) {
    return this.prisma.tradeOrder.findFirst({
      where: {
        buyer_id: buyerId,
        product_id: productId,
        status: { in: [...ACTIVE_ORDER_STATUSES] },
      },
    });
  }

  /** 按主键查订单 */
  findOrderById(id: bigint) {
    return this.prisma.tradeOrder.findUnique({ where: { id } });
  }

  /** 订单支付通道（§6 对策 B 默认 offline_scan；无记录返回 null） */
  findPaymentRecord(orderId: bigint) {
    return this.prisma.paymentRecord.findFirst({ where: { order_id: orderId } });
  }

  /** 订单时间线（order_event 只增不改，按时间升序） */
  findEvents(orderId: bigint) {
    return this.prisma.orderEvent.findMany({
      where: { order_id: orderId },
      orderBy: { created_at: 'asc' },
    });
  }

  /**
   * @rule CIM-R-11 付款锁商品防超卖 + 全程留痕，四步写入同一事务：
   *  1) product.updateMany 原子锁单 on_sale → trading（并发安全，count=0 视为被抢锁）
   *  2) trade_order.create 初始五态 pending_delivery + timeout_deadline（CIM-R-12 兜底）
   *  3) order_event.create 建单留痕 from=null → pending_delivery
   *  4) payment_record.create §6 对策 B offline_scan 留痕
   * 锁单失败返回 null（由 service 抛 4003，事务整体回滚不落单）。
   *
   * 跨 schema 写入声明：步骤 1 写 product（PIM-BC-02），其余写本聚合，同库单事务原子。
   */
  createOrderWithLock(input: CreateOrderTxInput) {
    return this.prisma.$transaction(async (tx) => {
      const lock = await tx.product.updateMany({
        where: { id: input.productId, status: 'on_sale' },
        data: { status: 'trading' },
      });
      if (lock.count === 0) return null;

      const order = await tx.tradeOrder.create({
        data: {
          order_no: input.orderNo,
          trade_intent_id: input.intentId,
          product_id: input.productId,
          product_title: input.productTitle,
          buyer_id: input.buyerId,
          seller_id: input.sellerId,
          trade_mode: input.tradeMode,
          amount: input.amount,
          status: 'pending_delivery',
          meet_time: input.meetTime,
          timeout_deadline: input.timeoutDeadline,
        },
      });

      await tx.orderEvent.create({
        data: {
          order_id: order.id,
          from_status: null,
          to_status: 'pending_delivery',
          actor: 'buyer',
          actor_id: input.buyerId,
          note: null,
        },
      });

      // §6 支付对策 B：平台不经手资金，offline_scan 仅留痕
      await tx.paymentRecord.create({
        data: {
          order_id: order.id,
          channel: input.payment.channel,
          status: input.payment.status,
          amount: input.payment.amount,
        },
      });

      return order;
    });
  }

  /**
   * @statemachine PIM-SM-01 pending_confirm → completed（F34-AC2 当面自提标记已售完成）：
   *  1) trade_order.updateMany 原子迁移 + confirmed_at/completed_at 双时间戳（count=0 视为竞争失败）
   *  2) order_event.create 状态迁移留痕
   *  3) product.update 联动标记已售 sold + sold_buyer_id + sold_at
   * 返回是否迁移成功；false 时事务回滚，商品不会被误标已售。
   *
   * 跨 schema 写入声明：步骤 3 写 product（PIM-BC-02），与订单聚合同事务原子提交。
   */
  async completeOrder(input: { orderId: bigint; productId: bigint; buyerId: bigint; at: Date }) {
    return this.prisma.$transaction(async (tx) => {
      const migrated = await tx.tradeOrder.updateMany({
        where: { id: input.orderId, status: 'pending_confirm' },
        data: { status: 'completed', confirmed_at: input.at, completed_at: input.at },
      });
      if (migrated.count === 0) return false;

      await tx.orderEvent.create({
        data: {
          order_id: input.orderId,
          from_status: 'pending_confirm',
          to_status: 'completed',
          actor: 'buyer',
          actor_id: input.buyerId,
          note: null,
        },
      });

      // 跨 schema 写入声明：联动商品聚合标记已售（F34-AC2）
      await tx.product.update({
        where: { id: input.productId },
        data: { status: 'sold', sold_buyer_id: input.buyerId, sold_at: input.at },
      });

      return true;
    });
  }

  /**
   * @statemachine PIM-SM-01 取消子状态 none → requested（主状态不变，字段组承载）：
   *  1) trade_order.updateMany 原子占位（限未确认收货态 + 无进行中取消），count=0 视为竞争失败
   *  2) order_event.create 留痕 from=to=原主状态（子状态迁移，note 记录取消原因）
   * @rule CIM-R-15 24h 响应窗口（cancel_deadline 由 service 计算传入）
   */
  async requestCancel(input: {
    orderId: bigint;
    initiatorId: bigint;
    initiatorRole: 'buyer' | 'seller';
    fromStatus: OrderStatusValue;
    reason: string | null;
    requestedAt: Date;
    deadline: Date;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const placed = await tx.tradeOrder.updateMany({
        where: {
          id: input.orderId,
          status: { in: ['pending_delivery', 'pending_confirm'] },
          cancel_initiator_id: null,
        },
        data: {
          cancel_initiator_id: input.initiatorId,
          cancel_requested_at: input.requestedAt,
          cancel_deadline: input.deadline,
          cancel_reason: input.reason,
        },
      });
      if (placed.count === 0) return false;

      await tx.orderEvent.create({
        data: {
          order_id: input.orderId,
          from_status: input.fromStatus,
          to_status: input.fromStatus,
          actor: input.initiatorRole,
          actor_id: input.initiatorId,
          note: input.reason ?? '发起取消',
        },
      });

      return true;
    });
  }

  /**
   * @statemachine PIM-SM-01 取消子状态 requested → agreed，主状态迁移 cancelled（终态）：
   *  1) trade_order.updateMany 原子迁移（须存在未响应取消），count=0 视为竞争失败
   *  2) order_event.create 留痕 原主状态 → cancelled
   *  3) payment_record 退款留痕：对策 B 线下自行协商退回 + 平台监督留痕（平台不经手资金）
   *  4) product.updateMany 恢复上架（跨 schema 写入 @rule CIM-R-17）
   * @rule CIM-R-15/CIM-R-16/CIM-R-17 @event PIM-EV-05
   *
   * 跨 schema 写入声明：步骤 4 写 product（PIM-BC-02），与订单聚合同库单事务原子提交。
   */
  async agreeCancel(input: {
    orderId: bigint;
    productId: bigint;
    responderId: bigint;
    responderRole: 'buyer' | 'seller';
    fromStatus: OrderStatusValue;
    amount: string;
    at: Date;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const migrated = await tx.tradeOrder.updateMany({
        where: {
          id: input.orderId,
          status: { in: ['pending_delivery', 'pending_confirm'] },
          cancel_initiator_id: { not: null },
        },
        data: { status: 'cancelled', cancelled_at: input.at },
      });
      if (migrated.count === 0) return false;

      await tx.orderEvent.create({
        data: {
          order_id: input.orderId,
          from_status: input.fromStatus,
          to_status: 'cancelled',
          actor: input.responderRole,
          actor_id: input.responderId,
          note: '同意取消',
        },
      });

      // @rule CIM-R-16 + §6 对策 B：退款原路退回留痕口径——线下自行协商退回，平台监督留痕不经手资金
      await tx.paymentRecord.updateMany({
        where: { order_id: input.orderId, status: { not: 'refunded' } },
        data: {
          status: 'refunded',
          refund_status: 'success',
          refund_amount: input.amount,
          refund_requested_at: input.at,
          refunded_at: input.at,
        },
      });

      // 跨 schema 写入声明：@rule CIM-R-17 取消成功商品自动恢复上架（trading → on_sale）
      await tx.product.updateMany({
        where: { id: input.productId, status: 'trading' },
        data: { status: 'on_sale' },
      });

      return true;
    });
  }

  /**
   * @statemachine PIM-SM-01 取消子状态 requested → rejected，主状态不变回原态（裁决 3）：
   *  1) trade_order.updateMany 清取消字段组 + 保留拒绝说明 cancel_reject_note，count=0 视为竞争失败
   *  2) order_event.create 留痕 from=to=原主状态（子状态迁移，交易继续）
   * @rule CIM-R-15 拒绝取消订单回到原状态并留痕
   */
  async rejectCancel(input: {
    orderId: bigint;
    responderId: bigint;
    responderRole: 'buyer' | 'seller';
    fromStatus: OrderStatusValue;
    note: string | null;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const cleared = await tx.tradeOrder.updateMany({
        where: { id: input.orderId, cancel_initiator_id: { not: null } },
        data: {
          cancel_initiator_id: null,
          cancel_requested_at: null,
          cancel_deadline: null,
          cancel_reason: null,
          cancel_reject_note: input.note,
        },
      });
      if (cleared.count === 0) return false;

      await tx.orderEvent.create({
        data: {
          order_id: input.orderId,
          from_status: input.fromStatus,
          to_status: input.fromStatus,
          actor: input.responderRole,
          actor_id: input.responderId,
          note: input.note ?? '拒绝取消，订单回到原状态',
        },
      });

      return true;
    });
  }

  /**
   * @statemachine PIM-SM-01 pending_confirm → cancelled（@rule CIM-R-19 现场拒收即取消）：
   *  1) trade_order.updateMany 原子迁移 + 拒收留痕（时间落 cancel_requested_at、说明落 cancel_reason）
   *  2) order_event.create 留痕 pending_confirm → cancelled（note 含拒收说明）
   *  3) payment_record 退款留痕：对策 B 线下自行协商退回 + 平台监督留痕（同 agree 路径）
   *  4) product.updateMany 恢复上架（跨 schema 写入 @rule CIM-R-17）
   * @rule CIM-R-15/CIM-R-16/CIM-R-17/CIM-R-18/CIM-R-19 @event PIM-EV-05
   *
   * 跨 schema 写入声明：步骤 4 写 product（PIM-BC-02），与订单聚合同库单事务原子提交。
   */
  async rejectOnsiteCancel(input: {
    orderId: bigint;
    productId: bigint;
    buyerId: bigint;
    rejectTime: Date;
    reason: string;
    amount: string;
    at: Date;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const migrated = await tx.tradeOrder.updateMany({
        where: { id: input.orderId, status: 'pending_confirm' },
        data: {
          status: 'cancelled',
          cancelled_at: input.at,
          cancel_initiator_id: input.buyerId,
          cancel_requested_at: input.rejectTime,
          cancel_reason: input.reason,
        },
      });
      if (migrated.count === 0) return false;

      await tx.orderEvent.create({
        data: {
          order_id: input.orderId,
          from_status: 'pending_confirm',
          to_status: 'cancelled',
          actor: 'buyer',
          actor_id: input.buyerId,
          note: '现场拒收：' + input.reason,
        },
      });

      // @rule CIM-R-16 + §6 对策 B：退款原路退回留痕口径——线下自行协商退回，平台监督留痕不经手资金
      await tx.paymentRecord.updateMany({
        where: { order_id: input.orderId, status: { not: 'refunded' } },
        data: {
          status: 'refunded',
          refund_status: 'success',
          refund_amount: input.amount,
          refund_requested_at: input.at,
          refunded_at: input.at,
        },
      });

      // 跨 schema 写入声明：@rule CIM-R-17 取消成功商品自动恢复上架（trading → on_sale）
      await tx.product.updateMany({
        where: { id: input.productId, status: 'trading' },
        data: { status: 'on_sale' },
      });

      return true;
    });
  }

  /**
   * @rule CIM-R-15 取消超时扫描（idx_cancel_deadline）：
   * cancel_deadline ≤ now 且取消子状态 requested（cancel_initiator_id 非空）
   * 且主状态未确认收货 → 由超时 cron 默认同意。
   */
  findCancelTimeoutOrders(now: Date) {
    return this.prisma.tradeOrder.findMany({
      where: {
        cancel_deadline: { lte: now },
        cancel_initiator_id: { not: null },
        status: { in: ['pending_delivery', 'pending_confirm'] },
      },
    });
  }

  /**
   * @rule CIM-R-12 确认收货超时扫描（idx_status_deadline）：
   * timeout_deadline ≤ now 且 status=pending_confirm → 由超时 cron 自动确认。
   */
  findConfirmTimeoutOrders(now: Date) {
    return this.prisma.tradeOrder.findMany({
      where: { timeout_deadline: { lte: now }, status: 'pending_confirm' },
    });
  }

  /**
   * @rule CIM-R-15 取消 24h 超时默认同意（actor 'system'，与 agreeCancel 同写入集）：
   *  1) trade_order.updateMany 原子迁移 cancelled（须仍存在未响应取消且已超时），count=0 视为竞争失败
   *  2) order_event.create 留痕 原主状态 → cancelled，actor 'system'（actor_id=0）
   *  3) payment_record 退款留痕：对策 B 线下自行协商退回 + 平台监督留痕（平台不经手资金）
   *  4) product.updateMany 恢复上架（跨 schema 写入 @rule CIM-R-17）
   * @rule CIM-R-16/CIM-R-17 @event PIM-EV-05
   *
   * 跨 schema 写入声明：步骤 4 写 product（PIM-BC-02），与订单聚合同库单事务原子提交。
   */
  async systemAgreeCancel(input: {
    orderId: bigint;
    productId: bigint;
    fromStatus: OrderStatusValue;
    amount: string;
    at: Date;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const migrated = await tx.tradeOrder.updateMany({
        where: {
          id: input.orderId,
          status: { in: ['pending_delivery', 'pending_confirm'] },
          cancel_initiator_id: { not: null },
          cancel_deadline: { lte: input.at },
        },
        data: { status: 'cancelled', cancelled_at: input.at },
      });
      if (migrated.count === 0) return false;

      await tx.orderEvent.create({
        data: {
          order_id: input.orderId,
          from_status: input.fromStatus,
          to_status: 'cancelled',
          actor: 'system',
          actor_id: BigInt(0),
          note: '取消响应超时（24h），系统默认同意',
        },
      });

      // @rule CIM-R-16 + §6 对策 B：退款原路退回留痕口径——线下自行协商退回，平台监督留痕不经手资金
      await tx.paymentRecord.updateMany({
        where: { order_id: input.orderId, status: { not: 'refunded' } },
        data: {
          status: 'refunded',
          refund_status: 'success',
          refund_amount: input.amount,
          refund_requested_at: input.at,
          refunded_at: input.at,
        },
      });

      // 跨 schema 写入声明：@rule CIM-R-17 取消成功商品自动恢复上架（trading → on_sale）
      await tx.product.updateMany({
        where: { id: input.productId, status: 'trading' },
        data: { status: 'on_sale' },
      });

      return true;
    });
  }

  /**
   * @rule CIM-R-12 确认收货 48h 超时自动确认（actor 'system'，与 completeOrder 同写入集）：
   *  1) trade_order.updateMany 原子迁移 completed + confirmed_at/completed_at 双时间戳
   *     （须仍 pending_confirm 且已超时），count=0 视为竞争失败
   *  2) order_event.create 留痕 pending_confirm → completed，actor 'system'（actor_id=0）
   *  3) product.update 联动标记已售 sold + sold_buyer_id + sold_at
   * @ac F34-AC2（超时自动确认走同一已售口径）
   *
   * 跨 schema 写入声明：步骤 3 写 product（PIM-BC-02），与订单聚合同库单事务原子提交。
   */
  async systemCompleteOrder(input: {
    orderId: bigint;
    productId: bigint;
    buyerId: bigint;
    at: Date;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const migrated = await tx.tradeOrder.updateMany({
        where: { id: input.orderId, status: 'pending_confirm', timeout_deadline: { lte: input.at } },
        data: { status: 'completed', confirmed_at: input.at, completed_at: input.at },
      });
      if (migrated.count === 0) return false;

      await tx.orderEvent.create({
        data: {
          order_id: input.orderId,
          from_status: 'pending_confirm',
          to_status: 'completed',
          actor: 'system',
          actor_id: BigInt(0),
          note: '确认收货超时（48h），系统自动确认',
        },
      });

      // 跨 schema 写入声明：联动商品聚合标记已售（F34-AC2，与 #32 确认收货同口径）
      await tx.product.update({
        where: { id: input.productId },
        data: { status: 'sold', sold_buyer_id: input.buyerId, sold_at: input.at },
      });

      return true;
    });
  }
}
