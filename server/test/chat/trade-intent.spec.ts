/**
 * trade-intent.spec.ts —— T-205 交易意向卡片（发起/响应/双方确认/拒绝/状态冲突）
 *
 * @module PIM-BC-03 沟通与协商
 * @model PIM-AG-05 交易意向卡片聚合（TradeIntentCard）
 * @rule CIM-R-14 同一 conversation+product 可多次发起，裁决以最后一条 confirmed 记录为准
 * @table trade_intent → PIM-AG-05
 * @api §5.2 #28 POST /conversations/:id/intents + #29 POST /intents/:id/respond
 * @ac F14-AC1 双方确认后卡片置「双方已确认」并留痕；任一方未确认前为待确认
 *
 * 覆盖验收点：
 *  - 发起：成功（status=pending + 字段落库）/ 非会话成员 1003 / 会话不存在 3001 / 字段非法 9001
 *  - 响应：accept 单方确认仍 pending（本方 confirmed_at 落库）/ 双方确认 → confirmed
 *  - CIM-R-14：confirmed 时按 conversation_id+product_id 查询最新一条 confirmed 记录（订单引用裁决）
 *  - reject → cancelled / 非 pending 响应 3004 / 发起者自响应 1003（自定口径，见服务注释）
 *
 * 无真实 MySQL：PrismaService 一律 jest mock（同 conversation-message.spec.ts 口径）。
 */
import { ERROR_CODES } from '@contract/index';
import { IntentController } from '../../src/modules/chat/intent.controller';
import { IntentService } from '../../src/modules/chat/intent.service';
import { PrismaService } from '../../src/infra/prisma.service';

// ---------- 测试夹具 ----------

const BUYER = { id: BigInt(1) };
const SELLER = { id: BigInt(2) };
const STRANGER = { id: BigInt(9) };
const CONV_ID = BigInt(500);
const PRODUCT_ID = BigInt(100);
const INTENT_ID = BigInt(700);

const makeConversationRow = (over: Record<string, unknown> = {}) => ({
  id: CONV_ID,
  buyer_id: BUYER.id,
  seller_id: SELLER.id,
  product_id: PRODUCT_ID,
  ...over,
});

/** 意向卡片行：默认买方发起、待确认、双方 confirmed_at 均为空 */
const makeIntentRow = (over: Record<string, unknown> = {}) => ({
  id: INTENT_ID,
  conversation_id: CONV_ID,
  product_id: PRODUCT_ID,
  initiator_id: BUYER.id,
  trade_mode: 'offline_meet',
  meet_time: new Date('2026-10-07T10:00:00.000Z'),
  meet_location: '东门咖啡屋',
  amount: '25.00',
  buyer_confirmed_at: null,
  seller_confirmed_at: null,
  status: 'pending',
  created_at: new Date('2026-10-06T02:00:00.000Z'),
  ...over,
});

const makePrismaMock = () =>
  ({
    conversation: { findUnique: jest.fn() },
    tradeIntent: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
    },
  }) as unknown as PrismaService & {
    conversation: { findUnique: jest.Mock };
    tradeIntent: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      findFirst: jest.Mock;
    };
  };

const setup = () => {
  const prisma = makePrismaMock();
  const intentService = new IntentService(prisma);
  const controller = new IntentController(intentService);
  return { prisma, intentService, controller };
};

const CREATE_BODY = {
  product_id: '100',
  price: '25.00',
  meet_location: '东门咖啡屋',
  meet_time: '2026-10-07T10:00:00.000Z',
};

// ---------- 发起意向卡片（POST /conversations/:id/intents，@api §5.2 #28） ----------

