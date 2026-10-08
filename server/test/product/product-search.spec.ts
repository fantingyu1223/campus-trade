/**
 * product-search.spec.ts —— T-106 商品检索/详情查询（游客可读）
 *
 * @module PIM-BC-02 商品与供给
 * @model PIM-AG-03 商品聚合（检索读模型）
 * @rule CIM-R-28 卖家身份标识化：实名信息不出站
 * @api §5.2 #14 GET /products/{id}、#15 GET /products
 *
 * 覆盖验收点：
 *  - F6-AC1：列表筛选（keyword/category/price/condition/urgent/exclude_sold）/排序/分页
 *  - F6-AC2：role_filter 个人闲置（notIn 商家）/ 认证商家（in 商家）
 *  - F33-AC1：详情出站实名兜底扫描（assertNoRealNameLeak），seller 仅身份标识
 *
 * 无真实 MySQL：PrismaService 一律 jest mock（同 product-publish.spec.ts 口径）。
 */
import { ERROR_CODES, UserIdentityType } from '@contract/index';
import { ProductQueryController } from '../../src/modules/product/product-query.controller';
import {
  ProductQueryService,
  assertNoRealNameLeak,
} from '../../src/modules/product/product-query.service';
import { ProductSearchRepository } from '../../src/modules/product/product-search.repository';
import { PrismaService } from '../../src/infra/prisma.service';

// ---------- 测试夹具 ----------

/** 列表行（price 仅需 toString，模拟 Prisma Decimal） */
const makeListRow = (over: Record<string, unknown> = {}) => ({
  id: BigInt(100),
  seller_id: BigInt(1),
  title: '高等数学（下册）',
  price: { toString: () => '25.00' },
  is_urgent: false,
  ...over,
});

const SELLER_ROW = { id: BigInt(1), identity_type: 'student', nickname: '张三' };

const makeDetailRow = (over: Record<string, unknown> = {}) => ({
  id: BigInt(100),
  seller_id: BigInt(1),
  school_id: BigInt(7),
  category_id: BigInt(10),
  title: '高等数学（下册）',
  description: '八成新，无笔记划痕',
  condition_level: 'good',
  price: { toString: () => '25.00' },
  original_price: { toString: () => '45.00' },
  trade_mode: 'both',
  meet_location: '图书馆门口',
  available_time: '工作日 18:00 后',
  status: 'on_sale',
  is_urgent: false,
  view_count: 3,
  favorite_count: 1,
  published_at: new Date('2026-10-01T00:00:00.000Z'),
  ...over,
});

const makePrismaMock = () =>
  ({
    product: { findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn() },
    user: { findMany: jest.fn() },
    productImage: { findMany: jest.fn() },
    category: { findMany: jest.fn().mockResolvedValue([]) },
  }) as unknown as PrismaService & {
    product: { findMany: jest.Mock; count: jest.Mock; findUnique: jest.Mock };
    user: { findMany: jest.Mock };
    productImage: { findMany: jest.Mock };
    category: { findMany: jest.Mock };
  };

const setup = () => {
  const prisma = makePrismaMock();
  const repo = new ProductSearchRepository(prisma);
  const service = new ProductQueryService(repo);
  return { prisma, repo, service };
};

/** 标准列表就绪态：1 条商品 + 卖家 + 首图 */
const mockListHappyPath = (prisma: ReturnType<typeof makePrismaMock>) => {
  prisma.product.findMany.mockResolvedValue([makeListRow()]);
  prisma.product.count.mockResolvedValue(1);
  // user.findMany 复用：identity_type 查询为 role_filter 取 id 集，其余为卖家公开字段组
  prisma.user.findMany.mockImplementation((args: { where: Record<string, unknown> }) =>
    Promise.resolve(args.where.identity_type !== undefined ? [{ id: BigInt(9) }] : [SELLER_ROW]),
  );
  prisma.productImage.findMany.mockResolvedValue([
    { product_id: BigInt(100), image_url: 'https://cdn/x/cover.jpg', sort_order: 0 },
  ]);
};

/** 最近一次 product.findMany 的 where */
const lastWhere = (prisma: ReturnType<typeof makePrismaMock>) =>
  prisma.product.findMany.mock.calls[prisma.product.findMany.mock.calls.length - 1][0].where;

// ---------- F6-AC1：列表项映射 ----------

