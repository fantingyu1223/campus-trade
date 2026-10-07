/**
 * product-status.spec.ts —— T-107 商品状态管理（下架/重新上架/标记已售/我的商品/买家候选）
 *
 * @module PIM-BC-02 商品与供给
 * @model PIM-AG-03 商品聚合
 * @statemachine PIM-SM-02 商品状态机（on_sale ↔ off_sale；on_sale → sold 终态不可逆）
 * @rule CIM-R-13 标记已售必须指定买家（从该商品会话买家列表中选择）
 * @api §5.2 #12 POST /products/{id}/offline、#13 POST /products/{id}/sold、#16 GET /products/mine
 *      补充接口（本批次声明）：POST /products/{id}/relist、GET /products/{id}/buyer-candidates（U13 配套）
 *
 * 覆盖验收点：
 *  - F7-AC1：下架/重新上架状态迁移与守卫（2002 状态冲突、1003 非卖家、2001 不存在、9001 id 非法）
 *  - F7-AC2：标记已售须从会话买家选择，sold 终态不可逆
 *  - F7-AC3：我的商品分栏（trading 并在售组）与 status 过滤分页（offline 映射 off_sale）
 *
 * 无真实 MySQL：PrismaService 一律 jest mock（product/conversation/user 三表）。
 */
import { ERROR_CODES, ProductStatus } from '@contract/index';
import { ProductStatusController } from '../../src/modules/product/product-status.controller';
import { ProductStatusService } from '../../src/modules/product/product-status.service';
import { BusinessError } from '../../src/modules/product/product-publish.service';
import { ProductRepository } from '../../src/modules/product/product.repository';
import { PrismaService } from '../../src/infra/prisma.service';

// ---------- 测试夹具 ----------

const SELLER_ID = BigInt(1);
const PRODUCT_ID = BigInt(100);
const BUYER_ID = BigInt(2);
const OTHER_BUYER_ID = BigInt(3);

const makeProductRow = (over: Record<string, unknown> = {}) => ({
  id: PRODUCT_ID,
  seller_id: SELLER_ID,
  title: '高等数学（下册）',
  price: '25.00',
  status: 'on_sale',
  is_urgent: false,
  published_at: new Date('2026-10-01T00:00:00.000Z'),
  sold_at: null,
  off_sale_at: null,
  sold_buyer_id: null,
  ...over,
});

const makeConversationRow = (over: Record<string, unknown> = {}) => ({
  id: BigInt(10),
  buyer_id: BUYER_ID,
  seller_id: SELLER_ID,
  product_id: PRODUCT_ID,
  last_message_at: new Date('2026-10-05T08:00:00.000Z'),
  ...over,
});