describe('IntentService.createIntent（@ac F14-AC1，@api §5.2 #28）', () => {
  it('成功：初始 status=pending，product_id/price/meet_location/meet_time 落库', async () => {
    const { prisma, intentService } = setup();
    prisma.conversation.findUnique.mockResolvedValue(makeConversationRow());
    prisma.tradeIntent.create.mockResolvedValue(makeIntentRow());

    const result = await intentService.createIntent(BUYER, '500', CREATE_BODY);

    expect(result).toEqual({ intent_id: '700', status: 'pending' });
    expect(prisma.tradeIntent.create).toHaveBeenCalledWith({
      data: {
        conversation_id: CONV_ID,
        product_id: PRODUCT_ID,
        initiator_id: BUYER.id,
        trade_mode: 'offline_meet',
        amount: '25.00',
        meet_location: '东门咖啡屋',
        meet_time: new Date('2026-10-07T10:00:00.000Z'),
        status: 'pending',
      },
    });
  });

  it('controller 包装：返回统一包络 { code: 0, data }', async () => {
    const { prisma, controller } = setup();
    prisma.conversation.findUnique.mockResolvedValue(makeConversationRow());
    prisma.tradeIntent.create.mockResolvedValue(makeIntentRow());

    const res = await controller.create('500', CREATE_BODY, { user: { uid: '1' } });

    expect(res.code).toBe(0);
    expect(res.data).toEqual({ intent_id: '700', status: 'pending' });
  });

  it('非会话成员发起 → 1003', async () => {
    const { prisma, intentService } = setup();
    prisma.conversation.findUnique.mockResolvedValue(makeConversationRow());

    await expect(
      intentService.createIntent(STRANGER, '500', CREATE_BODY),
    ).rejects.toMatchObject({ code: ERROR_CODES.PERMISSION_DENIED });
    expect(prisma.tradeIntent.create).not.toHaveBeenCalled();
  });

  it('会话不存在 → 3001', async () => {
    const { prisma, intentService } = setup();
    prisma.conversation.findUnique.mockResolvedValue(null);

    await expect(
      intentService.createIntent(BUYER, '500', CREATE_BODY),
    ).rejects.toMatchObject({ code: ERROR_CODES.CONVERSATION_NOT_FOUND });
  });

  it.each([
    ['product_id 非法', { ...CREATE_BODY, product_id: 'abc' }],
    ['price 非正数', { ...CREATE_BODY, price: '-1' }],
    ['price 非数字', { ...CREATE_BODY, price: 'abc' }],
    ['meet_location 为空', { ...CREATE_BODY, meet_location: '  ' }],
    ['meet_time 非法', { ...CREATE_BODY, meet_time: 'not-a-date' }],
  ])('%s → 9001', async (_label, body) => {
    const { prisma, intentService } = setup();

    await expect(
      intentService.createIntent(BUYER, '500', body),
    ).rejects.toMatchObject({ code: ERROR_CODES.PARAM_VALIDATION_FAILED });
    expect(prisma.conversation.findUnique).not.toHaveBeenCalled();
  });

  it('会话 id 非法 → 9001', async () => {
    const { intentService } = setup();

    await expect(
      intentService.createIntent(BUYER, 'x', CREATE_BODY),
    ).rejects.toMatchObject({ code: ERROR_CODES.PARAM_VALIDATION_FAILED });
  });
});

// ---------- 响应意向卡片（POST /intents/:id/respond，@api §5.2 #29） ----------

