/**
 * appeal.spec.ts —— 申诉仲裁单元测试（§5.3 #65-67，PRD F30/F31）
 *
 * @module PIM-BC-05
 * 前端契约以 admin-web/src/api/appeal.ts DTO 为对齐基准：
 * - 列表项 {id,type,related_no,submitted_at,intervene_deadline,status}，按介入时限升序；
 * - 契约口径 status='done' ↔ DB 枚举 resolved/expired；type=dispute/punishment；
 * - 裁决 result 严格枚举 buyer_win/seller_win/both_warning/invalid，note 必填，
 *   linked_action 可选 off_shelf/warning/ban/rejected；裁决后留痕并通知双方。
 */
import { AppealService, BusinessError } from '../../src/modules/admin/governance/appeal.service';
import { AppealRepository } from '../../src/modules/admin/governance/appeal.repository';

const NOW = new Date('2026-10-08T12:00:00.000Z');

function makeAppeal(overrides: Record<string, unknown> = {}) {
  return {
    id: 11n,
    appellant_id: 2n, // 买家李同学
    appeal_type: 'dispute',
    target_id: 1n, // 订单 #1
    reason: '卖家失联，付款后未交付',
    evidence_urls: ['https://img/ev1.png'],
    status: 'pending',
    intervene_deadline: new Date('2026-10-09T12:00:00.000Z'),
    valid_until: new Date('2026-10-15T12:00:00.000Z'),
    result: null,
    handled_by: null,
    handled_at: null,
    handle_note: null,
    created_at: new Date('2026-10-07T12:00:00.000Z'),
    updated_at: new Date('2026-10-07T12:00:00.000Z'),
    ...overrides,
  };
}

const ORDER = {
  id: 1n,
  order_no: 'ES202610060I4BXB',
  buyer_id: 2n,
  seller_id: 1n,
  product_id: 5n,
  product_title: 'iPad 2019 128G WiFi 版',
  amount: '1200.00',
  status: 'appealing',
};

function makePrisma() {
  return {
    appeal: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    tradeOrder: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
    },
    user: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    },
    product: {
      update: jest.fn(),
    },
    report: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    adminOperationLog: {
      create: jest.fn(),
    },
  };
}

function setup() {
  const prisma = makePrisma();
  const repo = new AppealRepository(prisma as never);
  const notify = { send: jest.fn().mockResolvedValue({ id: '1' }) };
  const service = new AppealService(repo, notify as never);
  return { prisma, repo, notify, service };
}

describe('AppealService.getQueue（§5.3 #65）', () => {
  it('按 intervene_deadline 升序 + 契约列表项字段（related_no 取订单号）', async () => {
    const { prisma, service } = setup();
    prisma.appeal.findMany.mockResolvedValue([makeAppeal()]);
    prisma.appeal.count.mockResolvedValue(1);
    prisma.tradeOrder.findMany.mockResolvedValue([ORDER]);

    const res = await service.getQueue({}, NOW);

    expect(prisma.appeal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { intervene_deadline: 'asc' }, skip: 0, take: 20 }),
    );
    expect(res).toMatchObject({ page: 1, pageSize: 20, total: 1 });
    expect(res.list[0]).toEqual({
      id: '11',
      type: 'dispute',
      related_no: 'ES202610060I4BXB',
      submitted_at: '2026-10-07T12:00:00.000Z',
      intervene_deadline: '2026-10-09T12:00:00.000Z',
      status: 'pending',
    });
  });

  it("status='done' 映射 DB 枚举 in [resolved, expired]；输出 resolved→done", async () => {
    const { prisma, service } = setup();
    prisma.appeal.findMany.mockResolvedValue([makeAppeal({ status: 'resolved' })]);
    prisma.appeal.count.mockResolvedValue(1);
    prisma.tradeOrder.findMany.mockResolvedValue([ORDER]);

    const res = await service.getQueue({ status: 'done' }, NOW);

    expect(prisma.appeal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: { in: ['resolved', 'expired'] } } }),
    );
    expect(res.list[0].status).toBe('done');
  });

  it('type=punishment 过滤直传 DB；related_no 取处罚记录引用', async () => {
    const { prisma, service } = setup();
    prisma.appeal.findMany.mockResolvedValue([
      makeAppeal({ appeal_type: 'punishment', target_id: 77n }),
    ]);
    prisma.appeal.count.mockResolvedValue(1);

    const res = await service.getQueue({ type: 'punishment' }, NOW);

    expect(prisma.appeal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { appeal_type: 'punishment' } }),
    );
    expect(res.list[0].related_no).toBe('PUN-77');
  });

  it('type/status 非法抛 9001；pageSize 超上限抛 9001', async () => {
    const { service } = setup();
    await expect(service.getQueue({ type: 'xxx' }, NOW)).rejects.toMatchObject({ code: 9001 });
    await expect(service.getQueue({ status: 'xxx' }, NOW)).rejects.toMatchObject({ code: 9001 });
    await expect(service.getQueue({ pageSize: 51 }, NOW)).rejects.toMatchObject({ code: 9001 });
  });
});

