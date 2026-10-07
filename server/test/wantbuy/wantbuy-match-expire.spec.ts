/**
 * wantbuy-match-expire.spec.ts —— T-202 求购撮合与到期 cron
 *
 * @module PIM-BC-02 商品与供给（求购子域）
 * @model PIM-AG-04 求购聚合
 * @statemachine PIM-SM-03 求购状态机（active → expired 到期失效，由 cron 处置，终态不可复活）
 * @rule CIM-R-33 30 天有效期；第 27 天（到期前 3 天窗口）提醒；终态停止一切撮合通知
 * @event PIM-EV-11 求购撮合命中（商品上架后匹配 → want_buy_match 通知）
 * @event PIM-EV-12 求购到期提醒（第 27 天扫描 → want_buy_expire 通知）
 * @ac F9-AC1 撮合命中推送给求购者 / F9-AC2 第 27 天提醒、第 30 天未续期失效停撮合
 *
 * 口径声明：
 * - 撮合匹配要素 = 同品类 + 关键词（求购 title）命中商品 title（求购 title 为空视为不限）+
 *   商品 price ≤ 求购 price_max（price_max 为 NULL 则无上限通过）；仅消费 active 且未过期求购。
 * - 提醒窗口口径：expire_at-3d ≤ now < expire_at（即 now < expire_at ≤ now+3d）；
 *   「未提醒过」以当前有效期（periodStart = expire_at-30d）内是否已存在 want_buy_expire 通知判重。
 * - 无真实 MySQL：PrismaService / NotifySenderService 一律 jest mock（同 wantbuy-crud.spec.ts 口径）。
 */
import { NotificationType, WantBuyStatus } from '@contract/index';
import { PrismaService } from '../../src/infra/prisma.service';
import { NotifySenderService } from '../../src/infra/notify-sender/notify-sender.service';
import { WantBuyMatchService } from '../../src/modules/wantbuy/wantbuy-match.service';
import { WantBuyExpireCron } from '../../src/modules/wantbuy/wantbuy-expire.cron';

// ---------- 测试夹具 ----------

const DAY_MS = 24 * 3600 * 1000;
const NOW = new Date('2026-10-06T08:00:00.000Z');

/** 新上架商品（撮合触发输入） */
const makeProduct = (over: Record<string, unknown> = {}) => ({
  id: BigInt(900),
  category_id: BigInt(10),
  title: '九成新二手平板，配件齐全',
  price: 1200,
  ...over,
});

/** active 求购行（price_max 以字符串模拟 Prisma Decimal） */
const makeWantBuyRow = (over: Record<string, unknown> = {}) => ({
  id: BigInt(100),
  user_id: BigInt(1),
  school_id: BigInt(7),
  category_id: BigInt(10),
  title: '平板',
  description: '预算内即可',
  price_min: null,
  price_max: '1500.00',
  condition_level: null,
  status: 'active',
  expire_at: new Date(NOW.getTime() + 10 * DAY_MS),
  renewed_count: 0,
  renewed_at: null,
  closed_at: null,
  created_at: new Date(NOW.getTime() - 20 * DAY_MS),
  updated_at: new Date(NOW.getTime() - 20 * DAY_MS),
  ...over,
});

const makePrismaMock = () =>
  ({
    wantBuy: { findMany: jest.fn(), update: jest.fn() },
    notification: { findFirst: jest.fn() },
  }) as unknown as PrismaService & {
    wantBuy: { findMany: jest.Mock; update: jest.Mock };
    notification: { findFirst: jest.Mock };
  };

const makeNotifyMock = () =>
  ({
    send: jest.fn().mockResolvedValue({ id: '1' }),
  }) as unknown as NotifySenderService & { send: jest.Mock };

const setupMatch = () => {
  const prisma = makePrismaMock();
  const notify = makeNotifyMock();
  const service = new WantBuyMatchService(prisma, notify);
  return { prisma, notify, service };
};

const setupCron = () => {
  const prisma = makePrismaMock();
  const notify = makeNotifyMock();
  const cron = new WantBuyExpireCron(prisma, notify);
  return { prisma, notify, cron };
};

// ---------- PIM-EV-11：商品上架撮合（@ac F9-AC1，@rule CIM-R-33 仅消费 active 未过期） ----------