describe('IntentService.respond（@ac F14-AC1，@rule CIM-R-14，@api §5.2 #29）', () => {
  it('accept 单方确认：卖方先响应 → 仅 seller_confirmed_at 落库，仍 pending（@ac F14-AC1）', async () => {
    const { prisma, intentService } = setup();
    prisma.tradeIntent.findUnique.mockResolvedValue(makeIntentRow());
    prisma.conversation.findUnique.mockResolvedValue(makeConversationRow());
    prisma.tradeIntent.update.mockResolvedValue(makeIntentRow());

    const result = await intentService.respond(SELLER, '700', { action: 'accept' });

    expect(result).toEqual({ status: 'pending', order_id: null });
    const updateArg = prisma.tradeIntent.update.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: INTENT_ID });
    expect(updateArg.data.seller_confirmed_at).toBeInstanceOf(Date);
    expect(updateArg.data.status).toBeUndefined();
  });

  it('accept 双方确认：买方补确认 → buyer_confirmed_at 落库 + status=confirmed（@ac F14-AC1）', async () => {
    const { prisma, intentService } = setup();
    // 卖方已确认（其 confirmed_at 非空），买方响应后双方齐备
    prisma.tradeIntent.findUnique.mockResolvedValue(
      makeIntentRow({ seller_confirmed_at: new Date('2026-10-06T03:00:00.000Z') }),
    );
    prisma.conversation.findUnique.mockResolvedValue(makeConversationRow());
    prisma.tradeIntent.update.mockResolvedValue(makeIntentRow({ status: 'confirmed' }));
    prisma.tradeIntent.findFirst.mockResolvedValue(makeIntentRow({ status: 'confirmed' }));

    const result = await intentService.respond(BUYER, '700', { action: 'accept' });

    expect(result).toEqual({ status: 'confirmed', order_id: null });
    const updateArg = prisma.tradeIntent.update.mock.calls[0][0];
    expect(updateArg.data.buyer_confirmed_at).toBeInstanceOf(Date);
    expect(updateArg.data.status).toBe('confirmed');
  });

  it('@rule CIM-R-14：confirmed 时按同会话同商品查询最新一条 confirmed 记录作为订单引用裁决', async () => {
    const { prisma, intentService } = setup();
    prisma.tradeIntent.findUnique.mockResolvedValue(
      makeIntentRow({ seller_confirmed_at: new Date('2026-10-06T03:00:00.000Z') }),
    );
    prisma.conversation.findUnique.mockResolvedValue(makeConversationRow());
    prisma.tradeIntent.update.mockResolvedValue(makeIntentRow({ status: 'confirmed' }));
    prisma.tradeIntent.findFirst.mockResolvedValue(makeIntentRow({ status: 'confirmed' }));

    await intentService.respond(BUYER, '700', { action: 'accept' });

    expect(prisma.tradeIntent.findFirst).toHaveBeenCalledWith({
      where: { conversation_id: CONV_ID, product_id: PRODUCT_ID, status: 'confirmed' },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    });
  });

  it('reject → status=cancelled（@ac F14-AC1 拒绝留痕）', async () => {
    const { prisma, intentService } = setup();
    prisma.tradeIntent.findUnique.mockResolvedValue(makeIntentRow());
    prisma.conversation.findUnique.mockResolvedValue(makeConversationRow());
    prisma.tradeIntent.update.mockResolvedValue(makeIntentRow({ status: 'cancelled' }));

    const result = await intentService.respond(SELLER, '700', { action: 'reject' });

    expect(result).toEqual({ status: 'cancelled', order_id: null });
    expect(prisma.tradeIntent.update).toHaveBeenCalledWith({
      where: { id: INTENT_ID },
      data: { status: 'cancelled' },
    });
  });

  it('非 pending 状态响应（已 confirmed）→ 3004 状态冲突', async () => {
    const { prisma, intentService } = setup();
    prisma.tradeIntent.findUnique.mockResolvedValue(makeIntentRow({ status: 'confirmed' }));
    prisma.conversation.findUnique.mockResolvedValue(makeConversationRow());

    await expect(
      intentService.respond(SELLER, '700', { action: 'accept' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.INTENT_STATUS_CONFLICT });
    expect(prisma.tradeIntent.update).not.toHaveBeenCalled();
  });

  it('非 pending 状态响应（已 cancelled）reject 也 → 3004', async () => {
    const { prisma, intentService } = setup();
    prisma.tradeIntent.findUnique.mockResolvedValue(makeIntentRow({ status: 'cancelled' }));
    prisma.conversation.findUnique.mockResolvedValue(makeConversationRow());

    await expect(
      intentService.respond(SELLER, '700', { action: 'reject' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.INTENT_STATUS_CONFLICT });
  });

  it('发起者自己响应 → 1003（自定口径：发起者非「会话对方」，无权响应）', async () => {
    const { prisma, intentService } = setup();
    prisma.tradeIntent.findUnique.mockResolvedValue(makeIntentRow());
    prisma.conversation.findUnique.mockResolvedValue(makeConversationRow());

    await expect(
      intentService.respond(BUYER, '700', { action: 'accept' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.PERMISSION_DENIED });
    expect(prisma.tradeIntent.update).not.toHaveBeenCalled();
  });

  it('非会话成员响应 → 1003', async () => {
    const { prisma, intentService } = setup();
    prisma.tradeIntent.findUnique.mockResolvedValue(makeIntentRow());
    prisma.conversation.findUnique.mockResolvedValue(makeConversationRow());

    await expect(
      intentService.respond(STRANGER, '700', { action: 'accept' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.PERMISSION_DENIED });
  });

  it('意向卡片不存在 → 3001（自定口径：归入沟通段「不存在」语义，见服务注释）', async () => {
    const { prisma, intentService } = setup();
    prisma.tradeIntent.findUnique.mockResolvedValue(null);

    await expect(
      intentService.respond(SELLER, '700', { action: 'accept' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.CONVERSATION_NOT_FOUND });
  });

  it('意向所属会话数据缺失 → 3001', async () => {
    const { prisma, intentService } = setup();
    prisma.tradeIntent.findUnique.mockResolvedValue(makeIntentRow());
    prisma.conversation.findUnique.mockResolvedValue(null);

    await expect(
      intentService.respond(SELLER, '700', { action: 'accept' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.CONVERSATION_NOT_FOUND });
  });

  it('action 非法 → 9001', async () => {
    const { prisma, intentService } = setup();

    await expect(
      intentService.respond(SELLER, '700', { action: 'maybe' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.PARAM_VALIDATION_FAILED });
    expect(prisma.tradeIntent.findUnique).not.toHaveBeenCalled();
  });

  it('意向 id 非法 → 9001', async () => {
    const { intentService } = setup();

    await expect(
      intentService.respond(SELLER, '0', { action: 'accept' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.PARAM_VALIDATION_FAILED });
  });
});