describe('AppealService.getDetail（§5.3 #66）', () => {
  it('返回 {appeal}：理由/证据/上下文（含申诉人与被申诉对象）/48h 截止', async () => {
    const { prisma, service } = setup();
    prisma.appeal.findUnique.mockResolvedValue(makeAppeal());
    prisma.tradeOrder.findUnique.mockResolvedValue(ORDER);
    prisma.user.findMany.mockResolvedValue([
      { id: 1n, nickname: '张同学' },
      { id: 2n, nickname: '李同学' },
    ]);

    const res = await service.getDetail(11n, NOW);

    expect(res.appeal.id).toBe('11');
    expect(res.appeal.type).toBe('dispute');
    expect(res.appeal.related_no).toBe('ES202610060I4BXB');
    expect(res.appeal.reason).toBe('卖家失联，付款后未交付');
    expect(res.appeal.evidence_urls).toEqual(['https://img/ev1.png']);
    expect(res.appeal.intervene_deadline).toBe('2026-10-09T12:00:00.000Z');
    expect(res.appeal.chat_summary).toBeNull();
    const ctx = res.appeal.context as Record<string, unknown>;
    expect(ctx.appellant).toEqual({ id: '2', nickname: '李同学' });
    expect(ctx.respondent).toEqual({ id: '1', nickname: '张同学' });
    expect(ctx.order).toMatchObject({ order_no: 'ES202610060I4BXB', status: 'appealing' });
  });

  it('申诉不存在抛 4002', async () => {
    const { prisma, service } = setup();
    prisma.appeal.findUnique.mockResolvedValue(null);
    await expect(service.getDetail(999n, NOW)).rejects.toMatchObject({ code: 4002 });
  });
});