describe('WantBuyMatchService.matchOnProductPublished（@event PIM-EV-11，@ac F9-AC1）', () => {
  it('同品类 + 关键词命中 + 价格在上限内 → 发 want_buy_match 通知，payload 含 want_buy_id/product_id', async () => {
    const { prisma, notify, service } = setupMatch();
    prisma.wantBuy.findMany.mockResolvedValue([makeWantBuyRow()]);

    const matched = await service.matchOnProductPublished(makeProduct());

    expect(matched).toBe(1);
    expect(notify.send).toHaveBeenCalledTimes(1);
    const arg = notify.send.mock.calls[0][0];
    expect(arg.user_id).toBe(BigInt(1));
    expect(arg.type).toBe(NotificationType.WANT_BUY_MATCH);
    expect(arg.title).toContain('九成新二手平板');
    expect(arg.payload).toMatchObject({ want_buy_id: '100', product_id: '900' });
  });

  it('撮合查询口径：仅 active 且未过期、同品类、price_max 为空或 ≥ 商品价', async () => {
    const { prisma, service } = setupMatch();
    prisma.wantBuy.findMany.mockResolvedValue([]);

    await service.matchOnProductPublished(makeProduct());

    const where = prisma.wantBuy.findMany.mock.calls[0][0].where;
    expect(where.status).toBe(WantBuyStatus.ACTIVE);
    expect(where.category_id).toBe(BigInt(10));
    expect(where.expire_at.gt).toBeInstanceOf(Date);
    expect(where.OR).toEqual([{ price_max: null }, { price_max: { gte: 1200 } }]);
  });

  it('价格超过求购 price_max 上限 → 不匹配、不发通知', async () => {
    const { prisma, notify, service } = setupMatch();
    // DB 侧会被 OR 条件挡下；此处 mock 放行以验证服务侧防御口径
    prisma.wantBuy.findMany.mockResolvedValue([makeWantBuyRow({ price_max: '1500.00' })]);

    const matched = await service.matchOnProductPublished(makeProduct({ price: 2000 }));

    expect(matched).toBe(0);
    expect(notify.send).not.toHaveBeenCalled();
  });

  it('求购关键词（title）未命中商品 title → 不匹配、不发通知', async () => {
    const { prisma, notify, service } = setupMatch();
    prisma.wantBuy.findMany.mockResolvedValue([makeWantBuyRow({ title: '电饭煲' })]);

    const matched = await service.matchOnProductPublished(makeProduct());

    expect(matched).toBe(0);
    expect(notify.send).not.toHaveBeenCalled();
  });

  it('求购 title 为空（不限关键词）→ 仅按品类+价格撮合', async () => {
    const { prisma, notify, service } = setupMatch();
    prisma.wantBuy.findMany.mockResolvedValue([makeWantBuyRow({ title: '  ' })]);

    const matched = await service.matchOnProductPublished(makeProduct());

    expect(matched).toBe(1);
    expect(notify.send).toHaveBeenCalledTimes(1);
  });

  it('price_max 为 NULL（无上限）→ 价格条件通过', async () => {
    const { prisma, notify, service } = setupMatch();
    prisma.wantBuy.findMany.mockResolvedValue([makeWantBuyRow({ price_max: null })]);

    const matched = await service.matchOnProductPublished(makeProduct({ price: 99999 }));

    expect(matched).toBe(1);
    expect(notify.send).toHaveBeenCalledTimes(1);
  });

  it('已过期求购不参与撮合（@rule CIM-R-33 终态/失效停撮合）', async () => {
    const { prisma, notify, service } = setupMatch();
    prisma.wantBuy.findMany.mockResolvedValue([
      makeWantBuyRow({ expire_at: new Date(NOW.getTime() - DAY_MS) }),
    ]);

    const matched = await service.matchOnProductPublished(makeProduct());

    expect(matched).toBe(0);
    expect(notify.send).not.toHaveBeenCalled();
  });

  it('非 active（closed/bought/expired）求购不参与撮合', async () => {
    const { prisma, notify, service } = setupMatch();
    prisma.wantBuy.findMany.mockResolvedValue([
      makeWantBuyRow({ id: BigInt(101), status: 'closed' }),
      makeWantBuyRow({ id: BigInt(102), status: 'bought' }),
      makeWantBuyRow({ id: BigInt(103), status: 'expired' }),
    ]);

    const matched = await service.matchOnProductPublished(makeProduct());

    expect(matched).toBe(0);
    expect(notify.send).not.toHaveBeenCalled();
  });

  it('多个求购命中 → 逐个发布者各发一条通知', async () => {
    const { prisma, notify, service } = setupMatch();
    prisma.wantBuy.findMany.mockResolvedValue([
      makeWantBuyRow({ id: BigInt(100), user_id: BigInt(1) }),
      makeWantBuyRow({ id: BigInt(101), user_id: BigInt(2) }),
    ]);

    const matched = await service.matchOnProductPublished(makeProduct());

    expect(matched).toBe(2);
    expect(notify.send).toHaveBeenCalledTimes(2);
    expect(notify.send.mock.calls[1][0].user_id).toBe(BigInt(2));
    expect(notify.send.mock.calls[1][0].payload).toMatchObject({ want_buy_id: '101' });
  });
});

