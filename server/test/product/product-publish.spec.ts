/**
 * product-publish.spec.ts —— T-105 商品发布（3 步发布落库 + 三重校验 + 急出打标）
 *
 * @module PIM-BC-02 商品与供给
 * @model PIM-AG-03 商品聚合
 * @statemachine PIM-SM-02 商品状态机（[*] → 上架：发布合规校验通过后直接 on_sale）
 * @api §5.2 #10 POST /products（#11 编辑为后续批次，本规格不含）
 *
 * 覆盖验收点：
 *  - F5-AC1：字段齐全 → 发布成功，status=on_sale，product+product_image(≤9) 落库
 *  - F5-AC2：缺实拍图（2004）/ 缺成色（9001）逐项拦截提示（CIM-R-06）
 *  - F5-AC3：标题/描述命中违禁/违规词 → 硬拦截并写 violation_intercept_log（CIM-R-08）
 *  - CIM-R-07：非正面清单叶子品类（不存在/顶级/停用/有子级）一律拦截
 *  - F10a-AC1：第 4 件急出打标 → 2003（CIM-R-09）；F10a-AC2：商家打标 → 2003
 *
 * 无真实 MySQL：PrismaService 一律 jest mock（同 wx-login.spec.ts 口径）。
 */
import { ERROR_CODES, ProductStatus, UserIdentityType } from '@contract/index';
import { ProductController } from '../../src/modules/product/product.controller';
import { ProductPublishService, BusinessError } from '../../src/modules/product/product-publish.service';
import type { SellerContext } from '../../src/modules/product/product-publish.service';
import { ProductRepository } from '../../src/modules/product/product.repository';
import { UrgentBadgeService, URGENT_LIMIT } from '../../src/modules/product/urgent-badge.service';
import {
  WordSnapshot,
  PROHIBITED_WORDS,
  VIOLATION_WORDS,
} from '../../src/modules/product/infra-snapshot/word-snapshot';
import { validatePublishFields } from '../../src/modules/product/product.validator';
import { ProductPublishedBus } from '../../src/infra/product-events/product-published.bus';
import { PrismaService } from '../../src/infra/prisma.service';

// ---------- 测试夹具 ----------

const SELLER: SellerContext = { id: BigInt(1), schoolId: BigInt(7), identityType: UserIdentityType.STUDENT };

/** 合法发布请求体（契约 §5.2 #10 字段；condition/trade_mode 按 PRD F5 补齐） */
const makeBody = (over: Record<string, unknown> = {}) => ({
  title: '高等数学（下册）',
  desc: '八成新，无笔记划痕',
  price: '25.00',
  category_id: '10',
  images: ['https://cdn/x/1.jpg', 'https://cdn/x/2.jpg'],
  condition: 'good',
  trade_mode: 'both',
  trade_point: '图书馆门口',
  available_time: '工作日 18:00 后',
  is_urgent: false,
  ...over,
});

/** 叶子品类（parent_id≠0、active、无子级） */
const LEAF_CATEGORY = { id: BigInt(10), parent_id: BigInt(3), name: '教材', status: 'active' };

const makeProductRow = (over: Record<string, unknown> = {}) => ({
  id: BigInt(100),
  seller_id: SELLER.id,
  school_id: SELLER.schoolId,
  category_id: BigInt(10),
  status: 'on_sale',
  is_urgent: false,
  published_at: new Date('2026-10-06T00:00:00.000Z'),
  ...over,
});

const makePrismaMock = () =>
  ({
    category: { findUnique: jest.fn(), count: jest.fn() },
    product: { count: jest.fn(), create: jest.fn() },
    productImage: { createMany: jest.fn() },
    violationInterceptLog: { create: jest.fn() },
    $transaction: jest.fn(),
  }) as unknown as PrismaService & {
    category: { findUnique: jest.Mock; count: jest.Mock };
    product: { count: jest.Mock; create: jest.Mock };
    productImage: { createMany: jest.Mock };
    violationInterceptLog: { create: jest.Mock };
    $transaction: jest.Mock;
  };

