/**
 * notification.spec.ts —— T-210 消息通知写入与读侧
 *
 * @module PIM-BC-06 触达支撑（notify 无聚合，按 PIM-C-3 暂定口径下沉 infra/notify-sender）
 * @model PIM-BC-06
 * @table notification → 无聚合 BC-06
 * @api §5.2 #44 GET /notifications、#45 POST /notifications/read
 * @ac F15-AC1 求购匹配通知落库（写入侧），读侧列表/已读支撑通知中心
 *
 * 覆盖验收点：
 *  - 写入侧：NotifySenderService.send({user_id,type,title,payload?}) 落库 notification 表
 *  - #44：本人通知列表按 created_at 倒序分页 + unread_count（未读计数）
 *  - #45：ids 数组批量标记已读（is_read=true + read_at）；空数组=全部已读
 *  - 越权防护：查询/更新 where 恒带本人 user_id，他人通知不可见/不可改
 *
 * 无真实 MySQL：PrismaService 一律 jest mock（同 product-search.spec.ts 口径）。
 */
import { ERROR_CODES, NotificationType } from '@contract/index';
import { NotifySenderService } from '../../src/infra/notify-sender/notify-sender.service';
import { NotificationRepository } from '../../src/infra/notify-sender/notification.repository';
import { NotifyController } from '../../src/modules/notify/notify.controller';
import {
  BusinessError,
  NotifyQueryService,
} from '../../src/modules/notify/notify-query.service';
import { PrismaService } from '../../src/infra/prisma.service';

// ---------- 测试夹具 ----------

const UID = '1';
const UID_BIGINT = BigInt(1);

const makeRow = (over: Record<string, unknown> = {}) => ({
  id: BigInt(11),
  user_id: UID_BIGINT,
  type: 'want_buy_match',
  title: '你求购的「高等数学」有匹配商品',
  payload: { product_id: '100', want_buy_id: '5' },
  is_read: false,
  read_at: null,
  created_at: new Date('2026-10-06T08:00:00.000Z'),
  ...over,
});

const makePrismaMock = () =>
  ({
    notification: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
    },
  }) as unknown as PrismaService & {
    notification: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      updateMany: jest.Mock;
    };
  };

const setup = () => {
  const prisma = makePrismaMock();
  const repo = new NotificationRepository(prisma);
  const sender = new NotifySenderService(repo);
  const service = new NotifyQueryService(repo);
  return { prisma, repo, sender, service };
};

/** 最近一次 updateMany 调用参数 */
const lastUpdateMany = (prisma: ReturnType<typeof makePrismaMock>) =>
  prisma.notification.updateMany.mock.calls[
    prisma.notification.updateMany.mock.calls.length - 1
  ][0];

// ---------- 写入侧：NotifySenderService.send ----------

describe('NotifySenderService.send 写入 notification 表（@model PIM-BC-06，@ac F15-AC1）', () => {
  it('type/title/payload 原样落库，user_id 转 BigInt，返回新通知 id（字符串）', async () => {
    const { prisma, sender } = setup();
    prisma.notification.create.mockResolvedValue(makeRow());

    const result = await sender.send({
      user_id: UID,
      type: NotificationType.WANT_BUY_MATCH,
      title: '你求购的「高等数学」有匹配商品',
      payload: { product_id: '100', want_buy_id: '5' },
    });

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: {
        user_id: UID_BIGINT,
        type: 'want_buy_match',
        title: '你求购的「高等数学」有匹配商品',
        payload: { product_id: '100', want_buy_id: '5' },
      },
    });
    expect(result).toEqual({ id: '11' });
  });

  it('payload 省略时不写入该字段（DB 默认 NULL）', async () => {
    const { prisma, sender } = setup();
    prisma.notification.create.mockResolvedValue(makeRow({ payload: null }));

    await sender.send({
      user_id: UID,
      type: NotificationType.ORDER_STATUS,
      title: '订单状态变更',
    });

    const data = prisma.notification.create.mock.calls[0][0].data;
    expect(data).toEqual({
      user_id: UID_BIGINT,
      type: 'order_status',
      title: '订单状态变更',
      payload: undefined,
    });
  });

  it('user_id 支持 bigint 入参（模块间 contract 事件触发调用）', async () => {
    const { prisma, sender } = setup();
    prisma.notification.create.mockResolvedValue(makeRow());

    await sender.send({
      user_id: BigInt(2),
      type: NotificationType.REVIEW_REMIND,
      title: '交易已完成，快去评价吧',
    });

    expect(prisma.notification.create.mock.calls[0][0].data.user_id).toBe(BigInt(2));
  });
});