// ---------- PIM-EV-12 + PIM-SM-03：到期提醒与自动失效（@ac F9-AC2） ----------

describe('WantBuyExpireCron.runDaily（@event PIM-EV-12，@statemachine PIM-SM-03，@ac F9-AC2）', () => {
  it('扫描口径：仅 active 且 expire_at ≤ now+3d（提醒窗口右界）', async () => {
    const { prisma, cron } = setupCron();
    prisma.wantBuy.findMany.mockResolvedValue([]);

    await cron.runDaily(NOW);

    const where = prisma.wantBuy.findMany.mock.calls[0][0].where;
    expect(where.status).toBe(WantBuyStatus.ACTIVE);
    expect(where.expire_at.lte.getTime()).toBe(NOW.getTime() + 3 * DAY_MS);
  });

  it('到期前 3 天提醒窗口内（expire_at-3d ≤ now < expire_at）且未提醒过 → 发 want_buy_expire 通知', async () => {
    const { prisma, notify, cron } = setupCron();
    prisma.wantBuy.findMany.mockResolvedValue([
      makeWantBuyRow({ expire_at: new Date(NOW.getTime() + 2 * DAY_MS) }),
    ]);
    prisma.notification.findFirst.mockResolvedValue(null);

    await cron.runDaily(NOW);

    expect(notify.send).toHaveBeenCalledTimes(1);
    const arg = notify.send.mock.calls[0][0];
    expect(arg.user_id).toBe(BigInt(1));
    expect(arg.type).toBe(NotificationType.WANT_BUY_EXPIRE);
    expect(arg.payload).toMatchObject({ want_buy_id: '100' });
    expect(prisma.wantBuy.update).not.toHaveBeenCalled();
  });

  it('窗口右界边界：expire_at = now+3d 整 → 仍发提醒', async () => {
    const { prisma, notify, cron } = setupCron();
    prisma.wantBuy.findMany.mockResolvedValue([
      makeWantBuyRow({ expire_at: new Date(NOW.getTime() + 3 * DAY_MS) }),
    ]);
    prisma.notification.findFirst.mockResolvedValue(null);

    await cron.runDaily(NOW);

    expect(notify.send).toHaveBeenCalledTimes(1);
  });

  it('提醒窗口外（expire_at > now+3d）→ 不提醒、不置 expired', async () => {
    const { prisma, notify, cron } = setupCron();
    prisma.wantBuy.findMany.mockResolvedValue([
      makeWantBuyRow({ expire_at: new Date(NOW.getTime() + 5 * DAY_MS) }),
    ]);

    await cron.runDaily(NOW);

    expect(notify.send).not.toHaveBeenCalled();
    expect(prisma.wantBuy.update).not.toHaveBeenCalled();
  });

  it('当前有效期内已提醒过 → 不重复提醒（判重：want_buy_expire 通知存在）', async () => {
    const { prisma, notify, cron } = setupCron();
    prisma.wantBuy.findMany.mockResolvedValue([
      makeWantBuyRow({ expire_at: new Date(NOW.getTime() + DAY_MS) }),
    ]);
    prisma.notification.findFirst.mockResolvedValue({ id: BigInt(555) });

    await cron.runDaily(NOW);

    expect(notify.send).not.toHaveBeenCalled();
    // 判重查询按类型 + payload.want_buy_id + 当前有效期起点
    const q = prisma.notification.findFirst.mock.calls[0][0].where;
    expect(q.type).toBe(NotificationType.WANT_BUY_EXPIRE);
    expect(q.created_at.gte.getTime()).toBe(NOW.getTime() + DAY_MS - 30 * DAY_MS);
  });

  it('第 30 天未续期（expire_at ≤ now）→ 置 expired，停止撮合，不发提醒', async () => {
    const { prisma, notify, cron } = setupCron();
    prisma.wantBuy.findMany.mockResolvedValue([
      makeWantBuyRow({ expire_at: new Date(NOW.getTime() - 1000) }),
    ]);
    prisma.wantBuy.update.mockResolvedValue(makeWantBuyRow({ status: 'expired' }));

    await cron.runDaily(NOW);

    const updateArg = prisma.wantBuy.update.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: BigInt(100) });
    expect(updateArg.data.status).toBe(WantBuyStatus.EXPIRED);
    expect(notify.send).not.toHaveBeenCalled();
  });

  it('expire_at = now 恰到期 → 置 expired（到期边界归属失效侧）', async () => {
    const { prisma, cron } = setupCron();
    prisma.wantBuy.findMany.mockResolvedValue([makeWantBuyRow({ expire_at: NOW })]);
    prisma.wantBuy.update.mockResolvedValue(makeWantBuyRow({ status: 'expired' }));

    await cron.runDaily(NOW);

    expect(prisma.wantBuy.update).toHaveBeenCalledTimes(1);
    expect(prisma.wantBuy.update.mock.calls[0][0].data.status).toBe(WantBuyStatus.EXPIRED);
  });

  it('已 expired（非 active）求购不重复处理（@statemachine PIM-SM-03 终态不可复活）', async () => {
    const { prisma, notify, cron } = setupCron();
    prisma.wantBuy.findMany.mockResolvedValue([
      makeWantBuyRow({ status: 'expired', expire_at: new Date(NOW.getTime() - DAY_MS) }),
      makeWantBuyRow({ status: 'closed', expire_at: new Date(NOW.getTime() - DAY_MS) }),
    ]);

    await cron.runDaily(NOW);

    expect(prisma.wantBuy.update).not.toHaveBeenCalled();
    expect(notify.send).not.toHaveBeenCalled();
  });

  it('单条处理异常不中断本轮其余求购（逐条隔离）', async () => {
    const { prisma, notify, cron } = setupCron();
    prisma.wantBuy.findMany.mockResolvedValue([
      makeWantBuyRow({ id: BigInt(100), expire_at: new Date(NOW.getTime() - 1000) }),
      makeWantBuyRow({ id: BigInt(101), expire_at: new Date(NOW.getTime() - 1000) }),
    ]);
    prisma.wantBuy.update
      .mockRejectedValueOnce(new Error('DB 抖动'))
      .mockResolvedValueOnce(makeWantBuyRow({ id: BigInt(101), status: 'expired' }));

    await cron.runDaily(NOW);

    expect(prisma.wantBuy.update).toHaveBeenCalledTimes(2);
    expect(notify.send).not.toHaveBeenCalled();
  });
});

// ---------- 调度器自含：start/stop 幂等（§2.4 进程内 cron，env 门控） ----------

describe('WantBuyExpireCron 调度（start/stop 幂等，env WANT_BUY_EXPIRE_CRON_ENABLED 门控）', () => {
  it('start/stop 幂等：重复 start 不叠加定时器，stop 后可再 start', () => {
    const { cron } = setupCron();

    expect(cron.isRunning()).toBe(false);
    cron.start();
    expect(cron.isRunning()).toBe(true);
    cron.start();
    expect(cron.isRunning()).toBe(true);
    cron.stop();
    expect(cron.isRunning()).toBe(false);
    cron.stop();
    expect(cron.isRunning()).toBe(false);
    cron.start();
    expect(cron.isRunning()).toBe(true);
    cron.stop();
  });
});
