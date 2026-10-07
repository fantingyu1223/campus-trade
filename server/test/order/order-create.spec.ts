/**
 * order-create.spec.ts —— T-206 创建订单锁单防超卖 + 详情五态 + 确认收货
 *
 * @module PIM-BC-04 交易订单
 * @model PIM-AG-06 交易订单聚合
 * @statemachine PIM-SM-01 订单状态机（仅五态 pending_delivery/pending_confirm/completed/cancelled/appealing）
 * @rule CIM-R-10 付款前风险明示守卫 / CIM-R-11 付款锁商品防超卖 / CIM-R-12 48h 超时兜底 / CIM-R-14 意向不强制约束
 * @api §5.2 #30 POST /orders、#31 GET /orders/{id}、#32 POST /orders/{id}/confirm-receive
 * @ac F34-AC1 付款成功锁 trading / F34-AC2 当面自提标记已售完成 / F34-AC3 仅五态流转
 *
 * 覆盖验收点：
 *  - 创建成功：锁单 trading + payment_record channel=offline_scan（§6 对策 B）+ order_event 留痕 + 初始 pending_delivery
 *  - 防超卖：商品 trading/sold → 4003；off_sale → 2002；不存在 → 2001
 *  - 幂等：Idempotency-Key / buyer+product 活跃单去重，重复请求返回已有单
 *  - CIM-R-10/F13-AC2：online_pay 缺 risk_confirmed=true → 9001
 *  - 详情：五态 + countdown_sec 倒计时 + timeline（order_event）
 *  - 确认收货：completed + confirmed_at/completed_at 双时间戳 + 商品 sold+sold_buyer_id；非买家 1003；非 pending_confirm 4002
 *
 * 无真实 MySQL：PrismaService 一律 jest mock（product/tradeOrder/orderEvent/paymentRecord 四表）。
 */
import { ERROR_CODES } from '@contract/index';
import { OrderService, BusinessError } from '../../src/modules/order/order.service';
import { OrderRepository } from '../../src/modules/order/order.repository';
import { PaymentRecordService } from '../../src/modules/order/payment-record.service';
import { PrismaService } from '../../src/infra/prisma.service';

// ---------- 测试夹具 ----------

const BUYER_ID = BigInt(2);
const SELLER_ID = BigInt(1);
const ORDER_ID = BigInt(9001);
const PRODUCT_ID = BigInt(100);
const NOW = new Date('2026-10-06T08:00:00.000Z');

const makeProductRow = (over: Record<string, unknown> = {}) => ({
  id: PRODUCT_ID,
  seller_id: SELLER_ID,
  title: '高等数学（下册）',
  price: '25.00',
  status: 'on_sale',
  ...over,
});

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
  status: 'pending_delivery',
  meet_time: null,
  timeout_deadline: new Date('2026-10-08T08:00:00.000Z'),
  confirmed_at: null,
  completed_at: null,
  cancelled_at: null,
  created_at: NOW,
  updated_at: NOW,
  ...over,
});

const makeEventRow = (over: Record<string, unknown> = {}) => ({
  id: BigInt(1),
  order_id: ORDER_ID,
  from_status: null,
  to_status: 'pending_delivery',
  actor: 'buyer',
  actor_id: BUYER_ID,
  note: null,
  created_at: NOW,
  ...over,
});

const makePrismaMock = () =>
  ({
    product: { findUnique: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
    tradeOrder: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
    orderEvent: { create: jest.fn(), findMany: jest.fn() },
    paymentRecord: { create: jest.fn(), findFirst: jest.fn() },
    $transaction: jest.fn(),
  }) as unknown as PrismaService & {
    product: { findUnique: jest.Mock; updateMany: jest.Mock; update: jest.Mock };
    tradeOrder: { findFirst: jest.Mock; findUnique: jest.Mock; create: jest.Mock; updateMany: jest.Mock };
    orderEvent: { create: jest.Mock; findMany: jest.Mock };
    paymentRecord: { create: jest.Mock; findFirst: jest.Mock };
    $transaction: jest.Mock;
  };

const setup = () => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  const prisma = makePrismaMock();
  // $transaction 回调直接复用同一 mock 作为 tx
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
  const repo = new OrderRepository(prisma);
  const paymentService = new PaymentRecordService();
  const service = new OrderService(repo, paymentService);
  return { prisma, repo, paymentService, service };
};