const makePrismaMock = () =>
  ({
    product: { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    conversation: { findMany: jest.fn() },
    user: { findMany: jest.fn() },
  }) as unknown as PrismaService & {
    product: {
      findUnique: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    conversation: { findMany: jest.Mock };
    user: { findMany: jest.Mock };
  };

const setup = () => {
  const prisma = makePrismaMock();
  const repo = new ProductRepository(prisma);
  const service = new ProductStatusService(repo);
  return { prisma, repo, service };
};

// ---------- F7-AC1：下架（@api §5.2 #12 POST /products/{id}/offline） ----------

describe('ProductStatusService.offline（@api §5.2 #12，@statemachine PIM-SM-02 on_sale → off_sale）', () => {
  it('下架成功：status 迁移为 off_sale 且写入 off_sale_at', async () => {
    const { prisma, service } = setup();
    prisma.product.findUnique.mockResolvedValue(makeProductRow());
    prisma.product.update.mockResolvedValue(makeProductRow({ status: 'off_sale' }));

    const result = await service.offline(SELLER_ID, '100');

    expect(result).toEqual({ status: ProductStatus.OFF_SALE });
    const updateArg = prisma.product.update.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: PRODUCT_ID });
    expect(updateArg.data.status).toBe('off_sale');
    expect(updateArg.data.off_sale_at).toBeInstanceOf(Date);
  });

  it('已下架再下架 → 2002（状态守卫）', async () => {
    const { prisma, service } = setup();
    prisma.product.findUnique.mockResolvedValue(makeProductRow({ status: 'off_sale' }));

    await expect(service.offline(SELLER_ID, '100')).rejects.toMatchObject({
      code: ERROR_CODES.PRODUCT_OFF_SHELF,
    });
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('已售商品下架 → 2002（sold 终态不可逆）', async () => {
    const { prisma, service } = setup();
    prisma.product.findUnique.mockResolvedValue(makeProductRow({ status: 'sold' }));

    await expect(service.offline(SELLER_ID, '100')).rejects.toMatchObject({
      code: ERROR_CODES.PRODUCT_OFF_SHELF,
    });
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('非卖家操作 → 1003', async () => {
    const { prisma, service } = setup();
    prisma.product.findUnique.mockResolvedValue(makeProductRow());

    await expect(service.offline(BigInt(999), '100')).rejects.toMatchObject({
      code: ERROR_CODES.PERMISSION_DENIED,
    });
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('商品不存在 → 2001', async () => {
    const { prisma, service } = setup();
    prisma.product.findUnique.mockResolvedValue(null);

    await expect(service.offline(SELLER_ID, '100')).rejects.toMatchObject({
      code: ERROR_CODES.PRODUCT_NOT_FOUND,
    });
  });

  it.each([['非数字', 'abc'], ['空串', ''], ['小数', '1.5'], ['负数', '-1']])(
    '商品 id 非法（%s）→ 9001',
    async (_label, id) => {
      const { prisma, service } = setup();

      await expect(service.offline(SELLER_ID, id)).rejects.toMatchObject({
        code: ERROR_CODES.PARAM_VALIDATION_FAILED,
      });
      expect(prisma.product.findUnique).not.toHaveBeenCalled();
    },
  );
});

// ---------- F7-AC1：重新上架（补充接口 POST /products/{id}/relist，本批次声明） ----------

describe('ProductStatusService.relist（补充接口，@statemachine PIM-SM-02 off_sale → on_sale）', () => {
  it('重新上架成功：off_sale → on_sale', async () => {
    const { prisma, service } = setup();
    prisma.product.findUnique.mockResolvedValue(makeProductRow({ status: 'off_sale' }));
    prisma.product.update.mockResolvedValue(makeProductRow());

    const result = await service.relist(SELLER_ID, '100');

    expect(result).toEqual({ status: ProductStatus.ON_SALE });
    const updateArg = prisma.product.update.mock.calls[0][0];
    expect(updateArg.data.status).toBe('on_sale');
  });

  it('on_sale 状态重复上架 → 2002 拦截', async () => {
    const { prisma, service } = setup();
    prisma.product.findUnique.mockResolvedValue(makeProductRow({ status: 'on_sale' }));

    await expect(service.relist(SELLER_ID, '100')).rejects.toMatchObject({
      code: ERROR_CODES.PRODUCT_OFF_SHELF,
    });
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('sold 状态重新上架 → 2002 拦截（终态不可逆，由此守卫实现）', async () => {
    const { prisma, service } = setup();
    prisma.product.findUnique.mockResolvedValue(makeProductRow({ status: 'sold' }));

    await expect(service.relist(SELLER_ID, '100')).rejects.toMatchObject({
      code: ERROR_CODES.PRODUCT_OFF_SHELF,
    });
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('非卖家重新上架 → 1003；不存在 → 2001；id 非法 → 9001', async () => {
    const { prisma, service } = setup();
    prisma.product.findUnique.mockResolvedValue(makeProductRow({ status: 'off_sale' }));

    await expect(service.relist(BigInt(999), '100')).rejects.toMatchObject({
      code: ERROR_CODES.PERMISSION_DENIED,
    });
    prisma.product.findUnique.mockResolvedValue(null);
    await expect(service.relist(SELLER_ID, '100')).rejects.toMatchObject({
      code: ERROR_CODES.PRODUCT_NOT_FOUND,
    });
    await expect(service.relist(SELLER_ID, 'xx')).rejects.toMatchObject({
      code: ERROR_CODES.PARAM_VALIDATION_FAILED,
    });
  });
});

// ---------- F7-AC2：标记已售（@api §5.2 #13 POST /products/{id}/sold，@rule CIM-R-13） ----------

describe('ProductStatusService.markSold（@api §5.2 #13，@rule CIM-R-13 须指定会话买家）', () => {
  it('标记已售成功：买家在会话列表中 → sold + sold_buyer_id + sold_at ISO + order_id=null', async () => {
    const { prisma, service } = setup();
    prisma.product.findUnique.mockResolvedValue(makeProductRow());
    prisma.conversation.findMany.mockResolvedValue([makeConversationRow()]);
    prisma.product.update.mockResolvedValue(
      makeProductRow({ status: 'sold', sold_buyer_id: BUYER_ID, sold_at: new Date() }),
    );

    const result = await service.markSold(SELLER_ID, '100', '2');

    expect(result.status).toBe(ProductStatus.SOLD);
    expect(result.sold_buyer_id).toBe('2');
    expect(typeof result.sold_at).toBe('string');
    expect(new Date(result.sold_at).toISOString()).toBe(result.sold_at);
    expect(result.order_id).toBeNull();

    const updateArg = prisma.product.update.mock.calls[0][0];
    expect(updateArg.data.status).toBe('sold');
    expect(updateArg.data.sold_buyer_id).toBe(BUYER_ID);
    expect(updateArg.data.sold_at).toBeInstanceOf(Date);
  });

  it.each([['未指定', undefined], ['空串', ''], ['非数字', 'abc'], ['负数', '-2']])(
    'buyer_id %s → 9001',
    async (_label, buyerId) => {
      const { prisma, service } = setup();

      await expect(service.markSold(SELLER_ID, '100', buyerId)).rejects.toMatchObject({
        code: ERROR_CODES.PARAM_VALIDATION_FAILED,
      });
      expect(prisma.product.findUnique).not.toHaveBeenCalled();
    },
  );

  it('商品不存在 → 2001', async () => {
    const { prisma, service } = setup();
    prisma.product.findUnique.mockResolvedValue(null);

    await expect(service.markSold(SELLER_ID, '100', '2')).rejects.toMatchObject({
      code: ERROR_CODES.PRODUCT_NOT_FOUND,
    });
  });

  it('非卖家 → 1003', async () => {
    const { prisma, service } = setup();
    prisma.product.findUnique.mockResolvedValue(makeProductRow());

    await expect(service.markSold(BigInt(999), '100', '2')).rejects.toMatchObject({
      code: ERROR_CODES.PERMISSION_DENIED,
    });
  });

  it('sold 再标记 → 2002（终态不可逆）', async () => {
    const { prisma, service } = setup();
    prisma.product.findUnique.mockResolvedValue(makeProductRow({ status: 'sold' }));

    await expect(service.markSold(SELLER_ID, '100', '2')).rejects.toMatchObject({
      code: ERROR_CODES.PRODUCT_OFF_SHELF,
    });
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('off_sale 状态标记已售 → 2002（须先重新上架）', async () => {
    const { prisma, service } = setup();
    prisma.product.findUnique.mockResolvedValue(makeProductRow({ status: 'off_sale' }));

    await expect(service.markSold(SELLER_ID, '100', '2')).rejects.toMatchObject({
      code: ERROR_CODES.PRODUCT_OFF_SHELF,
    });
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('买家不在该商品会话列表中 → 9001（@rule CIM-R-13）', async () => {
    const { prisma, service } = setup();
    prisma.product.findUnique.mockResolvedValue(makeProductRow());
    prisma.conversation.findMany.mockResolvedValue([makeConversationRow()]);

    await expect(service.markSold(SELLER_ID, '100', OTHER_BUYER_ID.toString())).rejects.toMatchObject(
      { code: ERROR_CODES.PARAM_VALIDATION_FAILED },
    );
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('该商品无任何会话 → 任意买家均 9001', async () => {
    const { prisma, service } = setup();
    prisma.product.findUnique.mockResolvedValue(makeProductRow());
    prisma.conversation.findMany.mockResolvedValue([]);

    await expect(service.markSold(SELLER_ID, '100', '2')).rejects.toMatchObject({
      code: ERROR_CODES.PARAM_VALIDATION_FAILED,
    });
  });
});

// ---------- U13 配套：买家候选列表（补充接口 GET /products/{id}/buyer-candidates） ----------

describe('ProductStatusService.listBuyerCandidates（补充接口，U13 配套）', () => {
  it('返回会话买家候选：按 last_message_at desc，join nickname，只暴露公开字段', async () => {
    const { prisma, service } = setup();
    prisma.product.findUnique.mockResolvedValue(makeProductRow());
    prisma.conversation.findMany.mockResolvedValue([
      makeConversationRow({ id: BigInt(11), buyer_id: OTHER_BUYER_ID, last_message_at: new Date('2026-10-05T10:00:00.000Z') }),
      makeConversationRow({ id: BigInt(10), buyer_id: BUYER_ID, last_message_at: new Date('2026-10-05T08:00:00.000Z') }),
    ]);
    prisma.user.findMany.mockResolvedValue([
      { id: BUYER_ID, nickname: '买家甲' },
      { id: OTHER_BUYER_ID, nickname: '买家乙' },
    ]);

    const list = await service.listBuyerCandidates(SELLER_ID, '100');

    expect(list).toEqual([
      {
        buyer_id: '3',
        nickname: '买家乙',
        conversation_id: '11',
        last_message_at: '2026-10-05T10:00:00.000Z',
      },
      {
        buyer_id: '2',
        nickname: '买家甲',
        conversation_id: '10',
        last_message_at: '2026-10-05T08:00:00.000Z',
      },
    ]);
    // user.findMany 必须 select 白名单（防实名泄漏）
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: expect.arrayContaining([BUYER_ID, OTHER_BUYER_ID]) } },
      select: { id: true, nickname: true },
    });
  });

  it('无会话 → 空列表（不查 user 表）', async () => {
    const { prisma, service } = setup();
    prisma.product.findUnique.mockResolvedValue(makeProductRow());
    prisma.conversation.findMany.mockResolvedValue([]);

    const list = await service.listBuyerCandidates(SELLER_ID, '100');

    expect(list).toEqual([]);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('非卖家 → 1003；不存在 → 2001；id 非法 → 9001', async () => {
    const { prisma, service } = setup();
    prisma.product.findUnique.mockResolvedValue(makeProductRow());

    await expect(service.listBuyerCandidates(BigInt(999), '100')).rejects.toMatchObject({
      code: ERROR_CODES.PERMISSION_DENIED,
    });
    prisma.product.findUnique.mockResolvedValue(null);
    await expect(service.listBuyerCandidates(SELLER_ID, '100')).rejects.toMatchObject({
      code: ERROR_CODES.PRODUCT_NOT_FOUND,
    });
    await expect(service.listBuyerCandidates(SELLER_ID, 'abc')).rejects.toMatchObject({
      code: ERROR_CODES.PARAM_VALIDATION_FAILED,
    });
  });
});

// ---------- F7-AC3：我的商品（@api §5.2 #16 GET /products/mine） ----------

describe('ProductStatusService.listMine / listMineTabs（@api §5.2 #16，@ac F7-AC3）', () => {
  it('status=on_sale 过滤：分页单组返回 {list,total,page,pageSize}，字段映射正确', async () => {
    const { prisma, service } = setup();
    prisma.product.findMany.mockResolvedValue([makeProductRow()]);
    prisma.product.count.mockResolvedValue(1);

    const result = await service.listMine(SELLER_ID, { status: 'on_sale', page: '1', pageSize: '10' });

    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(10);
    expect(result.list).toEqual([
      {
        id: '100',
        title: '高等数学（下册）',
        price: '25.00',
        status: 'on_sale',
        is_urgent: false,
        published_at: '2026-10-01T00:00:00.000Z',
        sold_at: null,
        off_sale_at: null,
        sold_buyer_id: null,
      },
    ]);
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { seller_id: SELLER_ID, status: 'on_sale' },
        skip: 0,
        take: 10,
      }),
    );
  });

  it("status='offline' 映射为 'off_sale' 查询", async () => {
    const { prisma, service } = setup();
    prisma.product.findMany.mockResolvedValue([]);
    prisma.product.count.mockResolvedValue(0);

    const result = await service.listMine(SELLER_ID, { status: 'offline' });

    expect(result.list).toEqual([]);
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { seller_id: SELLER_ID, status: 'off_sale' } }),
    );
  });

  it.each([['非法枚举', 'deleted'], ['乱码', 'x1y2']])('status %s → 9001', async (_label, status) => {
    const { prisma, service } = setup();

    await expect(service.listMine(SELLER_ID, { status })).rejects.toMatchObject({
      code: ERROR_CODES.PARAM_VALIDATION_FAILED,
    });
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });

  it.each([
    ['page=0', { page: '0' }],
    ['page 非数字', { page: 'a' }],
    ['pageSize=0', { pageSize: '0' }],
    ['pageSize=51 超上限', { pageSize: '51' }],
  ])('分页参数非法（%s）→ 9001', async (_label, query) => {
    const { prisma, service } = setup();

    await expect(service.listMine(SELLER_ID, { status: 'sold', ...query })).rejects.toMatchObject({
      code: ERROR_CODES.PARAM_VALIDATION_FAILED,
    });
  });

  it('缺省分页 page=1/pageSize=20', async () => {
    const { prisma, service } = setup();
    prisma.product.findMany.mockResolvedValue([]);
    prisma.product.count.mockResolvedValue(0);

    const result = await service.listMine(SELLER_ID, { status: 'sold' });

    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 20 }),
    );
  });

  it('无 status → 分栏三组：在售=on_sale+trading 合并、sold、off_sale', async () => {
    const { prisma, service } = setup();
    prisma.product.findMany.mockResolvedValue([
      makeProductRow({ id: BigInt(101), status: 'on_sale' }),
      makeProductRow({ id: BigInt(102), status: 'trading' }),
      makeProductRow({
        id: BigInt(103),
        status: 'sold',
        sold_buyer_id: BUYER_ID,
        sold_at: new Date('2026-10-03T00:00:00.000Z'),
      }),
      makeProductRow({
        id: BigInt(104),
        status: 'off_sale',
        off_sale_at: new Date('2026-10-04T00:00:00.000Z'),
      }),
    ]);

    const tabs = await service.listMineTabs(SELLER_ID);

    expect(tabs.on_sale.map((p) => p.id)).toEqual(['101', '102']);
    expect(tabs.sold.map((p) => p.id)).toEqual(['103']);
    expect(tabs.off_sale.map((p) => p.id)).toEqual(['104']);
    expect(tabs.sold[0].sold_buyer_id).toBe('2');
    expect(tabs.sold[0].sold_at).toBe('2026-10-03T00:00:00.000Z');
    expect(tabs.off_sale[0].off_sale_at).toBe('2026-10-04T00:00:00.000Z');
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { seller_id: SELLER_ID } }),
    );
  });
});

// ---------- ProductRepository 新方法直测（@table product/conversation 只读/user 白名单） ----------

describe('ProductRepository 状态管理新增方法（Prisma mock）', () => {
  it('findProductById 走 product 主键', async () => {
    const { prisma, repo } = setup();
    prisma.product.findUnique.mockResolvedValue(makeProductRow());

    const row = await repo.findProductById(PRODUCT_ID);

    expect(prisma.product.findUnique).toHaveBeenCalledWith({ where: { id: PRODUCT_ID } });
    expect(row).toMatchObject({ id: PRODUCT_ID });
  });

  it('transitionToOffSale 写 status=off_sale + off_sale_at（@statemachine PIM-SM-02）', async () => {
    const { prisma, repo } = setup();
    const at = new Date('2026-10-06T00:00:00.000Z');
    prisma.product.update.mockResolvedValue(makeProductRow({ status: 'off_sale', off_sale_at: at }));

    await repo.transitionToOffSale(PRODUCT_ID, at);

    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: PRODUCT_ID },
      data: { status: 'off_sale', off_sale_at: at },
    });
  });

  it('transitionToOnSale 写 status=on_sale', async () => {
    const { prisma, repo } = setup();
    prisma.product.update.mockResolvedValue(makeProductRow());

    await repo.transitionToOnSale(PRODUCT_ID);

    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: PRODUCT_ID },
      data: { status: 'on_sale' },
    });
  });

  it('transitionToSold 写 status=sold + sold_buyer_id + sold_at（@rule CIM-R-13）', async () => {
    const { prisma, repo } = setup();
    const at = new Date('2026-10-06T00:00:00.000Z');
    prisma.product.update.mockResolvedValue(makeProductRow({ status: 'sold' }));

    await repo.transitionToSold(PRODUCT_ID, BUYER_ID, at);

    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: PRODUCT_ID },
      data: { status: 'sold', sold_buyer_id: BUYER_ID, sold_at: at },
    });
  });

  it('findConversationsByProductForSeller 按 last_message_at desc（跨 schema 只读消费 chat 表）', async () => {
    const { prisma, repo } = setup();
    prisma.conversation.findMany.mockResolvedValue([makeConversationRow()]);

    const rows = await repo.findConversationsByProductForSeller(PRODUCT_ID, SELLER_ID);

    expect(prisma.conversation.findMany).toHaveBeenCalledWith({
      where: { product_id: PRODUCT_ID, seller_id: SELLER_ID },
      orderBy: { last_message_at: 'desc' },
    });
    expect(rows).toHaveLength(1);
  });

  it('findBuyersPublicByIds 仅 select id/nickname 白名单（防实名泄漏）', async () => {
    const { prisma, repo } = setup();
    prisma.user.findMany.mockResolvedValue([{ id: BUYER_ID, nickname: '买家甲' }]);

    const rows = await repo.findBuyersPublicByIds([BUYER_ID, OTHER_BUYER_ID]);

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: [BUYER_ID, OTHER_BUYER_ID] } },
      select: { id: true, nickname: true },
    });
    expect(rows).toEqual([{ id: BUYER_ID, nickname: '买家甲' }]);
  });

  it('findMineBySeller 带 status 过滤与分页，返回 {list,total}', async () => {
    const { prisma, repo } = setup();
    prisma.product.findMany.mockResolvedValue([makeProductRow()]);
    prisma.product.count.mockResolvedValue(7);

    const result = await repo.findMineBySeller(SELLER_ID, 'on_sale', 2, 10);

    expect(result.total).toBe(7);
    expect(result.list).toHaveLength(1);
    expect(prisma.product.findMany).toHaveBeenCalledWith({
      where: { seller_id: SELLER_ID, status: 'on_sale' },
      orderBy: { published_at: 'desc' },
      skip: 10,
      take: 10,
    });
    expect(prisma.product.count).toHaveBeenCalledWith({
      where: { seller_id: SELLER_ID, status: 'on_sale' },
    });
  });

  it('findMineBySeller 无 status 时不过滤状态', async () => {
    const { prisma, repo } = setup();
    prisma.product.findMany.mockResolvedValue([]);
    prisma.product.count.mockResolvedValue(0);

    await repo.findMineBySeller(SELLER_ID, undefined, 1, 20);

    expect(prisma.product.findMany).toHaveBeenCalledWith({
      where: { seller_id: SELLER_ID },
      orderBy: { published_at: 'desc' },
      skip: 0,
      take: 20,
    });
  });

  it('findAllMineBySeller 全量按 published_at desc', async () => {
    const { prisma, repo } = setup();
    prisma.product.findMany.mockResolvedValue([makeProductRow()]);

    const rows = await repo.findAllMineBySeller(SELLER_ID);

    expect(prisma.product.findMany).toHaveBeenCalledWith({
      where: { seller_id: SELLER_ID },
      orderBy: { published_at: 'desc' },
    });
    expect(rows).toHaveLength(1);
  });
});

