/**
 * wantbuy-crud.spec.ts —— T-201 求购发布/列表/续期/关闭/已买到
 *
 * @module PIM-BC-02 商品与供给（求购子域）
 * @model PIM-AG-04 求购聚合
 * @statemachine PIM-SM-03 求购状态机（[*]→active；active→closed/bought 终态不可复活；到期 expired 由 cron 处置）
 * @api §5.2 #20 POST /want-buys、#24 GET /want-buys、#21 renew、#22 close、#23 bought
 * @ac F9-AC1 发布成功撮合面（active 可见）/ F9-AC2 有效期 30 天 + 续期重置 / F9-AC3 关闭/已买到即出列停撮合
 *
 * 口径声明：有效期 30 天（PSM-INC-02，覆盖契约 #20/#21 错标的 7 天）；
 * 终态再操作 / 非 active 续期 → 4002；非本人 → 1003；字段缺失 → 9001。
 *
 * 无真实 MySQL：PrismaService 一律 jest mock（同 product-publish.spec.ts 口径）。
 */
import { ERROR_CODES, WantBuyStatus } from '@contract/index';
import { WantBuyController } from '../../src/modules/wantbuy/wantbuy.controller';
import { WantBuyService, BusinessError } from '../../src/modules/wantbuy/wantbuy.service';
import type { UserContext } from '../../src/modules/wantbuy/wantbuy.service';
import { WantBuyRepository } from '../../src/modules/wantbuy/wantbuy.repository';
import {
  validatePublishFields,
  WANT_BUY_PROHIBITED_WORDS,
  WANT_BUY_VIOLATION_WORDS,
  findHitWords,
} from '../../src/modules/wantbuy/wantbuy.validator';
import { PrismaService } from '../../src/infra/prisma.service';

// ---------- 测试夹具 ----------

const USER: UserContext = { id: BigInt(1), schoolId: BigInt(7) };

/** 合法发布请求体（契约 §5.2 #20 字段；desc 为求购描述） */
const makeBody = (over: Record<string, unknown> = {}) => ({
  title: '求购二手平板',
  desc: '预算 1500 内，成色良好即可',
  category_id: '10',
  ...over,
});

const DAY_MS = 24 * 3600 * 1000;

const makeWantBuyRow = (over: Record<string, unknown> = {}) => ({
  id: BigInt(100),
  user_id: USER.id,
  school_id: USER.schoolId,
  category_id: BigInt(10),
  title: '求购二手平板',
  description: '预算 1500 内，成色良好即可',
  price_min: null,
  price_max: null,
  condition_level: null,
  status: 'active',
  expire_at: new Date('2026-11-05T00:00:00.000Z'),
  renewed_count: 0,
  renewed_at: null,
  closed_at: null,
  created_at: new Date('2026-10-06T00:00:00.000Z'),
  updated_at: new Date('2026-10-06T00:00:00.000Z'),
  ...over,
});

const makePrismaMock = () =>
  ({
    category: { findUnique: jest.fn() },
    wantBuy: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    violationInterceptLog: { create: jest.fn() },
  }) as unknown as PrismaService & {
    category: { findUnique: jest.Mock };
    wantBuy: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    violationInterceptLog: { create: jest.Mock };
  };

const setup = () => {
  const prisma = makePrismaMock();
  const repo = new WantBuyRepository(prisma);
  const service = new WantBuyService(repo);
  return { prisma, repo, service };
};

/** 标准就绪态：品类存在且 active */
const mockHappyPath = (prisma: ReturnType<typeof makePrismaMock>) => {
  prisma.category.findUnique.mockResolvedValue({ id: BigInt(10), parent_id: BigInt(0), name: '数码', status: 'active' });
  prisma.wantBuy.create.mockResolvedValue(makeWantBuyRow());
};

// ---------- F9-AC1：发布（@api §5.2 #20） ----------