const teardown = () => jest.useRealTimers();

const expectBizError = async (p: Promise<unknown>, code: number) => {
  await expect(p).rejects.toMatchObject({ code });
  await p.catch((e: BusinessError) => expect(e).toBeInstanceOf(BusinessError));
};

/** 创建成功路径的 mock 编排：商品在售 + 无活跃单 + 锁单 count=1 */
const mockCreateHappyPath = (prisma: ReturnType<typeof makePrismaMock>) => {
  prisma.product.findUnique.mockResolvedValue(makeProductRow());
  prisma.tradeOrder.findFirst.mockResolvedValue(null);
  prisma.product.updateMany.mockResolvedValue({ count: 1 });
  prisma.tradeOrder.create.mockResolvedValue(makeOrderRow());
  prisma.orderEvent.create.mockResolvedValue(makeEventRow());
  prisma.paymentRecord.create.mockResolvedValue({ id: BigInt(1) });
};

// ---------- F34-AC1 + CIM-R-11：创建订单锁单防超卖（@api §5.2 #30） ----------

describe('OrderService.create（@api §5.2 #30，@statemachine PIM-SM-01 [*] → pending_delivery）', () => {
  afterEach(teardown);

  it('创建成功：锁单 trading + payment_record channel=offline_scan + order_event 留痕 + 初始 pending_delivery', async () => {
    const { prisma, service } = setup();
    mockCreateHappyPath(prisma);

    const result = await service.create(
      { id: BUYER_ID },
      { product_id: '100', trade_mode: 'online_pay', risk_confirmed: true },
      'idem-key-1',
    );

    // 响应：order_id/order_no/status/pay_deadline/countdown_sec（§5.2 #30）
    expect(result.order_id).toBe(ORDER_ID.toString());
    expect(result.order_no).toBe('ES20261006ABC123');
    expect(result.status).toBe('pending_delivery');
    expect(result.pay_deadline).toBe('2026-10-08T08:00:00.000Z');
    expect(result.countdown_sec).toBe(48 * 3600);

    // @rule CIM-R-11：锁单防超卖——原子 updateMany on_sale → trading
    expect(prisma.product.updateMany).toHaveBeenCalledWith({
      where: { id: PRODUCT_ID, status: 'on_sale' },
      data: { status: 'trading' },
    });

    // 订单落库：五态初始 pending_delivery + timeout_deadline=建单+48h（CIM-R-12 兜底）
    expect(prisma.tradeOrder.create).toHaveBeenCalledTimes(1);
    const orderData = prisma.tradeOrder.create.mock.calls[0][0].data;
    expect(orderData.status).toBe('pending_delivery');
    expect(orderData.buyer_id).toBe(BUYER_ID);
    expect(orderData.seller_id).toBe(SELLER_ID);
    expect(orderData.timeout_deadline).toEqual(new Date('2026-10-08T08:00:00.000Z'));
    expect(orderData.order_no).toMatch(/^ES\d{8}[0-9A-Z]{6}$/);

    // §6 支付对策 B：payment_record channel=offline_scan，平台不经手资金
    expect(prisma.paymentRecord.create).toHaveBeenCalledTimes(1);
    expect(prisma.paymentRecord.create.mock.calls[0][0].data.channel).toBe('offline_scan');
    expect(prisma.paymentRecord.create.mock.calls[0][0].data.status).toBe('pending');

    // @rule CIM-R-11 全程留痕：建单事件 from=null → pending_delivery
    expect(prisma.orderEvent.create).toHaveBeenCalledTimes(1);
    const eventData = prisma.orderEvent.create.mock.calls[0][0].data;
    expect(eventData.from_status).toBeNull();
    expect(eventData.to_status).toBe('pending_delivery');
    expect(eventData.actor).toBe('buyer');

    // 四步写入在同一事务内
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('meet_time 存在时 timeout_deadline=meet_time+48h（@rule CIM-R-12）', async () => {
    const { prisma, service } = setup();
    mockCreateHappyPath(prisma);

    await service.create(
      { id: BUYER_ID },
      { product_id: '100', trade_mode: 'online_pay', risk_confirmed: true, meet_time: '2026-10-07T10:00:00.000Z' },
    );

    expect(prisma.tradeOrder.create.mock.calls[0][0].data.timeout_deadline).toEqual(
      new Date('2026-10-09T10:00:00.000Z'),
    );
  });

  it('商品已锁定（status=trading）→ 4003 防超卖', async () => {
    const { prisma, service } = setup();
    prisma.product.findUnique.mockResolvedValue(makeProductRow({ status: 'trading' }));

    await expectBizError(
      service.create({ id: BUYER_ID }, { product_id: '100', risk_confirmed: true }),
      ERROR_CODES.ORDER_LOCK_FAILED,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('商品已售（status=sold）→ 4003；已下架（off_sale）→ 2002；不存在 → 2001', async () => {
    const { prisma, service } = setup();
    prisma.product.findUnique.mockResolvedValue(makeProductRow({ status: 'sold' }));
    await expectBizError(
      service.create({ id: BUYER_ID }, { product_id: '100', risk_confirmed: true }),
      ERROR_CODES.ORDER_LOCK_FAILED,
    );

    prisma.product.findUnique.mockResolvedValue(makeProductRow({ status: 'off_sale' }));
    await expectBizError(
      service.create({ id: BUYER_ID }, { product_id: '100', risk_confirmed: true }),
      ERROR_CODES.PRODUCT_OFF_SHELF,
    );

    prisma.product.findUnique.mockResolvedValue(null);
    await expectBizError(
      service.create({ id: BUYER_ID }, { product_id: '100', risk_confirmed: true }),
      ERROR_CODES.PRODUCT_NOT_FOUND,
    );
  });

  it('锁单竞争：原子 updateMany count=0（并发被他人抢先锁）→ 4003 且事务回滚不落单', async () => {
    const { prisma, service } = setup();
    prisma.product.findUnique.mockResolvedValue(makeProductRow());
    prisma.tradeOrder.findFirst.mockResolvedValue(null);
    prisma.product.updateMany.mockResolvedValue({ count: 0 });

    await expectBizError(
      service.create({ id: BUYER_ID }, { product_id: '100', risk_confirmed: true }),
      ERROR_CODES.ORDER_LOCK_FAILED,
    );
    expect(prisma.tradeOrder.create).not.toHaveBeenCalled();
  });

  it('幂等：buyer+product 存在活跃单（Idempotency-Key 去重口径）→ 直接返回已有单，不重复创建', async () => {
    const { prisma, service } = setup();
    prisma.product.findUnique.mockResolvedValue(makeProductRow());
    prisma.tradeOrder.findFirst.mockResolvedValue(makeOrderRow());

    const result = await service.create(
      { id: BUYER_ID },
      { product_id: '100', risk_confirmed: true },
      'idem-key-dup',
    );

    expect(result.order_id).toBe(ORDER_ID.toString());
    expect(result.status).toBe('pending_delivery');
    expect(result.countdown_sec).toBe(48 * 3600);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.tradeOrder.create).not.toHaveBeenCalled();
  });

  it('@rule CIM-R-10 / F13-AC2：online_pay 缺 risk_confirmed=true → 9001（付款前明示守卫）', async () => {
    const { prisma, service } = setup();
    await expectBizError(
      service.create({ id: BUYER_ID }, { product_id: '100' }),
      ERROR_CODES.PARAM_VALIDATION_FAILED,
    );
    await expectBizError(
      service.create({ id: BUYER_ID }, { product_id: '100', risk_confirmed: false }),
      ERROR_CODES.PARAM_VALIDATION_FAILED,
    );
    expect(prisma.product.findUnique).not.toHaveBeenCalled();
  });

  it('@rule CIM-R-14：offline_meet 意向不强制约束，无需 risk_confirmed 即可建单', async () => {
    const { prisma, service } = setup();
    mockCreateHappyPath(prisma);

    const result = await service.create({ id: BUYER_ID }, { product_id: '100', trade_mode: 'offline_meet' });
    expect(result.status).toBe('pending_delivery');
    expect(prisma.tradeOrder.create.mock.calls[0][0].data.trade_mode).toBe('offline_meet');
  });

  it('非法入参：product_id 缺失/非法、trade_mode 越界、meet_time 非法 → 9001', async () => {
    const { service } = setup();
    await expectBizError(service.create({ id: BUYER_ID }, {}), ERROR_CODES.PARAM_VALIDATION_FAILED);
    await expectBizError(
      service.create({ id: BUYER_ID }, { product_id: 'abc', risk_confirmed: true }),
      ERROR_CODES.PARAM_VALIDATION_FAILED,
    );
    await expectBizError(
      service.create({ id: BUYER_ID }, { product_id: '100', trade_mode: 'cod', risk_confirmed: true }),
      ERROR_CODES.PARAM_VALIDATION_FAILED,
    );
    await expectBizError(
      service.create({ id: BUYER_ID }, { product_id: '100', risk_confirmed: true, meet_time: 'not-a-date' }),
      ERROR_CODES.PARAM_VALIDATION_FAILED,
    );
  });
});

// ---------- F34-AC3：详情五态+倒计时+timeline（@api §5.2 #31） ----------

describe('OrderService.detail（@api §5.2 #31，五态+倒计时+timeline）', () => {
  afterEach(teardown);

  it('返回五态 status + countdown_sec 剩余秒 + timeline（order_event 时间线）+ channel', async () => {
    const { prisma, service } = setup();
    prisma.tradeOrder.findUnique.mockResolvedValue(makeOrderRow({ status: 'pending_confirm' }));
    prisma.paymentRecord.findFirst.mockResolvedValue({ channel: 'offline_scan' });
    prisma.orderEvent.findMany.mockResolvedValue([
      makeEventRow(),
      makeEventRow({ id: BigInt(2), from_status: 'pending_delivery', to_status: 'pending_confirm' }),
    ]);

    const detail = await service.detail(ORDER_ID);

    expect(detail.order_no).toBe('ES20261006ABC123');
    expect(detail.status).toBe('pending_confirm'); // 五态之一，@ac F34-AC3
    expect(detail.channel).toBe('offline_scan');
    expect(detail.countdown_sec).toBe(48 * 3600);
    expect(detail.product).toEqual({ product_id: PRODUCT_ID.toString(), title: '高等数学（下册）' });
    expect(detail.buyer_id).toBe(BUYER_ID.toString());
    expect(detail.seller_id).toBe(SELLER_ID.toString());
    expect(detail.amount).toBe('25.00');
    expect(detail.timeline).toHaveLength(2);
    expect(detail.timeline[0]).toMatchObject({ from_status: null, to_status: 'pending_delivery', actor: 'buyer' });
    expect(detail.timeline[1]).toMatchObject({ from_status: 'pending_delivery', to_status: 'pending_confirm' });
  });

  it('订单不存在 → 4001', async () => {
    const { prisma, service } = setup();
    prisma.tradeOrder.findUnique.mockResolvedValue(null);
    await expectBizError(service.detail(BigInt(404)), ERROR_CODES.ORDER_NOT_FOUND);
  });
});

// ---------- F34-AC2：确认收货（@api §5.2 #32，pending_confirm → completed） ----------

describe('OrderService.confirmReceive（@api §5.2 #32，@statemachine PIM-SM-01 pending_confirm → completed）', () => {
  afterEach(teardown);

  const mockConfirmHappyPath = (prisma: ReturnType<typeof makePrismaMock>) => {
    prisma.tradeOrder.findUnique.mockResolvedValue(makeOrderRow({ status: 'pending_confirm' }));
    prisma.tradeOrder.updateMany.mockResolvedValue({ count: 1 });
    prisma.orderEvent.create.mockResolvedValue({});
    prisma.product.update.mockResolvedValue({});
  };

  it('确认收货成功：completed + confirmed_at/completed_at 双时间戳 + 商品 sold+sold_buyer_id+sold_at + review_pending 双方', async () => {
    const { prisma, service } = setup();
    mockConfirmHappyPath(prisma);

    const result = await service.confirmReceive(ORDER_ID, { id: BUYER_ID });

    expect(result.status).toBe('completed');
    // @api §5.2 #32：review_pending（双方）——评价入口开放口径
    expect(result.review_pending).toEqual({ buyer: true, seller: true });

    // 原子迁移 pending_confirm → completed，双时间戳写入
    expect(prisma.tradeOrder.updateMany).toHaveBeenCalledWith({
      where: { id: ORDER_ID, status: 'pending_confirm' },
      data: { status: 'completed', confirmed_at: NOW, completed_at: NOW },
    });

    // 标记已售联动（跨 schema 写入声明见 repository 注释）：sold + sold_buyer_id + sold_at
    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: PRODUCT_ID },
      data: { status: 'sold', sold_buyer_id: BUYER_ID, sold_at: NOW },
    });

    // @rule CIM-R-11 全程留痕：pending_confirm → completed
    expect(prisma.orderEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.orderEvent.create.mock.calls[0][0].data).toMatchObject({
      from_status: 'pending_confirm',
      to_status: 'completed',
      actor: 'buyer',
      actor_id: BUYER_ID,
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('非买家确认 → 1003', async () => {
    const { prisma, service } = setup();
    prisma.tradeOrder.findUnique.mockResolvedValue(makeOrderRow({ status: 'pending_confirm' }));

    await expectBizError(
      service.confirmReceive(ORDER_ID, { id: BigInt(999) }),
      ERROR_CODES.PERMISSION_DENIED,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('非 pending_confirm 状态（pending_delivery/completed/cancelled）→ 4002', async () => {
    const { prisma, service } = setup();
    for (const status of ['pending_delivery', 'completed', 'cancelled']) {
      prisma.tradeOrder.findUnique.mockResolvedValue(makeOrderRow({ status }));
      await expectBizError(
        service.confirmReceive(ORDER_ID, { id: BUYER_ID }),
        ERROR_CODES.ORDER_STATUS_CONFLICT,
      );
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('并发竞争：原子 updateMany count=0（状态已被迁移）→ 4002', async () => {
    const { prisma, service } = setup();
    prisma.tradeOrder.findUnique.mockResolvedValue(makeOrderRow({ status: 'pending_confirm' }));
    prisma.tradeOrder.updateMany.mockResolvedValue({ count: 0 });

    await expectBizError(
      service.confirmReceive(ORDER_ID, { id: BUYER_ID }),
      ERROR_CODES.ORDER_STATUS_CONFLICT,
    );
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('订单不存在 → 4001', async () => {
    const { prisma, service } = setup();
    prisma.tradeOrder.findUnique.mockResolvedValue(null);
    await expectBizError(service.confirmReceive(ORDER_ID, { id: BUYER_ID }), ERROR_CODES.ORDER_NOT_FOUND);
  });
});