// ---------- 读侧 #44：GET /notifications ----------

describe('NotifyQueryService.list 通知列表（@api §5.2 #44）', () => {
  it('按 created_at 倒序分页，返回 list + total + unread_count；id/created_at 序列化', async () => {
    const { prisma, service } = setup();
    prisma.notification.findMany.mockResolvedValue([makeRow()]);
    prisma.notification.count
      .mockResolvedValueOnce(21) // total（分页 where）
      .mockResolvedValueOnce(3); // unread_count（user_id + is_read=false）

    const result = await service.list(UID, { page: '2', pageSize: '20' });

    expect(prisma.notification.findMany).toHaveBeenCalledWith({
      where: { user_id: UID_BIGINT },
      orderBy: { created_at: 'desc' },
      skip: 20,
      take: 20,
    });
    // unread_count：独立计数，where 恒带 is_read=false
    expect(prisma.notification.count).toHaveBeenNthCalledWith(2, {
      where: { user_id: UID_BIGINT, is_read: false },
    });
    expect(result).toEqual({
      list: [
        {
          id: '11',
          type: 'want_buy_match',
          title: '你求购的「高等数学」有匹配商品',
          payload: { product_id: '100', want_buy_id: '5' },
          is_read: false,
          created_at: '2026-10-06T08:00:00.000Z',
        },
      ],
      total: 21,
      unread_count: 3,
      page: 2,
      pageSize: 20,
    });
  });

  it('默认分页 page=1/pageSize=20；payload 为 NULL 时返回 null', async () => {
    const { prisma, service } = setup();
    prisma.notification.findMany.mockResolvedValue([makeRow({ payload: null })]);
    prisma.notification.count.mockResolvedValue(0);

    const result = await service.list(UID, {});

    expect(prisma.notification.findMany).toHaveBeenCalledWith({
      where: { user_id: UID_BIGINT },
      orderBy: { created_at: 'desc' },
      skip: 0,
      take: 20,
    });
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(result.list[0].payload).toBeNull();
  });

  it('type 可选过滤：合法枚举叠加 where.type', async () => {
    const { prisma, service } = setup();
    prisma.notification.findMany.mockResolvedValue([]);
    prisma.notification.count.mockResolvedValue(0);

    await service.list(UID, { type: 'order_status' });

    expect(prisma.notification.findMany.mock.calls[0][0].where).toEqual({
      user_id: UID_BIGINT,
      type: 'order_status',
    });
    // 分页 total 的 count 同样带 type 过滤
    expect(prisma.notification.count).toHaveBeenNthCalledWith(1, {
      where: { user_id: UID_BIGINT, type: 'order_status' },
    });
  });

  it.each([
    [{ type: 'not_a_type' }, 'type'],
    [{ page: '0' }, 'page'],
    [{ page: 'abc' }, 'page'],
    [{ pageSize: '51' }, 'pageSize'],
    [{ pageSize: '0' }, 'pageSize'],
  ])('查询参数非法 %j → 9001 PARAM_VALIDATION_FAILED', async (raw, field) => {
    const { service } = setup();

    await expect(service.list(UID, raw)).rejects.toMatchObject({
      name: 'BusinessError',
      code: ERROR_CODES.PARAM_VALIDATION_FAILED,
    });
    await expect(service.list(UID, raw)).rejects.toBeInstanceOf(BusinessError);
    expect(field).toBeTruthy();
  });
});

// ---------- 读侧 #45：POST /notifications/read ----------