describe('WantBuyService.publish（@api §5.2 #20，@ac F9-AC1）', () => {
  it('字段齐全：发布成功，返回 id 与 expire_at，初始 status=active', async () => {
    const { prisma, service } = setup();
    mockHappyPath(prisma);

    const result = await service.publish(USER, makeBody());

    expect(result.id).toBe('100');
    expect(result.expire_at).toBe(makeWantBuyRow().expire_at.toISOString());
    const createArg = prisma.wantBuy.create.mock.calls[0][0];
    expect(createArg.data.status).toBe(WantBuyStatus.ACTIVE);
  });

  it('有效期口径：expire_at = now + 30 天（PSM-INC-02，非契约错标的 7 天）', async () => {
    const { prisma, service } = setup();
    mockHappyPath(prisma);
    const before = Date.now();

    await service.publish(USER, makeBody());

    const after = Date.now();
    const expireAt: Date = prisma.wantBuy.create.mock.calls[0][0].data.expire_at;
    expect(expireAt.getTime()).toBeGreaterThanOrEqual(before + 30 * DAY_MS);
    expect(expireAt.getTime()).toBeLessThanOrEqual(after + 30 * DAY_MS);
  });

  it('落库字段映射正确（@table want_buy → PIM-AG-04）：user_id/school_id/category_id/title/description', async () => {
    const { prisma, service } = setup();
    mockHappyPath(prisma);

    await service.publish(USER, makeBody({ max_price: '1500.00', condition_level: 'good' }));

    const data = prisma.wantBuy.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      user_id: BigInt(1),
      school_id: BigInt(7),
      category_id: BigInt(10),
      title: '求购二手平板',
      description: '预算 1500 内，成色良好即可',
      condition_level: 'good',
    });
    expect(String(data.price_max)).toBe('1500.00');
  });

  it('缺字段逐项拦截 9001（标题/描述/品类），不落库', async () => {
    const { prisma, service } = setup();
    mockHappyPath(prisma);
    const body = { title: '', category_id: 'abc' }; // desc 缺失

    await expect(service.publish(USER, body)).rejects.toMatchObject({
      code: ERROR_CODES.PARAM_VALIDATION_FAILED,
    });
    await expect(service.publish(USER, body)).rejects.toThrow(/标题/);
    await expect(service.publish(USER, body)).rejects.toThrow(/描述/);
    await expect(service.publish(USER, body)).rejects.toThrow(/品类/);
    expect(prisma.wantBuy.create).not.toHaveBeenCalled();
  });

  it('品类不存在 → 9001 拦截，不落库', async () => {
    const { prisma, service } = setup();
    mockHappyPath(prisma);
    prisma.category.findUnique.mockResolvedValue(null);

    await expect(service.publish(USER, makeBody())).rejects.toMatchObject({
      code: ERROR_CODES.PARAM_VALIDATION_FAILED,
    });
    expect(prisma.wantBuy.create).not.toHaveBeenCalled();
  });

  it('标题命中违禁词 → 9001 硬拦截，写 violation_intercept_log（scene=want_buy, action=blocked），不落库（@rule CIM-R-08）', async () => {
    const { prisma, service } = setup();
    mockHappyPath(prisma);
    const word = WANT_BUY_PROHIBITED_WORDS[0];

    await expect(service.publish(USER, makeBody({ title: `求购${word}` }))).rejects.toMatchObject({
      code: ERROR_CODES.PARAM_VALIDATION_FAILED,
    });

    expect(prisma.violationInterceptLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.violationInterceptLog.create.mock.calls[0][0].data).toMatchObject({
      scene: 'want_buy',
      action: 'blocked',
      user_id: USER.id,
      target_id: null,
      hit_word: word,
    });
    expect(prisma.wantBuy.create).not.toHaveBeenCalled();
  });

  it('描述命中违规词 → 同样硬拦截并留痕（scene=want_buy）', async () => {
    const { prisma, service } = setup();
    mockHappyPath(prisma);
    const word = WANT_BUY_VIOLATION_WORDS[0];

    await expect(service.publish(USER, makeBody({ desc: `联系请${word}` }))).rejects.toThrow(word);
    expect(prisma.violationInterceptLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.wantBuy.create).not.toHaveBeenCalled();
  });
});

// ---------- #24：列表（scope 与过滤） ----------