// ---------- ProductStatusController：统一响应包络与鉴权上下文 ----------

describe('ProductStatusController（统一响应包络 §5.1）', () => {
  const authedReq = () => ({ user: { id: '1', school_id: '7', identity_type: 'student' } });

  const makeService = () => ({
    offline: jest.fn().mockResolvedValue({ status: 'off_sale' }),
    relist: jest.fn().mockResolvedValue({ status: 'on_sale' }),
    markSold: jest
      .fn()
      .mockResolvedValue({ status: 'sold', sold_buyer_id: '2', sold_at: '2026-10-06T00:00:00.000Z', order_id: null }),
    listBuyerCandidates: jest.fn().mockResolvedValue([]),
    listMine: jest.fn().mockResolvedValue({ list: [], total: 0, page: 1, pageSize: 20 }),
    listMineTabs: jest.fn().mockResolvedValue({ on_sale: [], sold: [], off_sale: [] }),
  });

  it('POST /products/:id/offline 返回 {code:0,message:"ok",data}', async () => {
    const service = makeService();
    const controller = new ProductStatusController(service as unknown as ProductStatusService);

    const res = await controller.offline('100', authedReq());

    expect(res).toEqual({ code: 0, message: 'ok', data: { status: 'off_sale' } });
    expect(service.offline).toHaveBeenCalledWith(BigInt(1), '100');
  });

  it('POST /products/:id/relist 补充接口返回包络', async () => {
    const service = makeService();
    const controller = new ProductStatusController(service as unknown as ProductStatusService);

    const res = await controller.relist('100', authedReq());

    expect(res.code).toBe(0);
    expect(service.relist).toHaveBeenCalledWith(BigInt(1), '100');
  });

  it('POST /products/:id/sold 透传 body.buyer_id', async () => {
    const service = makeService();
    const controller = new ProductStatusController(service as unknown as ProductStatusService);

    const res = await controller.markSold('100', { buyer_id: '2' }, authedReq());

    expect(res.code).toBe(0);
    expect(res.data.status).toBe('sold');
    expect(res.data.order_id).toBeNull();
    expect(service.markSold).toHaveBeenCalledWith(BigInt(1), '100', '2');
  });

  it('GET /products/mine 有 status → 分页单组；无 status → 分栏三组', async () => {
    const service = makeService();
    const controller = new ProductStatusController(service as unknown as ProductStatusService);

    const paged = await controller.mine(authedReq(), { status: 'on_sale' });
    expect(service.listMine).toHaveBeenCalledWith(BigInt(1), { status: 'on_sale' });
    expect(paged.data).toEqual({ list: [], total: 0, page: 1, pageSize: 20 });

    const tabs = await controller.mine(authedReq(), {});
    expect(service.listMineTabs).toHaveBeenCalledWith(BigInt(1));
    expect(tabs.data).toEqual({ on_sale: [], sold: [], off_sale: [] });
  });

  it('GET /products/:id/buyer-candidates 补充接口返回包络', async () => {
    const service = makeService();
    const controller = new ProductStatusController(service as unknown as ProductStatusService);

    const res = await controller.buyerCandidates('100', authedReq());

    expect(res).toEqual({ code: 0, message: 'ok', data: [] });
    expect(service.listBuyerCandidates).toHaveBeenCalledWith(BigInt(1), '100');
  });

  it.each([
    ['offline', (c: ProductStatusController) => c.offline('100', {})],
    ['relist', (c: ProductStatusController) => c.relist('100', {})],
    ['markSold', (c: ProductStatusController) => c.markSold('100', { buyer_id: '2' }, {})],
    ['mine', (c: ProductStatusController) => c.mine({}, {})],
    ['buyerCandidates', (c: ProductStatusController) => c.buyerCandidates('100', {})],
  ])('req.user 缺失 → 1001（%s），不透传 service', async (_label, invoke) => {
    const service = makeService();
    const controller = new ProductStatusController(service as unknown as ProductStatusService);

    await expect(invoke(controller)).rejects.toMatchObject({
      code: ERROR_CODES.AUTH_TOKEN_INVALID,
    });
    expect(service.offline).not.toHaveBeenCalled();
    expect(service.relist).not.toHaveBeenCalled();
    expect(service.markSold).not.toHaveBeenCalled();
    expect(service.listMine).not.toHaveBeenCalled();
    expect(service.listMineTabs).not.toHaveBeenCalled();
    expect(service.listBuyerCandidates).not.toHaveBeenCalled();
  });

  it('业务错误（如 2002）原样向上抛，由全局过滤器统一包装', async () => {
    const service = makeService();
    service.offline.mockRejectedValue(new BusinessError(ERROR_CODES.PRODUCT_OFF_SHELF, '商品已下架'));
    const controller = new ProductStatusController(service as unknown as ProductStatusService);

    await expect(controller.offline('100', authedReq())).rejects.toMatchObject({
      code: ERROR_CODES.PRODUCT_OFF_SHELF,
    });
  });
});