describe('NotifyQueryService.markRead 标记已读（@api §5.2 #45）', () => {
  it('指定 ids：批量更新 is_read=true + read_at，where 限定本人未读；返回最新 unread_count', async () => {
    const { prisma, service } = setup();
    prisma.notification.updateMany.mockResolvedValue({ count: 2 });
    prisma.notification.count.mockResolvedValue(1);

    const result = await service.markRead(UID, { ids: ['11', '12'] });

    const args = lastUpdateMany(prisma);
    expect(args.where).toEqual({
      user_id: UID_BIGINT,
      is_read: false,
      id: { in: [BigInt(11), BigInt(12)] },
    });
    expect(args.data.is_read).toBe(true);
    expect(args.data.read_at).toBeInstanceOf(Date);
    // 标记后重新计数未读
    expect(prisma.notification.count).toHaveBeenCalledWith({
      where: { user_id: UID_BIGINT, is_read: false },
    });
    expect(result).toEqual({ unread_count: 1 });
  });

  it('空数组 = 全部已读：where 仅 user_id + is_read=false（不带 id 过滤）', async () => {
    const { prisma, service } = setup();
    prisma.notification.updateMany.mockResolvedValue({ count: 5 });
    prisma.notification.count.mockResolvedValue(0);

    const result = await service.markRead(UID, { ids: [] });

    const args = lastUpdateMany(prisma);
    expect(args.where).toEqual({ user_id: UID_BIGINT, is_read: false });
    expect(args.where.id).toBeUndefined();
    expect(result).toEqual({ unread_count: 0 });
  });

  it('ids 元素支持数字类型（统一转 BigInt）', async () => {
    const { prisma, service } = setup();
    prisma.notification.updateMany.mockResolvedValue({ count: 1 });
    prisma.notification.count.mockResolvedValue(0);

    await service.markRead(UID, { ids: [11] });

    expect(lastUpdateMany(prisma).where.id).toEqual({ in: [BigInt(11)] });
  });

  it.each([
    [{}, 'ids 缺失'],
    [{ ids: '11' }, 'ids 非数组'],
    [{ ids: ['abc'] }, '元素非数字'],
    [{ ids: [1.5] }, '元素非整数'],
    [{ ids: [null] }, '元素为 null'],
  ] as Array<[unknown, string]>)('请求体非法（%s）→ 9001 不落库', async (body) => {
    const { prisma, service } = setup();

    await expect(service.markRead(UID, body)).rejects.toMatchObject({
      name: 'BusinessError',
      code: ERROR_CODES.PARAM_VALIDATION_FAILED,
    });
    expect(prisma.notification.updateMany).not.toHaveBeenCalled();
  });
});

// ---------- 越权防护：他人通知不可见/不可改 ----------

describe('越权防护：查询/更新 where 恒带本人 user_id', () => {
  it('列表查询 where.user_id 恒为当前登录人（他人通知不可见）', async () => {
    const { prisma, service } = setup();
    prisma.notification.findMany.mockResolvedValue([]);
    prisma.notification.count.mockResolvedValue(0);

    await service.list('42', {});

    const where = prisma.notification.findMany.mock.calls[0][0].where;
    expect(where.user_id).toBe(BigInt(42));
    // count（total 与 unread_count）同样限定本人
    for (const call of prisma.notification.count.mock.calls) {
      expect(call[0].where.user_id).toBe(BigInt(42));
    }
  });

  it('标记已读 where.user_id 恒为本人：即使 ids 为他人通知 id 也不会被更新', async () => {
    const { prisma, service } = setup();
    prisma.notification.updateMany.mockResolvedValue({ count: 0 });
    prisma.notification.count.mockResolvedValue(2);

    await service.markRead('42', { ids: ['999'] });

    const where = lastUpdateMany(prisma).where;
    expect(where.user_id).toBe(BigInt(42));
    expect(where.id).toEqual({ in: [BigInt(999)] });
  });
});

// ---------- 控制器包络（JWT 守卫下取 req.user.uid） ----------

describe('NotifyController 统一响应包络（@api §5.2 #44/#45）', () => {
  it('GET /notifications：透传 uid 与 query，包络 code=0', async () => {
    const { prisma, service } = setup();
    prisma.notification.findMany.mockResolvedValue([]);
    prisma.notification.count.mockResolvedValue(0);
    const controller = new NotifyController(service);

    const res = await controller.list({ user: { uid: '7' } }, { page: '1' });

    expect(res.code).toBe(0);
    expect(res.message).toBe('ok');
    expect(prisma.notification.findMany.mock.calls[0][0].where.user_id).toBe(BigInt(7));
    expect(res.data.page).toBe(1);
  });

  it('POST /notifications/read：透传 uid 与 body，包络 code=0', async () => {
    const { prisma, service } = setup();
    prisma.notification.updateMany.mockResolvedValue({ count: 1 });
    prisma.notification.count.mockResolvedValue(0);
    const controller = new NotifyController(service);

    const res = await controller.markRead({ user: { uid: '7' } }, { ids: ['1'] });

    expect(res.code).toBe(0);
    expect(res.data).toEqual({ unread_count: 0 });
    expect(lastUpdateMany(prisma).where.user_id).toBe(BigInt(7));
  });
});
