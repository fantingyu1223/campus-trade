/**
 * order-cancel-reject.spec.ts —— T-207 发起取消 / 响应取消 / 现场拒收
 *
 * @module PIM-BC-04 交易订单
 * @model PIM-AG-06 交易订单聚合（CancelRequest 值对象，24h 响应窗口）
 * @statemachine PIM-SM-01 订单状态机·取消请求子状态（none→requested→agreed/rejected，字段组承载不立主枚举）
 * @rule CIM-R-15 24h 默认同意、拒绝回原态并留痕 / CIM-R-16 退款原路退回（对策B留痕口径）/
 *       CIM-R-17 取消成功商品恢复上架 / CIM-R-18 已确认收货不可取消 / CIM-R-19 拒收现场留痕
 * @event PIM-EV-05 订单已取消（副作用：product 回 on_sale）
 * @api §5.2 #33 POST /orders/{id}/cancel、#34 POST /orders/{id}/cancel/respond、#35 POST /orders/{id}/reject-onsite
 * @ac F35-AC1 取消+24h超时默认同意 / F35-AC2 已确认收货拦截 / F35-AC4 现场拒收留痕
 *
 * 覆盖验收点：
 *  - 发起取消成功：cancel_deadline=now+24h 落库 + 主状态不变（子状态 requested）+ 响应 cancel_pending/respond_deadline
 *  - 已 completed 拦截 4002（注释引导 F30 申诉）；重复发起 4002；非双方 1003；不存在 4001
 *  - 响应 agree：cancelled+cancelled_at+order_event+payment refunded 口径+商品 on_sale
 *  - 响应 reject：清取消字段回原态+order_event 留痕；发起者自响应 1003；超时 4004
 *  - 现场拒收：成功同 agree 路径；缺 time/reason 4005；非买家 1003；非 pending_confirm 4002
 *
 * 无真实 MySQL：PrismaService 一律 jest mock。
 */
import { ERROR_CODES } from '@contract/index';
import { CancelService } from '../../src/modules/order/cancel.service';
import { OrderRepository } from '../../src/modules/order/order.repository';
import { BusinessError } from '../../src/modules/order/order.service';
import { PrismaService } from '../../src/infra/prisma.service';

// ---------- 测试夹具 ----------

const BUYER_ID = BigInt(2);
const SELLER_ID = BigInt(1);
const STRANGER_ID = BigInt(999);
const ORDER_ID = BigInt(9001);
const PRODUCT_ID = BigInt(100);
const NOW = new Date('2026-10-06T08:00:00.000Z');
const DEADLINE_24H = new Date('2026-10-07T08:00:00.000Z');

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

/** 已有未响应取消申请的订单行（取消子状态=requested） */
const makeCancelRequestedRow = (over: Record<string, unknown> = {}) =>
  makeOrderRow({
    cancel_initiator_id: BUYER_ID,
    cancel_requested_at: NOW,
    cancel_deadline: DEADLINE_24H,
    cancel_reason: '临时不需要了',
    ...over,
  });

const makePrismaMock = () =>
  ({
    product: { updateMany: jest.fn() },
    tradeOrder: { findUnique: jest.fn(), updateMany: jest.fn() },
    orderEvent: { create: jest.fn() },
    paymentRecord: { updateMany: jest.fn() },
    $transaction: jest.fn(),
  }) as unknown as PrismaService & {
    product: { updateMany: jest.Mock };
    tradeOrder: { findUnique: jest.Mock; updateMany: jest.Mock };
    orderEvent: { create: jest.Mock };
    paymentRecord: { updateMany: jest.Mock };
    $transaction: jest.Mock;
  };

const setup = () => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  const prisma = makePrismaMock();
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
  const repo = new OrderRepository(prisma);
  const service = new CancelService(repo);
  return { prisma, service };
};

const teardown = () => jest.useRealTimers();

const expectBizError = async (p: Promise<unknown>, code: number) => {
  await expect(p).rejects.toMatchObject({ code });
  await p.catch((e: BusinessError) => expect(e).toBeInstanceOf(BusinessError));
};