describe('AppealService.adjudicate（§5.3 #67，@rule CIM-R-31/PIM-EV-07）', () => {
  it('buyer_win：回写 resolved（DB result=support）+ 留痕 + 通知双方', async () => {
    const { prisma, notify, service } = setup();
    prisma.appeal.findUnique.mockResolvedValue(makeAppeal());
    prisma.appeal.update.mockResolvedValue(makeAppeal({ status: 'resolved' }));
    prisma.tradeOrder.findUnique.mockResolvedValue(ORDER);

    const res = await service.adjudicate('1', 11n, { result: 'buyer_win', note: '卖家失联属实' }, NOW);

    expect(prisma.appeal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 11n },
        data: expect.objectContaining({
          status: 'resolved',
          result: 'support',
          handled_by: 1n,
          handled_at: NOW,
          handle_note: '卖家失联属实',
        }),
      }),
    );
    // 处置留痕（admin_operation_log 不可变日志）
    expect(prisma.adminOperationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          admin_id: 1n,
          action: 'appeal.adjudicate',
          target_type: 'appeal',
          target_id: 11n,
          reason: '卖家失联属实',
        }),
      }),
    );
    // 通知双方：申诉人（买家）+ 被申诉对象（卖家）
    expect(notify.send).toHaveBeenCalledTimes(2);
    expect(notify.send).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 2n,
        type: 'appeal_result',
        payload: expect.objectContaining({ appeal_id: '11', result: 'buyer_win' }),
      }),
    );
    expect(notify.send).toHaveBeenCalledWith(expect.objectContaining({ user_id: 1n }));
    expect(res).toEqual({ appeal: { status: 'done', result: 'buyer_win' } });
  });

  it('result 枚举映射：seller_win→reject / both_warning→partial / invalid→reject', async () => {
    const { prisma, service } = setup();
    for (const [result, dbResult] of [
      ['seller_win', 'reject'],
      ['both_warning', 'partial'],
      ['invalid', 'reject'],
    ] as const) {
      prisma.appeal.findUnique.mockResolvedValue(makeAppeal());
      prisma.appeal.update.mockResolvedValue(makeAppeal({ status: 'resolved' }));
      prisma.tradeOrder.findUnique.mockResolvedValue(ORDER);
      await service.adjudicate('1', 11n, { result, note: '裁决备注' }, NOW);
      expect(prisma.appeal.update).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ result: dbResult }) }),
      );
    }
  });

  it('linked_action=off_shelf：纠纷申诉下架关联商品', async () => {
    const { prisma, service } = setup();
    prisma.appeal.findUnique.mockResolvedValue(makeAppeal());
    prisma.appeal.update.mockResolvedValue(makeAppeal({ status: 'resolved' }));
    prisma.tradeOrder.findUnique.mockResolvedValue(ORDER);

    await service.adjudicate(
      '1',
      11n,
      { result: 'buyer_win', note: '货不对板', linked_action: 'off_shelf' },
      NOW,
    );

    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: 5n },
      data: { status: 'off_sale' },
    });
  });

  it('linked_action=ban：封禁被申诉对象（banned_reason 取 note）', async () => {
    const { prisma, service } = setup();
    prisma.appeal.findUnique.mockResolvedValue(makeAppeal());
    prisma.appeal.update.mockResolvedValue(makeAppeal({ status: 'resolved' }));
    prisma.tradeOrder.findUnique.mockResolvedValue(ORDER);

    await service.adjudicate(
      '1',
      11n,
      { result: 'buyer_win', note: '恶意欺诈', linked_action: 'ban' },
      NOW,
    );

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 1n },
      data: { status: 'banned', banned_reason: '恶意欺诈', banned_at: NOW },
    });
  });

  it('punishment 申诉 linked_action=off_shelf 抛 4002（无关联商品）', async () => {
    const { prisma, service } = setup();
    prisma.appeal.findUnique.mockResolvedValue(
      makeAppeal({ appeal_type: 'punishment', target_id: 77n }),
    );

    await expect(
      service.adjudicate('1', 11n, { result: 'invalid', note: 'x', linked_action: 'off_shelf' }, NOW),
    ).rejects.toMatchObject({ code: 4002 });
  });

  it('punishment 申诉裁决：仅通知申诉人（被申诉对象为平台处置）', async () => {
    const { prisma, notify, service } = setup();
    prisma.appeal.findUnique.mockResolvedValue(
      makeAppeal({ appeal_type: 'punishment', target_id: 77n }),
    );
    prisma.appeal.update.mockResolvedValue(makeAppeal({ status: 'resolved' }));

    await service.adjudicate('1', 11n, { result: 'invalid', note: '处置无误' }, NOW);

    expect(notify.send).toHaveBeenCalledTimes(1);
    expect(notify.send).toHaveBeenCalledWith(expect.objectContaining({ user_id: 2n }));
  });

  it('result 非法抛 4002；note 缺失抛 9001；linked_action 非法抛 4002', async () => {
    const { service } = setup();
    await expect(
      service.adjudicate('1', 11n, { result: 'free_text', note: 'x' }, NOW),
    ).rejects.toMatchObject({ code: 4002 });
    await expect(
      service.adjudicate('1', 11n, { result: 'buyer_win' }, NOW),
    ).rejects.toMatchObject({ code: 9001 });
    await expect(
      service.adjudicate('1', 11n, { result: 'buyer_win', note: 'x', linked_action: 'delete' }, NOW),
    ).rejects.toMatchObject({ code: 4002 });
  });

  it('已结案/超有效期申诉抛 4002（状态机守卫，不可重复裁决）', async () => {
    const { prisma, service } = setup();
    for (const status of ['resolved', 'expired']) {
      prisma.appeal.findUnique.mockResolvedValue(makeAppeal({ status }));
      await expect(
        service.adjudicate('1', 11n, { result: 'buyer_win', note: 'x' }, NOW),
      ).rejects.toMatchObject({ code: 4002 });
    }
  });

  it('申诉不存在抛 4002', async () => {
    const { prisma, service } = setup();
    prisma.appeal.findUnique.mockResolvedValue(null);
    await expect(
      service.adjudicate('1', 999n, { result: 'buyer_win', note: 'x' }, NOW),
    ).rejects.toMatchObject({ code: 4002 });
  });

  it('BusinessError 类型可用', () => {
    expect(new BusinessError(4002, 'x').name).toBe('BusinessError');
  });
});