describe('WantBuyService.list（@api §5.2 #24，@ac F9-AC1/F9-AC3）', () => {
  it('scope=all（缺省）：仅 active 状态、不限定 user_id，返回分页包络', async () => {
    const { prisma, service } = setup();
    prisma.wantBuy.findMany.mockResolvedValue([makeWantBuyRow()]);
    prisma.wantBuy.count.mockResolvedValue(1);

    const result = await service.list(null, {});

    const where = prisma.wantBuy.findMany.mock.calls[0][0].where;
    expect(where.status).toBe(WantBuyStatus.ACTIVE);
    expect(where.user_id).toBeUndefined();
    expect(result).toMatchObject({ page: 1, pageSize: 20, total: 1 });
    expect(result.list[0]).toMatchObject({ id: '100', status: 'active' });
  });

  it('scope=mine：where 限定 user_id，仍仅 active', async () => {
    const { prisma, service } = setup();
    prisma.wantBuy.findMany.mockResolvedValue([]);
    prisma.wantBuy.count.mockResolvedValue(0);

    await service.list(USER, { scope: 'mine' });

    const where = prisma.wantBuy.findMany.mock.calls[0][0].where;
    expect(where.user_id).toBe(USER.id);
    expect(where.status).toBe(WantBuyStatus.ACTIVE);
  });

  it('scope=mine 未登录 → 1001', async () => {
    const { service } = setup();

    await expect(service.list(null, { scope: 'mine' })).rejects.toMatchObject({
      code: ERROR_CODES.AUTH_TOKEN_INVALID,
    });
  });

  it('关键词与品类过滤：keyword 命中 title/description OR，category_id 精确匹配', async () => {
    const { prisma, service } = setup();
    prisma.wantBuy.findMany.mockResolvedValue([]);
    prisma.wantBuy.count.mockResolvedValue(0);

    await service.list(null, { keyword: '平板', category_id: '10', page: '2', pageSize: '10' });

    const args = prisma.wantBuy.findMany.mock.calls[0][0];
    expect(args.where.category_id).toBe(BigInt(10));
    expect(args.where.OR).toEqual([
      { title: { contains: '平板' } },
      { description: { contains: '平板' } },
    ]);
    expect(args.skip).toBe(10);
    expect(args.take).toBe(10);
  });

  it('closed/bought/expired 不出现在列表（仅 active 过滤由 where 保证）', async () => {
    const { prisma, service } = setup();
    prisma.wantBuy.findMany.mockResolvedValue([]);
    prisma.wantBuy.count.mockResolvedValue(0);

    await service.list(null, {});

    expect(prisma.wantBuy.findMany.mock.calls[0][0].where.status).toBe('active');
  });

  it('非法 scope / 分页参数 → 9001', async () => {
    const { service } = setup();

    await expect(service.list(USER, { scope: 'all2' })).rejects.toMatchObject({
      code: ERROR_CODES.PARAM_VALIDATION_FAILED,
    });
    await expect(service.list(null, { page: '0' })).rejects.toMatchObject({
      code: ERROR_CODES.PARAM_VALIDATION_FAILED,
    });
    await expect(service.list(null, { pageSize: '51' })).rejects.toMatchObject({
      code: ERROR_CODES.PARAM_VALIDATION_FAILED,
    });
  });
});

// ---------- F9-AC2：续期（@api §5.2 #21，@rule CIM-R-33） ----------