// ---------- F35-AC1/AC2：发起取消（@api §5.2 #33） ----------

describe('CancelService.requestCancel（@api §5.2 #33，@statemachine PIM-SM-01 取消子状态 none → requested）', () => {
  afterEach(teardown);

  it('发起取消成功：cancel_deadline=now+24h 落库 + 主状态不变（仅字段组）+ 响应 cancel_pending/respond_deadline', async () => {
    const { prisma, service } = setup();
    prisma.tradeOrder.findUnique.mockResolvedValue(makeOrderRow({ status: 'pending_delivery' }));
    prisma.tradeOrder.updateMany.mockResolvedValue({ count: 1 });
    prisma.orderEvent.create.mockResolvedValue({});

    const result = await service.requestCancel(ORDER_ID, { id: BUYER_ID }, { reason: '协商一致取消' });

    // 契约响应：status(cancel_pending)、respond_deadline（=cancel_deadline）
    expect(result.status).toBe('cancel_pending');
    expect(result.respond_deadline).toBe(DEADLINE_24H.toISOString());

    // @rule CIM-R-15：24h 自发起时刻起算；主状态不变，取消子状态以字段组承载（不立主枚举）
    expect(prisma.tradeOrder.updateMany).toHaveBeenCalledWith({
      where: {
        id: ORDER_ID,
        status: { in: ['pending_delivery', 'pending_confirm'] },
        cancel_initiator_id: null,
      },
      data: {
        cancel_initiator_id: BUYER_ID,
        cancel_requested_at: NOW,
        cancel_deadline: DEADLINE_24H,
        cancel_reason: '协商一致取消',
      },
    });
    // 主状态机留痕：from=to=原主状态（子状态迁移），note 记录取消原因
    expect(prisma.orderEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.orderEvent.create.mock.calls[0][0].data).toMatchObject({
      order_id: ORDER_ID,
      from_status: 'pending_delivery',
      to_status: 'pending_delivery',
      actor: 'buyer',
      actor_id: BUYER_ID,
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('卖家也可发起（买卖双方同一规则，@rule CIM-R-15）；reason 可省略', async () => {
    const { prisma, service } = setup();
    prisma.tradeOrder.findUnique.mockResolvedValue(makeOrderRow());
    prisma.tradeOrder.updateMany.mockResolvedValue({ count: 1 });
    prisma.orderEvent.create.mockResolvedValue({});

    const result = await service.requestCancel(ORDER_ID, { id: SELLER_ID }, {});
    expect(result.status).toBe('cancel_pending');
    expect(prisma.tradeOrder.updateMany.mock.calls[0][0].data.cancel_initiator_id).toBe(SELLER_ID);
    expect(prisma.tradeOrder.updateMany.mock.calls[0][0].data.cancel_reason).toBeNull();
    expect(prisma.orderEvent.create.mock.calls[0][0].data.actor).toBe('seller');
  });

  it('已 completed 拦截 4002（@rule CIM-R-18：已确认收货不可取消，售后异议引导 F30 申诉）', async () => {
    const { prisma, service } = setup();
    prisma.tradeOrder.findUnique.mockResolvedValue(makeOrderRow({ status: 'completed' }));

    await expectBizError(
      service.requestCancel(ORDER_ID, { id: BUYER_ID }, { reason: 'x' }),
      ERROR_CODES.ORDER_STATUS_CONFLICT,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('重复发起：已有未响应取消申请（cancel_initiator_id 非空）→ 4002', async () => {
    const { prisma, service } = setup();
    prisma.tradeOrder.findUnique.mockResolvedValue(makeCancelRequestedRow());

    await expectBizError(
      service.requestCancel(ORDER_ID, { id: SELLER_ID }, {}),
      ERROR_CODES.ORDER_STATUS_CONFLICT,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('非订单买卖双方发起 → 1003；订单不存在 → 4001；cancelled/appealing → 4002', async () => {
    const { prisma, service } = setup();
    prisma.tradeOrder.findUnique.mockResolvedValue(makeOrderRow());
    await expectBizError(
      service.requestCancel(ORDER_ID, { id: STRANGER_ID }, {}),
      ERROR_CODES.PERMISSION_DENIED,
    );

    prisma.tradeOrder.findUnique.mockResolvedValue(null);
    await expectBizError(
      service.requestCancel(ORDER_ID, { id: BUYER_ID }, {}),
      ERROR_CODES.ORDER_NOT_FOUND,
    );

    for (const status of ['cancelled', 'appealing']) {
      prisma.tradeOrder.findUnique.mockResolvedValue(makeOrderRow({ status }));
      await expectBizError(
        service.requestCancel(ORDER_ID, { id: BUYER_ID }, {}),
        ERROR_CODES.ORDER_STATUS_CONFLICT,
      );
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('并发竞争：原子 updateMany count=0（他人抢先发起/状态已迁移）→ 4002', async () => {
    const { prisma, service } = setup();
    prisma.tradeOrder.findUnique.mockResolvedValue(makeOrderRow());
    prisma.tradeOrder.updateMany.mockResolvedValue({ count: 0 });

    await expectBizError(
      service.requestCancel(ORDER_ID, { id: BUYER_ID }, {}),
      ERROR_CODES.ORDER_STATUS_CONFLICT,
    );
    expect(prisma.orderEvent.create).not.toHaveBeenCalled();
  });
});

// ---------- F35-AC1 + 裁决3：响应取消（@api §5.2 #34） ----------

describe('CancelService.respondCancel（@api §5.2 #34，取消子状态 requested → agreed/rejected）', () => {
  afterEach(teardown);

  it('agree：订单转 cancelled+cancelled_at + order_event + payment refunded 口径（对策B）+ 商品恢复 on_sale（@rule CIM-R-16/17，@event EV-05）', async () => {
    const { prisma, service } = setup();
    prisma.tradeOrder.findUnique.mockResolvedValue(makeCancelRequestedRow());
    prisma.tradeOrder.updateMany.mockResolvedValue({ count: 1 });
    prisma.orderEvent.create.mockResolvedValue({});
    prisma.paymentRecord.updateMany.mockResolvedValue({ count: 1 });
    prisma.product.updateMany.mockResolvedValue({ count: 1 });

    // 卖家响应买家的取消申请
    const result = await service.respondCancel(ORDER_ID, { id: SELLER_ID }, { action: 'agree' });

    expect(result.status).toBe('cancelled');

    // @statemachine PIM-SM-01 pending_confirm → cancelled（原子迁移，须存在未响应取消）
    expect(prisma.tradeOrder.updateMany).toHaveBeenCalledWith({
      where: {
        id: ORDER_ID,
        status: { in: ['pending_delivery', 'pending_confirm'] },
        cancel_initiator_id: { not: null },
      },
      data: { status: 'cancelled', cancelled_at: NOW },
    });

    // 留痕：pending_confirm → cancelled，actor=响应方
    expect(prisma.orderEvent.create.mock.calls[0][0].data).toMatchObject({
      from_status: 'pending_confirm',
      to_status: 'cancelled',
      actor: 'seller',
      actor_id: SELLER_ID,
    });

    // @rule CIM-R-16 + §6 对策 B：退款原路退回留痕口径——平台不经手资金，
    // payment_record.status 置 refunded 注明线下自行协商退回 + 平台监督
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

  it('reject：清取消字段回 cancel 子状态 none、主状态不变回原态 + cancel_reject_note + order_event 留痕（裁决3）', async () => {
    const { prisma, service } = setup();
    prisma.tradeOrder.findUnique.mockResolvedValue(makeCancelRequestedRow());
    prisma.tradeOrder.updateMany.mockResolvedValue({ count: 1 });
    prisma.orderEvent.create.mockResolvedValue({});

    const result = await service.respondCancel(ORDER_ID, { id: SELLER_ID }, { action: 'reject', note: '已发货在途' });

    // 回原态：主状态不变
    expect(result.status).toBe('pending_confirm');

    // 清除取消字段组（子状态回 none），保留对方拒绝说明
    expect(prisma.tradeOrder.updateMany).toHaveBeenCalledWith({
      where: { id: ORDER_ID, cancel_initiator_id: { not: null } },
      data: {
        cancel_initiator_id: null,
        cancel_requested_at: null,
        cancel_deadline: null,
        cancel_reason: null,
        cancel_reject_note: '已发货在途',
      },
    });

    // 留痕：from=to=原主状态（子状态迁移），交易继续
    expect(prisma.orderEvent.create.mock.calls[0][0].data).toMatchObject({
      from_status: 'pending_confirm',
      to_status: 'pending_confirm',
      actor: 'seller',
      actor_id: SELLER_ID,
    });
    // 拒绝不触发退款与商品恢复
    expect(prisma.paymentRecord.updateMany).not.toHaveBeenCalled();
    expect(prisma.product.updateMany).not.toHaveBeenCalled();
  });

  it('发起者本人响应 → 1003（仅对方可响应）', async () => {
    const { prisma, service } = setup();
    prisma.tradeOrder.findUnique.mockResolvedValue(makeCancelRequestedRow());

    await expectBizError(
      service.respondCancel(ORDER_ID, { id: BUYER_ID }, { action: 'agree' }),
      ERROR_CODES.PERMISSION_DENIED,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('超过 cancel_deadline 响应 → 4004（24h 超时应由 jobs 默认同意，不再接受人工响应）', async () => {
    const { prisma, service } = setup();
    prisma.tradeOrder.findUnique.mockResolvedValue(
      makeCancelRequestedRow({ cancel_deadline: new Date('2026-10-06T07:59:59.000Z') }),
    );

    await expectBizError(
      service.respondCancel(ORDER_ID, { id: SELLER_ID }, { action: 'agree' }),
      ERROR_CODES.CANCEL_RESPOND_TIMEOUT,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('无进行中取消申请 → 4002；action 非法 → 9001；订单不存在 → 4001', async () => {
    const { prisma, service } = setup();
    prisma.tradeOrder.findUnique.mockResolvedValue(makeOrderRow());
    await expectBizError(
      service.respondCancel(ORDER_ID, { id: SELLER_ID }, { action: 'agree' }),
      ERROR_CODES.ORDER_STATUS_CONFLICT,
    );

    prisma.tradeOrder.findUnique.mockResolvedValue(makeCancelRequestedRow());
    await expectBizError(
      service.respondCancel(ORDER_ID, { id: SELLER_ID }, { action: 'maybe' }),
      ERROR_CODES.PARAM_VALIDATION_FAILED,
    );

    prisma.tradeOrder.findUnique.mockResolvedValue(null);
    await expectBizError(
      service.respondCancel(ORDER_ID, { id: SELLER_ID }, { action: 'agree' }),
      ERROR_CODES.ORDER_NOT_FOUND,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

// ---------- F35-AC4：现场拒收（@api §5.2 #35，@rule CIM-R-19） ----------

describe('CancelService.rejectOnsite（@api §5.2 #35，@statemachine PIM-SM-01 pending_confirm → cancelled）', () => {
  afterEach(teardown);

  const REJECT_TIME = '2026-10-06T07:30:00.000Z';

  const mockAgreePathTx = (prisma: ReturnType<typeof makePrismaMock>) => {
    prisma.tradeOrder.updateMany.mockResolvedValue({ count: 1 });
    prisma.orderEvent.create.mockResolvedValue({});
    prisma.paymentRecord.updateMany.mockResolvedValue({ count: 1 });
    prisma.product.updateMany.mockResolvedValue({ count: 1 });
  };

  it('拒收成功：留痕（reject_time+reason 落 cancel 字段组）后进入取消流程（cancelled+退款口径+商品 on_sale）', async () => {
    const { prisma, service } = setup();
    prisma.tradeOrder.findUnique.mockResolvedValue(makeOrderRow({ status: 'pending_confirm' }));
    mockAgreePathTx(prisma);

    const result = await service.rejectOnsite(ORDER_ID, { id: BUYER_ID }, {
      reject_time: REJECT_TIME,
      reason: '屏幕有划痕与描述不符',
    });

    // @event PIM-EV-05：拒收成立即取消（无 rejected 主态，落 cancelled，见 PSM-INC-01 口径）
    expect(result.status).toBe('cancelled');

    // @rule CIM-R-19：现场拒收留痕——时间落 cancel_requested_at、说明落 cancel_reason
    expect(prisma.tradeOrder.updateMany).toHaveBeenCalledWith({
      where: { id: ORDER_ID, status: 'pending_confirm' },
      data: {
        status: 'cancelled',
        cancelled_at: NOW,
        cancel_initiator_id: BUYER_ID,
        cancel_requested_at: new Date(REJECT_TIME),
        cancel_reason: '屏幕有划痕与描述不符',
      },
    });

    // 留痕事件 note 含拒收说明
    expect(prisma.orderEvent.create.mock.calls[0][0].data).toMatchObject({
      from_status: 'pending_confirm',
      to_status: 'cancelled',
      actor: 'buyer',
      actor_id: BUYER_ID,
    });
    expect(prisma.orderEvent.create.mock.calls[0][0].data.note).toContain('屏幕有划痕');

    // 同 agree 路径：退款口径 + 商品恢复上架
    expect(prisma.paymentRecord.updateMany.mock.calls[0][0].data.status).toBe('refunded');
    expect(prisma.product.updateMany).toHaveBeenCalledWith({
      where: { id: PRODUCT_ID, status: 'trading' },
      data: { status: 'on_sale' },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('缺 reject_time 或 reason（或为空串/非法时间）→ 4005', async () => {
    const { prisma, service } = setup();
    await expectBizError(
      service.rejectOnsite(ORDER_ID, { id: BUYER_ID }, { reason: 'x' }),
      ERROR_CODES.REJECT_ONSITE_INFO_MISSING,
    );
    await expectBizError(
      service.rejectOnsite(ORDER_ID, { id: BUYER_ID }, { reject_time: REJECT_TIME }),
      ERROR_CODES.REJECT_ONSITE_INFO_MISSING,
    );
    await expectBizError(
      service.rejectOnsite(ORDER_ID, { id: BUYER_ID }, { reject_time: REJECT_TIME, reason: '  ' }),
      ERROR_CODES.REJECT_ONSITE_INFO_MISSING,
    );
    await expectBizError(
      service.rejectOnsite(ORDER_ID, { id: BUYER_ID }, { reject_time: 'not-a-date', reason: 'x' }),
      ERROR_CODES.REJECT_ONSITE_INFO_MISSING,
    );
    expect(prisma.tradeOrder.findUnique).not.toHaveBeenCalled();
  });

  it('非买家（卖家/陌生人）发起拒收 → 1003', async () => {
    const { prisma, service } = setup();
    prisma.tradeOrder.findUnique.mockResolvedValue(makeOrderRow({ status: 'pending_confirm' }));

    await expectBizError(
      service.rejectOnsite(ORDER_ID, { id: SELLER_ID }, { reject_time: REJECT_TIME, reason: 'x' }),
      ERROR_CODES.PERMISSION_DENIED,
    );
    await expectBizError(
      service.rejectOnsite(ORDER_ID, { id: STRANGER_ID }, { reject_time: REJECT_TIME, reason: 'x' }),
      ERROR_CODES.PERMISSION_DENIED,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('非 pending_confirm 状态（pending_delivery/completed/cancelled）→ 4002；订单不存在 → 4001', async () => {
    const { prisma, service } = setup();
    for (const status of ['pending_delivery', 'completed', 'cancelled']) {
      prisma.tradeOrder.findUnique.mockResolvedValue(makeOrderRow({ status }));
      await expectBizError(
        service.rejectOnsite(ORDER_ID, { id: BUYER_ID }, { reject_time: REJECT_TIME, reason: 'x' }),
        ERROR_CODES.ORDER_STATUS_CONFLICT,
      );
    }

    prisma.tradeOrder.findUnique.mockResolvedValue(null);
    await expectBizError(
      service.rejectOnsite(ORDER_ID, { id: BUYER_ID }, { reject_time: REJECT_TIME, reason: 'x' }),
      ERROR_CODES.ORDER_NOT_FOUND,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