describe('ProductQueryService.search 列表项映射（@api §5.2 #15，@ac F6-AC1）', () => {
  it('有首图 → cover 取 sort_order=0 的 image_url；price 转字符串；seller_role 取卖家 identity_type', async () => {
    const { prisma, service } = setup();
    mockListHappyPath(prisma);

    const result = await service.search({});

    expect(result).toEqual({
      list: [
        {
          id: '100',
          title: '高等数学（下册）',
          price: '25.00',
          cover: 'https://cdn/x/cover.jpg',
          is_urgent: false,
          seller_role: UserIdentityType.STUDENT,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });
  });

  it('无首图 → cover 为 null', async () => {
    const { prisma, service } = setup();
    mockListHappyPath(prisma);
    prisma.productImage.findMany.mockResolvedValue([]);

    const result = await service.search({});

    expect(result.list[0].cover).toBeNull();
  });

  it('卖家缺失 → seller_role 兜底 guest（@rule CIM-R-28 身份标识化）', async () => {
    const { prisma, service } = setup();
    mockListHappyPath(prisma);
    prisma.user.findMany.mockResolvedValue([]);

    const result = await service.search({});

    expect(result.list[0].seller_role).toBe(UserIdentityType.GUEST);
  });
});

// ---------- F6-AC1：筛选条件进 where ----------

describe('search 筛选条件组装（@ac F6-AC1）', () => {
  it('keyword → title/description OR contains（FULLTEXT LIKE 降级）', async () => {
    const { prisma, service } = setup();
    mockListHappyPath(prisma);

    await service.search({ keyword: '高数' });

    expect(lastWhere(prisma).OR).toEqual([
      { title: { contains: '高数' } },
      { description: { contains: '高数' } },
    ]);
  });

  it('category_id / price gte-lte / condition / urgent_only 均进 where', async () => {
    const { prisma, service } = setup();
    mockListHappyPath(prisma);

    await service.search({
      category_id: '10',
      min_price: '10.00',
      max_price: '99.99',
      condition: 'like_new',
      urgent_only: 'true',
    });

    const where = lastWhere(prisma);
    expect(where.category_id).toBe(BigInt(10));
    expect(where.price).toEqual({ gte: '10.00', lte: '99.99' });
    expect(where.condition_level).toBe('like_new');
    expect(where.is_urgent).toBe(true);
  });

  it('category_id 命中父品类 → 展开为 父+子 in 集合', async () => {
    const { prisma, service } = setup();
    mockListHappyPath(prisma);
    prisma.category.findMany.mockResolvedValue([{ id: BigInt(5) }, { id: BigInt(6) }]);

    await service.search({ category_id: '1' });

    expect(prisma.category.findMany).toHaveBeenCalledWith({
      where: { parent_id: BigInt(1), status: 'active' },
      select: { id: true },
    });
    expect(lastWhere(prisma).category_id).toEqual({ in: [BigInt(1), BigInt(5), BigInt(6)] });
  });

  it('exclude_sold 缺省默认 true → status not sold', async () => {
    const { prisma, service } = setup();
    mockListHappyPath(prisma);

    await service.search({});

    expect(lastWhere(prisma).status).toEqual({ not: 'sold' });
  });

  it('exclude_sold=false → 不带 status 过滤（含已售）', async () => {
    const { prisma, service } = setup();
    mockListHappyPath(prisma);

    await service.search({ exclude_sold: 'false' });

    expect(lastWhere(prisma).status).toBeUndefined();
  });

  it('exclude_sold=0 同 false 解析', async () => {
    const { prisma, service } = setup();
    mockListHappyPath(prisma);

    await service.search({ exclude_sold: '0' });

    expect(lastWhere(prisma).status).toBeUndefined();
  });
});

// ---------- F6-AC2：role_filter 个人闲置 / 认证商家 ----------

describe('role_filter 身份过滤（@ac F6-AC2）', () => {
  it('merchant → 先查 identity_type=merchant 的 id 集，seller_id in', async () => {
    const { prisma, service } = setup();
    mockListHappyPath(prisma);

    await service.search({ role_filter: 'merchant' });

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { identity_type: UserIdentityType.MERCHANT },
      select: { id: true },
    });
    expect(lastWhere(prisma).seller_id).toEqual({ in: [BigInt(9)] });
  });

  it('personal → seller_id notIn 商家 id 集', async () => {
    const { prisma, service } = setup();
    mockListHappyPath(prisma);

    await service.search({ role_filter: 'personal' });

    expect(lastWhere(prisma).seller_id).toEqual({ notIn: [BigInt(9)] });
  });
});