describe('WantBuyService.renew（@api §5.2 #21，@rule CIM-R-33，@ac F9-AC2）', () => {
  it('本人 + active：expire_at 重置为 now+30 天，renewed_count+1、renewed_at 落时', async () => {
    const { prisma, service } = setup();
    prisma.wantBuy.findUnique.mockResolvedValue(makeWantBuyRow());
    prisma.wantBuy.update.mockResolvedValue(
      makeWantBuyRow({ renewed_count: 1, expire_at: new Date('2026-11-05T00:00:00.000Z') }),
    );
    const before = Date.now();

    const result = await service.renew(USER, '100');

    const after = Date.now();
    const updateArg = prisma.wantBuy.update.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: BigInt(100) });
    const expireAt: Date = updateArg.data.expire_at;
    expect(expireAt.getTime()).toBeGreaterThanOrEqual(before + 30 * DAY_MS);
    expect(expireAt.getTime()).toBeLessThanOrEqual(after + 30 * DAY_MS);
    expect(updateArg.data.renewed_count).toBe(1);
    expect(updateArg.data.renewed_at).toBeInstanceOf(Date);
    expect(result.expire_at).toBe('2026-11-05T00:00:00.000Z');
  });

  it('非本人 → 1003，不更新', async () => {
    const { prisma, service } = setup();
    prisma.wantBuy.findUnique.mockResolvedValue(makeWantBuyRow({ user_id: BigInt(999) }));

    await expect(service.renew(USER, '100')).rejects.toMatchObject({
      code: ERROR_CODES.PERMISSION_DENIED,
    });
    expect(prisma.wantBuy.update).not.toHaveBeenCalled();
  });

  it.each([
    ['closed', WantBuyStatus.CLOSED],
    ['bought', WantBuyStatus.BOUGHT],
    ['expired', WantBuyStatus.EXPIRED],
  ])('非 active（%s）续期 → 4002，不更新', async (_label, status) => {
    const { prisma, service } = setup();
    prisma.wantBuy.findUnique.mockResolvedValue(makeWantBuyRow({ status }));

    await expect(service.renew(USER, '100')).rejects.toMatchObject({
      code: ERROR_CODES.ORDER_STATUS_CONFLICT,
    });
    expect(prisma.wantBuy.update).not.toHaveBeenCalled();
  });

  it('求购不存在 → 9001', async () => {
    const { prisma, service } = setup();
    prisma.wantBuy.findUnique.mockResolvedValue(null);

    await expect(service.renew(USER, '100')).rejects.toMatchObject({
      code: ERROR_CODES.PARAM_VALIDATION_FAILED,
    });
  });

  it('id 非法 → 9001', async () => {
    const { service } = setup();

    await expect(service.renew(USER, 'abc')).rejects.toMatchObject({
      code: ERROR_CODES.PARAM_VALIDATION_FAILED,
    });
  });
});

// ---------- F9-AC3：关闭与已买到（@api §5.2 #22/#23，@statemachine PIM-SM-03 终态） ----------

describe('WantBuyService.close / bought（@api §5.2 #22/#23，@ac F9-AC3）', () => {
  it('本人 + active：关闭 → closed 终态，closed_at 落时（立即停撮合）', async () => {
    const { prisma, service } = setup();
    prisma.wantBuy.findUnique.mockResolvedValue(makeWantBuyRow());
    prisma.wantBuy.update.mockResolvedValue(makeWantBuyRow({ status: 'closed' }));

    const result = await service.close(USER, '100');

    const updateArg = prisma.wantBuy.update.mock.calls[0][0];
    expect(updateArg.data.status).toBe(WantBuyStatus.CLOSED);
    expect(updateArg.data.closed_at).toBeInstanceOf(Date);
    expect(result.status).toBe(WantBuyStatus.CLOSED);
  });

  it('本人 + active：标记已买到 → bought 终态，closed_at 落时', async () => {
    const { prisma, service } = setup();
    prisma.wantBuy.findUnique.mockResolvedValue(makeWantBuyRow());
    prisma.wantBuy.update.mockResolvedValue(makeWantBuyRow({ status: 'bought' }));

    const result = await service.markBought(USER, '100');

    const updateArg = prisma.wantBuy.update.mock.calls[0][0];
    expect(updateArg.data.status).toBe(WantBuyStatus.BOUGHT);
    expect(updateArg.data.closed_at).toBeInstanceOf(Date);
    expect(result.status).toBe(WantBuyStatus.BOUGHT);
  });

  it.each([
    ['close', 'closed'],
    ['markBought', 'bought'],
  ] as const)('%s：非本人 → 1003，不更新', async (method, status) => {
    const { prisma, service } = setup();
    prisma.wantBuy.findUnique.mockResolvedValue(makeWantBuyRow({ user_id: BigInt(999) }));

    await expect(service[method](USER, '100')).rejects.toMatchObject({
      code: ERROR_CODES.PERMISSION_DENIED,
    });
    expect(status).toBeTruthy();
    expect(prisma.wantBuy.update).not.toHaveBeenCalled();
  });

  it.each([
    ['close', 'closed'],
    ['close', 'bought'],
    ['markBought', 'closed'],
    ['markBought', 'bought'],
    ['close', 'expired'],
    ['markBought', 'expired'],
  ] as const)('%s：当前为 %s 终态/失效态再操作 → 4002（终态不可复活）', async (method, status) => {
    const { prisma, service } = setup();
    prisma.wantBuy.findUnique.mockResolvedValue(makeWantBuyRow({ status }));

    await expect(service[method](USER, '100')).rejects.toMatchObject({
      code: ERROR_CODES.ORDER_STATUS_CONFLICT,
    });
    expect(prisma.wantBuy.update).not.toHaveBeenCalled();
  });
});

