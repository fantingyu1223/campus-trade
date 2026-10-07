/**
 * order-timeout.spec.ts —— T-208 订单超时 cron（取消 24h 默认同意 / 确认收货 48h 自动确认）
 *
 * @module PIM-BC-04 交易订单
 * @model PIM-AG-06 交易订单聚合
 * @statemachine PIM-SM-01 订单状态机：
 *   取消超时：pending_delivery/pending_confirm（取消子状态 requested）→ cancelled（终态）；
 *   确认超时：pending_confirm → completed（终态）。
 * @rule CIM-R-15 取消 24h 未响应默认同意 / CIM-R-12 48h 超时兜底自动确认 /
 *       CIM-R-16 退款原路退回（对策 B 留痕口径）/ CIM-R-17 取消成功商品恢复上架 /
 *       CIM-R-19 超时调度自含 start/stop 幂等
 * @event PIM-EV-05 订单已取消（副作用：product 回 on_sale）
 *
 * 覆盖验收点：
 *  - 取消超时：cancel_deadline≤now → cancelled+cancelled_at + order_event(actor 'system') +
 *    payment refunded/refund_status success + product 恢复 on_sale
 *  - 取消未超时：不处理（查询口径 lte now + 防御跳过，无事务写入）
 *  - 确认超时：timeout_deadline≤now 且 pending_confirm → completed+completed_at +
 *    order_event(actor 'system') + product sold+sold_buyer_id+sold_at
 *  - 确认未超时：不处理
 *  - deadline 恰等于 now：触发（lte 含端点）
 *  - start/stop 调度幂等：重复 start 不叠加定时器，stop 幂等，isRunning 反映状态
 *
 * 无真实 MySQL：PrismaService 一律 jest mock。
 */
import { OrderTimeoutCron } from '../../src/modules/order/order-timeout.cron';
import { OrderRepository } from '../../src/modules/order/order.repository';
import { PrismaService } from '../../src/infra/prisma.service';

// ---------- 测试夹具 ----------

const BUYER_ID = BigInt(2);
const SELLER_ID = BigInt(1);
const SYSTEM_ACTOR_ID = BigInt(0);
const ORDER_ID = BigInt(9001);
const PRODUCT_ID = BigInt(100);
const NOW = new Date('2026-10-06T08:00:00.000Z');

const makeOrderRow = (over: Record<string, unknown> = {}) => ({
  id: ORDER_ID,
  order_no: 'ES20261006ABC123',
  trade_intent_id: null,
  product_id: PRODUCT_ID,
  product_title: '高等数学（下册）',
  buyer_id: BUYER_ID,
  seller_id: SELLER_ID,
  trade_mode: 'online_pay',
  amount: '25.00',
  status: 'pending_confirm',
  meet_time: null,
  timeout_deadline: new Date('2026-10-08T08:00:00.000Z'),
  cancel_initiator_id: null,
  cancel_requested_at: null,
  cancel_deadline: null,
  cancel_reason: null,
  cancel_reject_note: null,
  confirmed_at: null,
  completed_at: null,
  cancelled_at: null,
  created_at: NOW,
  updated_at: NOW,
  ...over,
});

/** 取消子状态 requested 且 cancel_deadline 已过（24h 超时） */
const makeCancelExpiredRow = (over: Record<string, unknown> = {}) =>
  makeOrderRow({
    status: 'pending_delivery',
    cancel_initiator_id: BUYER_ID,
    cancel_requested_at: new Date('2026-10-05T07:00:00.000Z'),
    cancel_deadline: new Date('2026-10-06T07:00:00.000Z'), // ≤ NOW
    cancel_reason: '临时不需要了',
    ...over,
  });

const makePrismaMock = () =>
  ({
    product: { update: jest.fn(), updateMany: jest.fn() },
    tradeOrder: { findMany: jest.fn(), updateMany: jest.fn() },
    orderEvent: { create: jest.fn() },
    paymentRecord: { updateMany: jest.fn() },
    $transaction: jest.fn(),
  }) as unknown as PrismaService & {
    product: { update: jest.Mock; updateMany: jest.Mock };
    tradeOrder: { findMany: jest.Mock; updateMany: jest.Mock };
    orderEvent: { create: jest.Mock };
    paymentRecord: { updateMany: jest.Mock };
    $transaction: jest.Mock;
  };

const setup = () => {
  const prisma = makePrismaMock();
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
  prisma.tradeOrder.findMany.mockResolvedValue([]);
  const repo = new OrderRepository(prisma);
  const cron = new OrderTimeoutCron(repo);
  return { prisma, cron };
};