// ---------- F6-AC1：排序与分页 ----------

describe('排序与分页（@ac F6-AC1）', () => {
  it.each([
    ['缺省/ new', undefined, { published_at: 'desc' }],
    ['price_asc 价格升序', 'price_asc', { price: 'asc' }],
    ['price_desc 价格降序', 'price_desc', { price: 'desc' }],
  ])('sort=%s → orderBy 正确', async (_label, sort, expected) => {
    const { prisma, service } = setup();
    mockListHappyPath(prisma);

    await service.search(sort === undefined ? {} : { sort });

    expect(prisma.product.findMany.mock.calls[0][0].orderBy).toEqual(expected);
  });

  it('page=2 & pageSize=10 → skip=10 / take=10，响应回显分页参数', async () => {
    const { prisma, service } = setup();
    mockListHappyPath(prisma);

    const result = await service.search({ page: '2', pageSize: '10' });

    expect(prisma.product.findMany.mock.calls[0][0].skip).toBe(10);
    expect(prisma.product.findMany.mock.calls[0][0].take).toBe(10);
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(10);
  });
});

// ---------- 参数校验：非法一律 9001 ----------

describe('search 参数校验（非法一律 9001）', () => {
  it.each([
    ['category_id 非数字', { category_id: 'abc' }],
    ['min_price 非金额格式', { min_price: '10.999' }],
    ['max_price 为负', { max_price: '-1' }],
    ['min_price > max_price', { min_price: '50', max_price: '10' }],
    ['condition 枚举外', { condition: 'broken' }],
    ['role_filter 枚举外', { role_filter: 'admin' }],
    ['sort 枚举外', { sort: 'hot' }],
    ['page < 1', { page: '0' }],
    ['pageSize > 50', { pageSize: '51' }],
    ['pageSize 非数字', { pageSize: 'x' }],
    ['exclude_sold 非法取值', { exclude_sold: 'yes' }],
    ['urgent_only 非法取值', { urgent_only: '2' }],
  ])('%s → 9001 且不查库', async (_label, query) => {
    const { prisma, service } = setup();
    mockListHappyPath(prisma);

    await expect(service.search(query)).rejects.toMatchObject({
      code: ERROR_CODES.PARAM_VALIDATION_FAILED,
    });
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });
});

// ---------- §5.2 #14：商品详情 ----------

describe('ProductQueryService.detail（@api §5.2 #14，@ac F33-AC1）', () => {
  it('商家商品详情：seller.is_merchant=true，images 按 sort_order 升序，JSON 不含实名 key', async () => {
    const { prisma, service } = setup();
    prisma.product.findUnique.mockResolvedValue(makeDetailRow());
    prisma.productImage.findMany.mockResolvedValue([
      { product_id: BigInt(100), image_url: 'https://cdn/x/0.jpg', sort_order: 0 },
      { product_id: BigInt(100), image_url: 'https://cdn/x/1.jpg', sort_order: 1 },
      { product_id: BigInt(100), image_url: 'https://cdn/x/2.jpg', sort_order: 2 },
    ]);
    prisma.user.findMany.mockResolvedValue([
      { id: BigInt(1), identity_type: 'merchant', nickname: '校园书店' },
    ]);

    const result = await service.detail('100');

    expect(prisma.productImage.findMany).toHaveBeenCalledWith({
      where: { product_id: BigInt(100) },
      orderBy: { sort_order: 'asc' },
    });
    expect(result.images).toEqual(['https://cdn/x/0.jpg', 'https://cdn/x/1.jpg', 'https://cdn/x/2.jpg']);
    expect(result.seller).toEqual({
      id: '1',
      nickname: '校园书店',
      identity_type: UserIdentityType.MERCHANT,
      is_merchant: true,
    });
    expect(result.price).toBe('25.00');
    expect(result.original_price).toBe('45.00');
    expect(result.published_at).toBe('2026-10-01T00:00:00.000Z');
    // F33-AC1：出站 JSON 不含任何实名 key
    const json = JSON.stringify(result);
    for (const key of ['student_no', 'license', 'openid', 'unionid', 'real_name']) {
      expect(json).not.toContain(key);
    }
  });

  it('id 非数字 → 9001，不查库', async () => {
    const { prisma, service } = setup();

    await expect(service.detail('abc')).rejects.toMatchObject({
      code: ERROR_CODES.PARAM_VALIDATION_FAILED,
    });
    expect(prisma.product.findUnique).not.toHaveBeenCalled();
  });

  it('匿名卖家（is_anonymous=true）：seller.nickname 展示为「匿名用户」（N6 匿名保护）', async () => {
    const { prisma, service } = setup();
    prisma.product.findUnique.mockResolvedValue(makeDetailRow());
    prisma.productImage.findMany.mockResolvedValue([]);
    prisma.user.findMany.mockResolvedValue([
      { id: BigInt(1), identity_type: 'student', nickname: '张三', is_anonymous: true },
    ]);

    const result = await service.detail('100');

    expect(result.seller.nickname).toBe('匿名用户');
    expect(result.seller.is_merchant).toBe(false);
    expect(JSON.stringify(result)).not.toContain('张三');
  });

  it('商品不存在 → 2001', async () => {
    const { prisma, service } = setup();
    prisma.product.findUnique.mockResolvedValue(null);

    await expect(service.detail('404')).rejects.toMatchObject({
      code: ERROR_CODES.PRODUCT_NOT_FOUND,
    });
  });
});