// ---------- WantBuyController：统一响应包络与鉴权上下文 ----------

describe('WantBuyController（@api §5.2 #20-24，统一响应包络 §5.1）', () => {
  const authedReq = () => ({ user: { id: '1', school_id: '7', identity_type: 'student' } });

  const makeService = () => ({
    publish: jest.fn().mockResolvedValue({ id: '100', expire_at: '2026-11-05T00:00:00.000Z' }),
    list: jest.fn().mockResolvedValue({ page: 1, pageSize: 20, total: 0, list: [] }),
    renew: jest.fn().mockResolvedValue({ expire_at: '2026-11-05T00:00:00.000Z' }),
    close: jest.fn().mockResolvedValue({ status: 'closed' }),
    markBought: jest.fn().mockResolvedValue({ status: 'bought' }),
  });

  it('POST /want-buys：成功返回 { code:0, message:"ok", data:{ id, expire_at } }，user 上下文转 BigInt', async () => {
    const service = makeService();
    const controller = new WantBuyController(service as unknown as WantBuyService);

    const res = await controller.publish(makeBody(), authedReq());

    expect(res.code).toBe(0);
    expect(res.message).toBe('ok');
    expect(res.data).toEqual({ id: '100', expire_at: '2026-11-05T00:00:00.000Z' });
    expect(service.publish).toHaveBeenCalledWith(
      { id: BigInt(1), schoolId: BigInt(7) },
      expect.objectContaining({ title: '求购二手平板' }),
    );
  });

  it('POST /want-buys：未登录 → 1001，不透传 service', async () => {
    const service = makeService();
    const controller = new WantBuyController(service as unknown as WantBuyService);

    await expect(controller.publish(makeBody(), {})).rejects.toMatchObject({
      code: ERROR_CODES.AUTH_TOKEN_INVALID,
    });
    expect(service.publish).not.toHaveBeenCalled();
  });

  it('GET /want-buys：scope=mine 透传用户上下文；scope=all 传 null', async () => {
    const service = makeService();
    const controller = new WantBuyController(service as unknown as WantBuyService);

    await controller.list({ scope: 'mine' }, authedReq());
    expect(service.list).toHaveBeenCalledWith(
      { id: BigInt(1), schoolId: BigInt(7) },
      expect.objectContaining({ scope: 'mine' }),
    );

    await controller.list({}, {});
    expect(service.list).toHaveBeenLastCalledWith(null, expect.anything());
  });

  it('POST /want-buys/:id/renew|close|bought：透传 id，未登录 → 1001', async () => {
    const service = makeService();
    const controller = new WantBuyController(service as unknown as WantBuyService);

    const r1 = await controller.renew('100', authedReq());
    expect(r1.data).toEqual({ expire_at: '2026-11-05T00:00:00.000Z' });
    expect(service.renew).toHaveBeenCalledWith({ id: BigInt(1), schoolId: BigInt(7) }, '100');

    const r2 = await controller.close('100', authedReq());
    expect(r2.data).toEqual({ status: 'closed' });

    const r3 = await controller.bought('100', authedReq());
    expect(r3.data).toEqual({ status: 'bought' });

    await expect(controller.close('100', {})).rejects.toMatchObject({
      code: ERROR_CODES.AUTH_TOKEN_INVALID,
    });
  });

  it('业务错误（如 4002）原样向上抛，由全局过滤器统一包装', async () => {
    const service = makeService();
    service.renew.mockRejectedValue(new BusinessError(ERROR_CODES.ORDER_STATUS_CONFLICT, '终态不可复活'));
    const controller = new WantBuyController(service as unknown as WantBuyService);

    await expect(controller.renew('100', authedReq())).rejects.toMatchObject({
      code: ERROR_CODES.ORDER_STATUS_CONFLICT,
    });
  });
});