// ---------- @rule CIM-R-15：取消 24h 超时默认同意 ----------

describe('OrderTimeoutCron 取消超时扫描（@rule CIM-R-15，idx_cancel_deadline）', () => {
  it('取消超时：cancel_deadline≤now → cancelled+cancelled_at + system 事件 + 退款口径 + 商品恢复 on_sale', async () => {
    const { prisma, cron } = setup();
    prisma.tradeOrder.findMany.mockImplementation((args: { where: Record<string, unknown> }) => {
      // 第一个扫描（取消超时）命中；第二个扫描（确认超时）无命中
      return Promise.resolve('cancel_deadline' in args.where ? [makeCancelExpiredRow()] : []);
    });
    prisma.tradeOrder.updateMany.mockResolvedValue({ count: 1 });

    await cron.runOnce(NOW);

    // 扫描口径：cancel_deadline ≤ now 且取消子状态 requested 且主状态未确认收货
    expect(prisma.tradeOrder.findMany).toHaveBeenCalledWith({
      where: {
        cancel_deadline: { lte: NOW },
        cancel_initiator_id: { not: null },
        status: { in: ['pending_delivery', 'pending_confirm'] },
      },
    });

    // @statemachine PIM-SM-01：原子迁移 cancelled（终态），须仍存在未响应取消且已超时
    expect(prisma.tradeOrder.updateMany).toHaveBeenCalledWith({
      where: {
        id: ORDER_ID,
        status: { in: ['pending_delivery', 'pending_confirm'] },
        cancel_initiator_id: { not: null },
        cancel_deadline: { lte: NOW },
      },
      data: { status: 'cancelled', cancelled_at: NOW },
    });

    // 留痕：actor 'system'（actor_id=0），原主状态 → cancelled
    expect(prisma.orderEvent.create.mock.calls[0][0].data).toMatchObject({
      order_id: ORDER_ID,
      from_status: 'pending_delivery',
      to_status: 'cancelled',
      actor: 'system',
      actor_id: SYSTEM_ACTOR_ID,
    });

    // @rule CIM-R-16 + §6 对策 B：退款原路退回留痕口径（平台不经手资金）
    expect(prisma.paymentRecord.updateMany).toHaveBeenCalledWith({
      where: { order_id: ORDER_ID, status: { not: 'refunded' } },
      data: {
        status: 'refunded',
        refund_status: 'success',
        refund_amount: '25.00',
        refund_requested_at: NOW,
        refunded_at: NOW,
      },
    });

    // @rule CIM-R-17：取消成功商品自动恢复上架（跨 schema 写入声明见 repository 注释）
    expect(prisma.product.updateMany).toHaveBeenCalledWith({
      where: { id: PRODUCT_ID, status: 'trading' },
      data: { status: 'on_sale' },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('取消未超时：扫描无命中 → 无任何事务写入', async () => {
    const { prisma, cron } = setup();
    // findMany 缺省返回 []（DB 侧 lte 过滤，未超时单不会命中）

    await cron.runOnce(NOW);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.tradeOrder.updateMany).not.toHaveBeenCalled();
    expect(prisma.orderEvent.create).not.toHaveBeenCalled();
    expect(prisma.product.updateMany).not.toHaveBeenCalled();
  });

  it('防御跳过：命中行 cancel_deadline 实际 > now（竞态被响应）→ 不处理该单', async () => {
    const { prisma, cron } = setup();
    prisma.tradeOrder.findMany.mockImplementation((args: { where: Record<string, unknown> }) => {
      return Promise.resolve(
        'cancel_deadline' in args.where
          ? [makeCancelExpiredRow({ cancel_deadline: new Date('2026-10-06T09:00:00.000Z') })]
          : [],
      );
    });

    await cron.runOnce(NOW);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

// ---------- @rule CIM-R-12：确认收货 48h 超时自动确认 ----------

describe('OrderTimeoutCron 确认收货超时扫描（@rule CIM-R-12，idx_status_deadline）', () => {
  it('确认超时：timeout_deadline≤now 且 pending_confirm → completed+completed_at + system 事件 + 商品 sold', async () => {
    const { prisma, cron } = setup();
    const expiredRow = makeOrderRow({
      status: 'pending_confirm',
      timeout_deadline: new Date('2026-10-06T07:59:00.000Z'), // ≤ NOW
    });
    prisma.tradeOrder.findMany.mockImplementation((args: { where: Record<string, unknown> }) => {
      return Promise.resolve('timeout_deadline' in args.where ? [expiredRow] : []);
    });
    prisma.tradeOrder.updateMany.mockResolvedValue({ count: 1 });
    prisma.product.update.mockResolvedValue({});

    await cron.runOnce(NOW);

    // 扫描口径：timeout_deadline ≤ now 且 status=pending_confirm
    expect(prisma.tradeOrder.findMany).toHaveBeenCalledWith({
      where: { timeout_deadline: { lte: NOW }, status: 'pending_confirm' },
    });

    // @statemachine PIM-SM-01 pending_confirm → completed（原子迁移 + 双时间戳）
    expect(prisma.tradeOrder.updateMany).toHaveBeenCalledWith({
      where: { id: ORDER_ID, status: 'pending_confirm', timeout_deadline: { lte: NOW } },
      data: { status: 'completed', confirmed_at: NOW, completed_at: NOW },
    });

    // 留痕：actor 'system'（actor_id=0）
    expect(prisma.orderEvent.create.mock.calls[0][0].data).toMatchObject({
      order_id: ORDER_ID,
      from_status: 'pending_confirm',
      to_status: 'completed',
      actor: 'system',
      actor_id: SYSTEM_ACTOR_ID,
    });

    // 跨 schema 写入声明：商品标记已售（同 #32 确认收货口径，F34-AC2）
    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: PRODUCT_ID },
      data: { status: 'sold', sold_buyer_id: BUYER_ID, sold_at: NOW },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('确认未超时：扫描无命中 → 无任何事务写入', async () => {
    const { prisma, cron } = setup();

    await cron.runOnce(NOW);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('防御跳过：命中行 timeout_deadline 实际 > now（竞态已确认/取消）→ 不处理该单', async () => {
    const { prisma, cron } = setup();
    prisma.tradeOrder.findMany.mockImplementation((args: { where: Record<string, unknown> }) => {
      return Promise.resolve(
        'timeout_deadline' in args.where
          ? [makeOrderRow({ timeout_deadline: new Date('2026-10-06T09:00:00.000Z') })]
          : [],
      );
    });

    await cron.runOnce(NOW);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

// ---------- 边界：deadline 恰等于 now 触发（lte 含端点） ----------

describe('OrderTimeoutCron 截止边界（deadline == now 触发）', () => {
  it('cancel_deadline 恰等于 now → 默认同意触发', async () => {
    const { prisma, cron } = setup();
    prisma.tradeOrder.findMany.mockImplementation((args: { where: Record<string, unknown> }) => {
      return Promise.resolve(
        'cancel_deadline' in args.where
          ? [makeCancelExpiredRow({ cancel_deadline: NOW })]
          : [],
      );
    });
    prisma.tradeOrder.updateMany.mockResolvedValue({ count: 1 });

    await cron.runOnce(NOW);

    expect(prisma.tradeOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'cancelled', cancelled_at: NOW } }),
    );
  });

  it('timeout_deadline 恰等于 now → 自动确认触发', async () => {
    const { prisma, cron } = setup();
    prisma.tradeOrder.findMany.mockImplementation((args: { where: Record<string, unknown> }) => {
      return Promise.resolve(
        'timeout_deadline' in args.where
          ? [makeOrderRow({ timeout_deadline: NOW })]
          : [],
      );
    });
    prisma.tradeOrder.updateMany.mockResolvedValue({ count: 1 });
    prisma.product.update.mockResolvedValue({});

    await cron.runOnce(NOW);

    expect(prisma.tradeOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'completed', confirmed_at: NOW, completed_at: NOW },
      }),
    );
  });
});

// ---------- @rule CIM-R-19：调度自含 start/stop/isRunning 幂等 ----------

describe('OrderTimeoutCron 调度生命周期（start/stop 幂等）', () => {
  afterEach(() => jest.useRealTimers());

  it('start 幂等：重复调用不叠加定时器；stop 幂等；isRunning 反映状态', () => {
    jest.useFakeTimers();
    const { cron } = setup();
    const setIntervalSpy = jest.spyOn(global, 'setInterval');

    expect(cron.isRunning()).toBe(false);
    cron.start();
    cron.start(); // 重复 start 不叠加
    expect(cron.isRunning()).toBe(true);
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    cron.stop();
    cron.stop(); // 重复 stop 不报错
    expect(cron.isRunning()).toBe(false);
  });

  it('定时触发 runOnce：推进一个周期后执行扫描', async () => {
    jest.useFakeTimers();
    const { prisma, cron } = setup();
    cron.start();

    await jest.advanceTimersByTimeAsync(60 * 60 * 1000);

    expect(prisma.tradeOrder.findMany).toHaveBeenCalled();
    cron.stop();
  });
});