// ---------- @rule CIM-R-28：实名泄漏兜底扫描 ----------

describe('assertNoRealNameLeak（@rule CIM-R-28，@ac F33-AC1）', () => {
  it('干净载荷（含嵌套对象/数组）→ 不抛出', () => {
    expect(() =>
      assertNoRealNameLeak({
        id: '1',
        seller: { id: '1', nickname: '张三', identity_type: 'student', is_merchant: false },
        images: ['a.jpg'],
        list: [{ seller_role: 'guest' }],
      }),
    ).not.toThrow();
  });

  it.each([
    ['顶层 student_no', { student_no: '20240001' }],
    ['嵌套 license', { seller: { license: 'X123' } }],
    ['数组内 openid', { list: [{ openid: 'o_abc' }] }],
    ['深层 unionid', { a: { b: { c: [{ unionid: 'u_1' }] } } }],
    ['real_name', { seller: { real_name: '张三' } }],
  ])('污染对象（%s）→ 抛出', (_label, payload) => {
    expect(() => assertNoRealNameLeak(payload)).toThrow(/实名/);
  });
});

// ---------- ProductQueryController：统一响应包络（游客可读） ----------

describe('ProductQueryController（@api §5.2 #14/#15，统一响应包络 §5.1）', () => {
  it('GET /products：返回 { code:0, message:"ok", data }，查询参数透传 service', async () => {
    const data = { list: [], total: 0, page: 1, pageSize: 20 };
    const service = { search: jest.fn().mockResolvedValue(data) };
    const controller = new ProductQueryController(service as unknown as ProductQueryService);

    const res = await controller.search({ keyword: '高数' });

    expect(res).toEqual({ code: 0, message: 'ok', data });
    expect(service.search).toHaveBeenCalledWith({ keyword: '高数' });
  });

  it('GET /products/{id}：返回 { code:0, message:"ok", data }，id 透传 service', async () => {
    const data = { id: '100' };
    const service = { detail: jest.fn().mockResolvedValue(data) };
    const controller = new ProductQueryController(service as unknown as ProductQueryService);

    const res = await controller.detail('100');

    expect(res).toEqual({ code: 0, message: 'ok', data });
    expect(service.detail).toHaveBeenCalledWith('100');
  });

  it('业务错误（如 2001）原样向上抛，由全局过滤器统一包装', async () => {
    const { BusinessError } = jest.requireActual<
      typeof import('../../src/modules/product/product-publish.service')
    >('../../src/modules/product/product-publish.service');
    const service = {
      detail: jest
        .fn()
        .mockRejectedValue(new BusinessError(ERROR_CODES.PRODUCT_NOT_FOUND, '商品不存在')),
    };
    const controller = new ProductQueryController(service as unknown as ProductQueryService);

    await expect(controller.detail('404')).rejects.toMatchObject({
      code: ERROR_CODES.PRODUCT_NOT_FOUND,
    });
  });
});