// ---------- validatePublishFields / 词快照：边界 ----------

describe('validatePublishFields（9001 边界）与模块自含词快照（@rule CIM-R-08，scene=want_buy）', () => {
  it.each([
    ['非对象', null],
    ['非对象', 'string'],
    ['标题超长（>128）', { title: 'x'.repeat(129) }],
    ['描述超长（>1000）', { desc: 'x'.repeat(1001) }],
    ['品类 id 非法', { category_id: 'abc' }],
    ['max_price 非法', { max_price: '-1' }],
    ['price_min 非法', { price_min: 'abc' }],
    ['成色枚举外取值', { condition_level: 'broken' }],
  ])('%s → 9001', (_label, over) => {
    const body = over === null || typeof over === 'string' ? over : makeBody(over as Record<string, unknown>);
    expect(() => validatePublishFields(body)).toThrow(BusinessError);
  });

  it('合法输入归一化：category_id 转 BigInt，可选项缺省 null', () => {
    const dto = validatePublishFields(makeBody());

    expect(dto.categoryId).toBe(BigInt(10));
    expect(dto.priceMin).toBeNull();
    expect(dto.priceMax).toBeNull();
    expect(dto.conditionLevel).toBeNull();
  });

  it('词快照：命中违禁词与违规词并去重；未命中返回空', () => {
    expect(findHitWords(`前缀${WANT_BUY_PROHIBITED_WORDS[0]}后缀`)).toEqual([WANT_BUY_PROHIBITED_WORDS[0]]);
    expect(findHitWords(`含${WANT_BUY_VIOLATION_WORDS[0]}`)).toEqual([WANT_BUY_VIOLATION_WORDS[0]]);
    expect(findHitWords('求购高等数学教材')).toEqual([]);
    const w = WANT_BUY_PROHIBITED_WORDS[0];
    expect(findHitWords(`${w}${w}`)).toEqual([w]);
  });

  it('词表为只读快照（冻结，不可运行时篡改）', () => {
    expect(Object.isFrozen(WANT_BUY_PROHIBITED_WORDS)).toBe(true);
    expect(Object.isFrozen(WANT_BUY_VIOLATION_WORDS)).toBe(true);
  });
});

// ---------- WantBuyRepository（模块自含数据访问，Prisma mock） ----------

describe('WantBuyRepository（@table want_buy → PIM-AG-04，Prisma mock）', () => {
  it('createViolationLog 固定 scene=want_buy、action=blocked、target_id=null', async () => {
    const prisma = makePrismaMock();
    const repo = new WantBuyRepository(prisma);
    prisma.violationInterceptLog.create.mockResolvedValue({ id: BigInt(1) });

    await repo.createViolationLog({ user_id: BigInt(1), hit_word: '违禁词', content_snapshot: '快照' });

    expect(prisma.violationInterceptLog.create).toHaveBeenCalledWith({
      data: {
        scene: 'want_buy',
        action: 'blocked',
        user_id: BigInt(1),
        target_id: null,
        hit_word: '违禁词',
        content_snapshot: '快照',
      },
    });
  });

  it('findPage：Promise.all 并发 findMany+count，created_at desc 排序', async () => {
    const prisma = makePrismaMock();
    const repo = new WantBuyRepository(prisma);
    prisma.wantBuy.findMany.mockResolvedValue([]);
    prisma.wantBuy.count.mockResolvedValue(0);

    await repo.findPage({ status: 'active' }, 1, 20);

    expect(prisma.wantBuy.findMany).toHaveBeenCalledWith({
      where: { status: 'active' },
      orderBy: { created_at: 'desc' },
      skip: 0,
      take: 20,
    });
    expect(prisma.wantBuy.count).toHaveBeenCalledWith({ where: { status: 'active' } });
  });
});