const setup = () => {
  const prisma = makePrismaMock();
  // $transaction 回调直接复用同一 mock 作为 tx
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
  const repo = new ProductRepository(prisma);
  const wordSnapshot = new WordSnapshot();
  const urgentBadge = new UrgentBadgeService(repo);
  const service = new ProductPublishService(repo, urgentBadge, wordSnapshot);
  return { prisma, repo, wordSnapshot, urgentBadge, service };
};

/** 标准就绪态：叶子品类 + 急出额度空闲 + 落库成功 */
const mockHappyPath = (prisma: ReturnType<typeof makePrismaMock>) => {
  prisma.category.findUnique.mockResolvedValue(LEAF_CATEGORY);
  prisma.category.count.mockResolvedValue(0);
  prisma.product.count.mockResolvedValue(0);
  prisma.product.create.mockResolvedValue(makeProductRow());
  prisma.productImage.createMany.mockResolvedValue({ count: 2 });
};

// ---------- F5-AC1：成功发布（PIM-SM-02 [*]→上架） ----------

describe('ProductPublishService.publish（@api §5.2 #10，@ac F5-AC1）', () => {
  it('字段齐全：发布成功，返回 product_id 与 status=on_sale', async () => {
    const { prisma, service } = setup();
    mockHappyPath(prisma);

    const result = await service.publish(SELLER, makeBody());

    expect(result).toEqual({ product_id: '100', status: ProductStatus.ON_SALE });
  });

  it('落库：product 状态 on_sale、published_at 赋值、字段映射正确（@table product → PIM-AG-03）', async () => {
    const { prisma, service } = setup();
    mockHappyPath(prisma);

    await service.publish(SELLER, makeBody());

    const createArg = prisma.product.create.mock.calls[0][0];
    expect(createArg.data).toMatchObject({
      seller_id: BigInt(1),
      school_id: BigInt(7),
      category_id: BigInt(10),
      title: '高等数学（下册）',
      description: '八成新，无笔记划痕',
      condition_level: 'good',
      trade_mode: 'both',
      meet_location: '图书馆门口',
      available_time: '工作日 18:00 后',
      status: 'on_sale',
      is_urgent: false,
    });
    expect(createArg.data.price.toString()).toBe('25.00');
    expect(createArg.data.published_at).toBeInstanceOf(Date);
  });

  it('落库：product_image 按 sort_order 0..n 批量写入（@table product_image，≤9 张）', async () => {
    const { prisma, service } = setup();
    mockHappyPath(prisma);

    await service.publish(SELLER, makeBody());

    expect(prisma.productImage.createMany).toHaveBeenCalledWith({
      data: [
        { product_id: BigInt(100), image_url: 'https://cdn/x/1.jpg', sort_order: 0 },
        { product_id: BigInt(100), image_url: 'https://cdn/x/2.jpg', sort_order: 1 },
      ],
    });
  });

  it('product 与 product_image 在同一事务内写入（$transaction）', async () => {
    const { prisma, service } = setup();
    mockHappyPath(prisma);

    await service.publish(SELLER, makeBody());

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('9 张图上限内可发布；is_urgent 缺省视为 false', async () => {
    const { prisma, service } = setup();
    mockHappyPath(prisma);
    const images = Array.from({ length: 9 }, (_, i) => `https://cdn/x/${i}.jpg`);
    const body = makeBody({ images });
    delete (body as Record<string, unknown>).is_urgent;

    const result = await service.publish(SELLER, body);

    expect(result.status).toBe('on_sale');
    expect(prisma.productImage.createMany.mock.calls[0][0].data).toHaveLength(9);
  });

  it('trade_mode=online 时自提地点可缺省（meet_location 落 null）', async () => {
    const { prisma, service } = setup();
    mockHappyPath(prisma);
    const body = makeBody({ trade_mode: 'online' });
    delete (body as Record<string, unknown>).trade_point;

    await service.publish(SELLER, body);

    expect(prisma.product.create.mock.calls[0][0].data.meet_location).toBeNull();
  });

  it('发布成功后 emit 商品上架事件（@event PIM-EV-11 触发源，wantbuy 撮合下游订阅）', async () => {
    const { prisma, service } = setup();
    mockHappyPath(prisma);
    const onPublished = jest.fn();
    const off = ProductPublishedBus.subscribe(onPublished);
    try {
      await service.publish(SELLER, makeBody());

      expect(onPublished).toHaveBeenCalledTimes(1);
      expect(onPublished).toHaveBeenCalledWith({
        id: '100',
        category_id: '10',
        title: '高等数学（下册）',
        price: '25.00',
      });
    } finally {
      off();
    }
  });

  it('前置校验失败（敏感词拦截）不 emit 上架事件', async () => {
    const { prisma, service } = setup();
    mockHappyPath(prisma);
    const onPublished = jest.fn();
    const off = ProductPublishedBus.subscribe(onPublished);
    try {
      await expect(
        service.publish(SELLER, makeBody({ title: `出售${PROHIBITED_WORDS[0]}货源` })),
      ).rejects.toMatchObject({ code: ERROR_CODES.PARAM_VALIDATION_FAILED });
      expect(onPublished).not.toHaveBeenCalled();
    } finally {
      off();
    }
  });
});

// ---------- F5-AC2：字段完整性校验（CIM-R-06） ----------

describe('字段完整性校验（@ac F5-AC2，@rule CIM-R-06 落点：product.validator.ts）', () => {
  it('未上传实拍图（images=[]）→ 2004 且逐项提示，不落库', async () => {
    const { prisma, service } = setup();
    mockHappyPath(prisma);

    await expect(service.publish(SELLER, makeBody({ images: [] }))).rejects.toMatchObject({
      code: ERROR_CODES.IMAGE_INVALID,
    });
    await expect(service.publish(SELLER, makeBody({ images: [] }))).rejects.toThrow(/实拍图/);
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('images 字段整体缺失 → 2004', async () => {
    const { service } = setup();
    const body = makeBody();
    delete (body as Record<string, unknown>).images;

    await expect(service.publish(SELLER, body)).rejects.toMatchObject({
      code: ERROR_CODES.IMAGE_INVALID,
    });
  });

  it('缺成色 → 9001 且提示含「成色」', async () => {
    const { service } = setup();
    const body = makeBody();
    delete (body as Record<string, unknown>).condition;

    await expect(service.publish(SELLER, body)).rejects.toMatchObject({
      code: ERROR_CODES.PARAM_VALIDATION_FAILED,
    });
    await expect(service.publish(SELLER, body)).rejects.toThrow(/成色/);
  });

  it('多字段缺失逐项聚合提示（标题/成色/自提地点）', async () => {
    const { service } = setup();
    const body = makeBody({ title: '' });
    delete (body as Record<string, unknown>).condition;
    delete (body as Record<string, unknown>).trade_point;

    await expect(service.publish(SELLER, body)).rejects.toThrow(/标题/);
    await expect(service.publish(SELLER, body)).rejects.toThrow(/成色/);
    await expect(service.publish(SELLER, body)).rejects.toThrow(/自提地点/);
  });

  it('超过 9 张图 → 2004', async () => {
    const { service } = setup();
    const images = Array.from({ length: 10 }, (_, i) => `https://cdn/x/${i}.jpg`);

    await expect(service.publish(SELLER, makeBody({ images }))).rejects.toMatchObject({
      code: ERROR_CODES.IMAGE_INVALID,
    });
  });

  it('图片 URL 为空串 → 2004', async () => {
    const { service } = setup();

    await expect(service.publish(SELLER, makeBody({ images: [''] }))).rejects.toMatchObject({
      code: ERROR_CODES.IMAGE_INVALID,
    });
  });
});

// ---------- F5-AC3：违禁/违规词硬拦截（CIM-R-08） ----------

describe('违禁/违规词硬拦截（@ac F5-AC3，@rule CIM-R-08 落点：infra-snapshot/word-snapshot.ts）', () => {
  it('标题命中违禁品词 → 拦截并写 violation_intercept_log（scene=product_publish, action=blocked），不落库', async () => {
    const { prisma, service } = setup();
    mockHappyPath(prisma);
    const word = PROHIBITED_WORDS[0];

    await expect(service.publish(SELLER, makeBody({ title: `出售${word}一份` }))).rejects.toMatchObject({
      code: ERROR_CODES.PARAM_VALIDATION_FAILED,
    });
    await expect(service.publish(SELLER, makeBody({ title: `出售${word}一份` }))).rejects.toThrow(word);

    expect(prisma.violationInterceptLog.create).toHaveBeenCalledTimes(2); // 两次发布各留痕一次
    const logArg = prisma.violationInterceptLog.create.mock.calls[0][0];
    expect(logArg.data).toMatchObject({
      scene: 'product_publish',
      action: 'blocked',
      user_id: SELLER.id,
      target_id: null,
      hit_word: word,
    });
    expect(logArg.data.content_snapshot).toContain(word);
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('描述命中违规词 → 同样硬拦截并留痕', async () => {
    const { prisma, service } = setup();
    mockHappyPath(prisma);
    const word = VIOLATION_WORDS[0];

    await expect(service.publish(SELLER, makeBody({ desc: `联系请${word}` }))).rejects.toThrow(word);
    expect(prisma.violationInterceptLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('同一文本命中多词 → 每词各写一条留痕', async () => {
    const { prisma, service } = setup();
    mockHappyPath(prisma);
    const title = `${PROHIBITED_WORDS[0]}与${PROHIBITED_WORDS[1]}`;

    await expect(service.publish(SELLER, makeBody({ title }))).rejects.toThrow();

    expect(prisma.violationInterceptLog.create).toHaveBeenCalledTimes(2);
    const hitWords = prisma.violationInterceptLog.create.mock.calls.map((c) => c[0].data.hit_word);
    expect(hitWords).toEqual(expect.arrayContaining([PROHIBITED_WORDS[0], PROHIBITED_WORDS[1]]));
  });
});

// ---------- CIM-R-07：品类正面清单叶子校验 ----------

describe('品类正面清单叶子校验（@rule CIM-R-07 落点：product-publish.service.ts + repository）', () => {
  it.each([
    ['不存在', null],
    ['顶级品类（parent_id=0 非叶子）', { ...LEAF_CATEGORY, parent_id: BigInt(0) }],
    ['已停用', { ...LEAF_CATEGORY, status: 'disabled' }],
  ])('品类%s → 9001 拦截，不落库', async (_label, category) => {
    const { prisma, service } = setup();
    mockHappyPath(prisma);
    prisma.category.findUnique.mockResolvedValue(category);

    await expect(service.publish(SELLER, makeBody())).rejects.toMatchObject({
      code: ERROR_CODES.PARAM_VALIDATION_FAILED,
    });
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('品类有子级（非叶子）→ 9001 拦截', async () => {
    const { prisma, service } = setup();
    mockHappyPath(prisma);
    prisma.category.count.mockResolvedValue(1);

    await expect(service.publish(SELLER, makeBody())).rejects.toThrow(/叶子/);
    expect(prisma.product.create).not.toHaveBeenCalled();
  });
});

// ---------- F10a：急出打标额度（CIM-R-09） ----------

describe('急出打标（@ac F10a-AC1/AC2，@rule CIM-R-09 落点：urgent-badge.service.ts）', () => {
  it(`URGENT_LIMIT = 3（同账号同时生效上限）`, () => {
    expect(URGENT_LIMIT).toBe(3);
  });

  it('F10a-AC1：已有 3 件生效急出，第 4 件打标 → 2003 拦截，不落库', async () => {
    const { prisma, service } = setup();
    mockHappyPath(prisma);
    prisma.product.count.mockResolvedValue(3);

    await expect(service.publish(SELLER, makeBody({ is_urgent: true }))).rejects.toMatchObject({
      code: ERROR_CODES.URGENT_LIMIT_EXCEEDED,
    });
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('已有 2 件生效急出，第 3 件打标 → 放行且 is_urgent=true 落库', async () => {
    const { prisma, service } = setup();
    mockHappyPath(prisma);
    prisma.product.count.mockResolvedValue(2);
    prisma.product.create.mockResolvedValue(makeProductRow({ is_urgent: true }));

    const result = await service.publish(SELLER, makeBody({ is_urgent: true }));

    expect(result.status).toBe('on_sale');
    expect(prisma.product.create.mock.calls[0][0].data.is_urgent).toBe(true);
  });

  it('额度占满但不打标（is_urgent=false）→ 正常发布，不查额度', async () => {
    const { prisma, service } = setup();
    mockHappyPath(prisma);

    await service.publish(SELLER, makeBody({ is_urgent: false }));

    expect(prisma.product.count).not.toHaveBeenCalled();
    expect(prisma.product.create).toHaveBeenCalled();
  });

  it('F10a-AC2：商家打急出标 → 2003（商家不享受急出加权），且不查额度', async () => {
    const { prisma, service } = setup();
    mockHappyPath(prisma);
    const merchant: SellerContext = { ...SELLER, identityType: UserIdentityType.MERCHANT };

    await expect(service.publish(merchant, makeBody({ is_urgent: true }))).rejects.toMatchObject({
      code: ERROR_CODES.URGENT_LIMIT_EXCEEDED,
    });
    expect(prisma.product.count).not.toHaveBeenCalled();
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('额度统计口径：is_urgent=true 且状态在 on_sale/trading（售出/下架释放额度，裁决 7）', async () => {
    const prisma = makePrismaMock();
    const repo = new ProductRepository(prisma);
    prisma.product.count.mockResolvedValue(1);

    await repo.countActiveUrgentBySeller(BigInt(1));

    expect(prisma.product.count).toHaveBeenCalledWith({
      where: { seller_id: BigInt(1), is_urgent: true, status: { in: ['on_sale', 'trading'] } },
    });
  });
});

// ---------- ProductController：统一响应包络与鉴权上下文 ----------

describe('ProductController（@api §5.2 #10 POST /products，统一响应包络 §5.1）', () => {
  const authedReq = () => ({
    user: { id: '1', school_id: '7', identity_type: UserIdentityType.STUDENT },
  });

  it('成功返回 { code:0, message:"ok", data:{ product_id, status } }，seller 上下文透传为 BigInt', async () => {
    const service = {
      publish: jest.fn().mockResolvedValue({ product_id: '100', status: 'on_sale' }),
    };
    const controller = new ProductController(service as unknown as ProductPublishService);

    const res = await controller.publish(makeBody(), authedReq());

    expect(res.code).toBe(0);
    expect(res.message).toBe('ok');
    expect(res.data).toEqual({ product_id: '100', status: 'on_sale' });
    expect(service.publish).toHaveBeenCalledWith(
      { id: BigInt(1), schoolId: BigInt(7), identityType: UserIdentityType.STUDENT },
      expect.objectContaining({ title: '高等数学（下册）' }),
    );
  });

  it('未登录（req.user 缺失）→ 1001，不透传 service', async () => {
    const service = { publish: jest.fn() };
    const controller = new ProductController(service as unknown as ProductPublishService);

    await expect(controller.publish(makeBody(), {})).rejects.toMatchObject({
      code: ERROR_CODES.AUTH_TOKEN_INVALID,
    });
    expect(service.publish).not.toHaveBeenCalled();
  });

  it('业务错误（如 2003）原样向上抛，由全局过滤器统一包装', async () => {
    const service = {
      publish: jest.fn().mockRejectedValue(new BusinessError(ERROR_CODES.URGENT_LIMIT_EXCEEDED, '急出上限')),
    };
    const controller = new ProductController(service as unknown as ProductPublishService);

    await expect(controller.publish(makeBody(), authedReq())).rejects.toMatchObject({
      code: ERROR_CODES.URGENT_LIMIT_EXCEEDED,
    });
  });
});

// ---------- WordSnapshot：本地只读词表快照（CIM-R-08） ----------

describe('WordSnapshot（@rule CIM-R-08，@table word_list → PIM-AG-03 发布前置校验）', () => {
  it('命中文本中间的词并返回词表原词', () => {
    const snapshot = new WordSnapshot();
    const word = PROHIBITED_WORDS[0];

    expect(snapshot.findHits(`前缀${word}后缀`)).toEqual([word]);
  });

  it('违禁词与违规词两个词表均生效', () => {
    const snapshot = new WordSnapshot();

    expect(snapshot.findHits(`含${VIOLATION_WORDS[0]}`)).toEqual([VIOLATION_WORDS[0]]);
    expect(snapshot.findHits(`含${PROHIBITED_WORDS[0]}`)).toEqual([PROHIBITED_WORDS[0]]);
  });

  it('未命中 → 空数组', () => {
    const snapshot = new WordSnapshot();

    expect(snapshot.findHits('高等数学教材，九成新')).toEqual([]);
  });

  it('同一词多次出现仅计一次（去重）', () => {
    const snapshot = new WordSnapshot();
    const word = PROHIBITED_WORDS[0];

    expect(snapshot.findHits(`${word}${word}${word}`)).toEqual([word]);
  });

  it('词表为只读快照（冻结，不可运行时篡改）', () => {
    expect(Object.isFrozen(PROHIBITED_WORDS)).toBe(true);
    expect(Object.isFrozen(VIOLATION_WORDS)).toBe(true);
  });
});

// ---------- ProductRepository（@table product/product_image/category/word_list） ----------

describe('ProductRepository（模块自含数据访问，Prisma mock）', () => {
  it('findCategoryById 走 category 主键', async () => {
    const prisma = makePrismaMock();
    const repo = new ProductRepository(prisma);
    prisma.category.findUnique.mockResolvedValue(LEAF_CATEGORY);

    const row = await repo.findCategoryById(BigInt(10));

    expect(prisma.category.findUnique).toHaveBeenCalledWith({ where: { id: BigInt(10) } });
    expect(row).toMatchObject({ id: BigInt(10) });
  });

  it('countCategoryChildren 按 parent_id 计数（叶子判定）', async () => {
    const prisma = makePrismaMock();
    const repo = new ProductRepository(prisma);
    prisma.category.count.mockResolvedValue(0);

    await repo.countCategoryChildren(BigInt(10));

    expect(prisma.category.count).toHaveBeenCalledWith({ where: { parent_id: BigInt(10) } });
  });

  it('createViolationLog 透传 violation_intercept_log 留痕字段', async () => {
    const prisma = makePrismaMock();
    const repo = new ProductRepository(prisma);
    prisma.violationInterceptLog.create.mockResolvedValue({ id: BigInt(1) });

    await repo.createViolationLog({
      user_id: BigInt(1),
      hit_word: '违禁词',
      content_snapshot: '快照',
    });

    expect(prisma.violationInterceptLog.create).toHaveBeenCalledWith({
      data: {
        scene: 'product_publish',
        action: 'blocked',
        user_id: BigInt(1),
        target_id: null,
        hit_word: '违禁词',
        content_snapshot: '快照',
      },
    });
  });
});

// ---------- validatePublishFields：入参边界（9001/2004） ----------

describe('validatePublishFields（参数校验边界）', () => {
  it.each([
    ['非对象', null],
    ['非对象', 'string'],
  ])('%s → 9001', (_label, body) => {
    expect(() => validatePublishFields(body)).toThrow(BusinessError);
  });

  it.each([
    ['价格为 0', { price: '0' }],
    ['价格为负', { price: '-5' }],
    ['价格非数值', { price: 'abc' }],
    ['价格超过两位小数', { price: '10.999' }],
    ['标题超长（>128）', { title: 'x'.repeat(129) }],
    ['描述缺失', { desc: '' }],
    ['品类 id 非法', { category_id: 'abc' }],
    ['成色枚举外取值', { condition: 'broken' }],
    ['交易方式枚举外取值', { trade_mode: 'express' }],
    ['trade_mode=meet 缺自提地点', { trade_mode: 'meet', trade_point: '' }],
    ['original_price 非法', { original_price: '-1' }],
    ['stock 非法', { stock: -1 }],
  ])('%s → BusinessError', (_label, over) => {
    const body = makeBody(over as Record<string, unknown>);
    if ((over as Record<string, unknown>).trade_point === '') body.trade_point = '';
    expect(() => validatePublishFields(body)).toThrow(BusinessError);
  });

  it('合法输入归一化：category_id 转 BigInt、is_urgent 缺省 false、可选字段缺省 null', () => {
    const body = makeBody();
    delete (body as Record<string, unknown>).available_time;

    const dto = validatePublishFields(body);

    expect(dto.categoryId).toBe(BigInt(10));
    expect(dto.isUrgent).toBe(false);
    expect(dto.availableTime).toBeNull();
    expect(dto.originalPrice).toBeNull();
    expect(dto.stock).toBeNull();
    expect(dto.price).toBe('25.00');
  });
});
