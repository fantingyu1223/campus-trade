/**
 * conversation-message.spec.ts —— T-203 会话与消息（发起会话/发消息/游标分页/已读回执/会话列表）
 *
 * @module PIM-BC-03 沟通与协商
 * @model PIM-AG-05 会话与消息聚合
 * @rule CIM-R-01 已认证方可发起会话（guest → 1004）
 * @rule CIM-R-04 发送消息事务内写 message + 更新 conversation 未读数/last_message_*
 * @table conversation/message → PIM-AG-05
 * @api §5.2 #25-27 + POST /conversations（发起会话）+ POST /conversations/:id/read（已读回执）
 * @ac F12-AC1 发消息卖方未读+1、已读后买方侧可见已读 / F12-AC2 已下架/已售商品无既有会话拦截（2002）
 *
 * 覆盖验收点：
 *  - 发起会话：成功 / 游客 1004（VerifiedGuard）/ 已下架·已售 2002 / 被拉黑 3003 / 重复会话复用
 *  - 发消息：成功（$transaction、receiver 未读数+1、last_message_* 更新）/ 非会话成员 1003 / 会话不存在 3001
 *  - 消息游标分页：before_id + limit，has_more 判定
 *  - 已读回执：对方消息批量 is_read=true+read_at、本人未读数清零
 *  - 会话列表：买卖双方双视角、未读数、last_message_at 倒序、对方 nickname/identity_type 白名单
 *
 * 无真实 MySQL：PrismaService 一律 jest mock（同 product-publish.spec.ts 口径）。
 */
import { ERROR_CODES, ProductStatus, UserIdentityType } from '@contract/index';
import { ExecutionContext } from '@nestjs/common';
import { ChatController } from '../../src/modules/chat/chat.controller';
import { ConversationService, BusinessError } from '../../src/modules/chat/conversation.service';
import { MessageService } from '../../src/modules/chat/message.service';
import { RiskWordService } from '../../src/modules/chat/risk-word.service';
import { ChatRepository } from '../../src/modules/chat/chat.repository';
import {
  validateCreateConversationFields,
  validateSendMessageFields,
  parseConversationId,
  parseCursorQuery,
} from '../../src/modules/chat/chat.validator';
import { VerifiedGuard } from '../../src/infra/auth/verified.guard';
import { PrismaService } from '../../src/infra/prisma.service';

// ---------- 测试夹具 ----------

const BUYER = { id: BigInt(1) };
const SELLER = { id: BigInt(2) };
const STRANGER = { id: BigInt(9) };
const PRODUCT_ID = BigInt(100);
const CONV_ID = BigInt(500);

const makeProductRow = (over: Record<string, unknown> = {}) => ({
  id: PRODUCT_ID,
  seller_id: SELLER.id,
  status: 'on_sale',
  ...over,
});

const makeConversationRow = (over: Record<string, unknown> = {}) => ({
  id: CONV_ID,
  buyer_id: BUYER.id,
  seller_id: SELLER.id,
  product_id: PRODUCT_ID,
  buyer_unread_count: 0,
  seller_unread_count: 0,
  last_message_content: null,
  last_message_type: null,
  last_message_sender_id: null,
  last_message_at: null,
  buyer_deleted: false,
  seller_deleted: false,
  created_at: new Date('2026-10-06T00:00:00.000Z'),
  ...over,
});

const makeMessageRow = (over: Record<string, unknown> = {}) => ({
  id: BigInt(900),
  conversation_id: CONV_ID,
  sender_id: BUYER.id,
  receiver_id: SELLER.id,
  type: 'text',
  content: '你好，还在吗？',
  image_url: null,
  intent_payload: null,
  is_read: false,
  read_at: null,
  created_at: new Date('2026-10-06T01:00:00.000Z'),
  ...over,
});

const makePrismaMock = () =>
  ({
    product: { findUnique: jest.fn() },
    block: { findFirst: jest.fn() },
    conversation: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    message: { create: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
    user: { findUnique: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(),
  }) as unknown as PrismaService & {
    product: { findUnique: jest.Mock };
    block: { findFirst: jest.Mock };
    conversation: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
    };
    message: { create: jest.Mock; findMany: jest.Mock; updateMany: jest.Mock };
    user: { findUnique: jest.Mock; findMany: jest.Mock };
    $transaction: jest.Mock;
  };

const setup = () => {
  const prisma = makePrismaMock();
  // $transaction 回调直接复用同一 mock 作为 tx（同 product-publish.spec.ts 口径）
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
  const repo = new ChatRepository(prisma);
  const riskWordService = new RiskWordService(prisma);
  const conversationService = new ConversationService(repo);
  const messageService = new MessageService(repo, riskWordService);
  const controller = new ChatController(conversationService, messageService);
  return { prisma, repo, conversationService, messageService, controller };
};

// ---------- 发起会话（POST /conversations） ----------

describe('ConversationService.createConversation（@ac F12-AC1/F12-AC2，@rule CIM-R-01）', () => {
  it('成功：落库 buyer_id+seller_id+product_id，返回 conversation_id（reused=false）', async () => {
    const { prisma, conversationService } = setup();
    prisma.product.findUnique.mockResolvedValue(makeProductRow());
    prisma.conversation.findUnique.mockResolvedValue(null);
    prisma.block.findFirst.mockResolvedValue(null);
    prisma.conversation.create.mockResolvedValue(makeConversationRow());

    const result = await conversationService.createConversation(BUYER, { product_id: '100' });

    expect(result).toEqual({ conversation_id: '500', reused: false });
    expect(prisma.conversation.create).toHaveBeenCalledWith({
      data: { buyer_id: BUYER.id, seller_id: SELLER.id, product_id: PRODUCT_ID },
    });
  });

  it('游客发起会话 → 1004（VerifiedGuard 实时查 identity_type，@rule CIM-R-01）', async () => {
    const { prisma } = setup();
    prisma.user.findUnique.mockResolvedValue({ identity_type: UserIdentityType.GUEST });
    const guard = new VerifiedGuard(prisma);
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ user: { uid: '1' } }) }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { code: ERROR_CODES.NOT_VERIFIED },
    });
  });

  it('已下架商品（off_sale）无既有会话 → 2002，不建会话（@ac F12-AC2）', async () => {
    const { prisma, conversationService } = setup();
    prisma.product.findUnique.mockResolvedValue(makeProductRow({ status: ProductStatus.OFF_SALE }));
    prisma.conversation.findUnique.mockResolvedValue(null);

    await expect(
      conversationService.createConversation(BUYER, { product_id: '100' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.PRODUCT_OFF_SHELF });
    expect(prisma.conversation.create).not.toHaveBeenCalled();
  });

  it('已售商品（sold）无既有会话 → 2002（@ac F12-AC2）', async () => {
    const { prisma, conversationService } = setup();
    prisma.product.findUnique.mockResolvedValue(makeProductRow({ status: ProductStatus.SOLD }));
    prisma.conversation.findUnique.mockResolvedValue(null);

    await expect(
      conversationService.createConversation(BUYER, { product_id: '100' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.PRODUCT_OFF_SHELF });
  });

  it('被对方拉黑 → 3003（查 block 表，任一方向命中即拦截）', async () => {
    const { prisma, conversationService } = setup();
    prisma.product.findUnique.mockResolvedValue(makeProductRow());
    prisma.conversation.findUnique.mockResolvedValue(null);
    prisma.block.findFirst.mockResolvedValue({ id: BigInt(1), blocker_id: SELLER.id, blocked_id: BUYER.id });

    await expect(
      conversationService.createConversation(BUYER, { product_id: '100' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.BLOCKED_BY_PEER });
    expect(prisma.block.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          { blocker_id: BUYER.id, blocked_id: SELLER.id },
          { blocker_id: SELLER.id, blocked_id: BUYER.id },
        ],
      },
    });
    expect(prisma.conversation.create).not.toHaveBeenCalled();
  });

  it('重复会话（buyer_id+seller_id+product_id 唯一）→ 返回已有，reused=true，不新建', async () => {
    const { prisma, conversationService } = setup();
    prisma.product.findUnique.mockResolvedValue(makeProductRow());
    prisma.conversation.findUnique.mockResolvedValue(makeConversationRow());

    const result = await conversationService.createConversation(BUYER, { product_id: '100' });

    expect(result).toEqual({ conversation_id: '500', reused: true });
    expect(prisma.conversation.create).not.toHaveBeenCalled();
  });

  it('商品已下架但存在既有会话 → 仍复用返回（AC2 限定「无既有会话」才拦截）', async () => {
    const { prisma, conversationService } = setup();
    prisma.product.findUnique.mockResolvedValue(makeProductRow({ status: ProductStatus.OFF_SALE }));
    prisma.conversation.findUnique.mockResolvedValue(makeConversationRow());

    const result = await conversationService.createConversation(BUYER, { product_id: '100' });

    expect(result.reused).toBe(true);
    expect(prisma.conversation.create).not.toHaveBeenCalled();
  });

  it('商品不存在 → 2001', async () => {
    const { prisma, conversationService } = setup();
    prisma.product.findUnique.mockResolvedValue(null);

    await expect(
      conversationService.createConversation(BUYER, { product_id: '100' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.PRODUCT_NOT_FOUND });
  });

  it('对自己的商品发起会话 → 9001', async () => {
    const { prisma, conversationService } = setup();
    prisma.product.findUnique.mockResolvedValue(makeProductRow());
    prisma.conversation.findUnique.mockResolvedValue(null);
    prisma.block.findFirst.mockResolvedValue(null);

    await expect(
      conversationService.createConversation(SELLER, { product_id: '100' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.PARAM_VALIDATION_FAILED });
  });

  it('缺 product_id → 9001', async () => {
    const { conversationService } = setup();

    await expect(conversationService.createConversation(BUYER, {})).rejects.toMatchObject({
      code: ERROR_CODES.PARAM_VALIDATION_FAILED,
    });
  });
});

// ---------- 发消息（POST /conversations/:id/messages，@rule CIM-R-04） ----------

describe('MessageService.sendMessage（@ac F12-AC1，@rule CIM-R-04）', () => {
  const happyMock = (prisma: ReturnType<typeof makePrismaMock>) => {
    prisma.conversation.findUnique.mockResolvedValue(makeConversationRow());
    prisma.message.create.mockResolvedValue(makeMessageRow());
    prisma.conversation.update.mockResolvedValue(makeConversationRow());
  };

  it('买家发送成功：事务内写 message + receiver（卖方）未读数+1 + last_message_* 更新', async () => {
    const { prisma, messageService } = setup();
    happyMock(prisma);

    const result = await messageService.sendMessage(BUYER, '500', {
      type: 'text',
      content: '你好，还在吗？',
    });

    expect(result.msg_id).toBe('900');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.message.create).toHaveBeenCalledWith({
      data: {
        conversation_id: CONV_ID,
        sender_id: BUYER.id,
        receiver_id: SELLER.id,
        type: 'text',
        content: '你好，还在吗？',
        image_url: null,
      },
    });
    const updateArg = prisma.conversation.update.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: CONV_ID });
    expect(updateArg.data.seller_unread_count).toEqual({ increment: 1 });
    expect(updateArg.data.last_message_content).toBe('你好，还在吗？');
    expect(updateArg.data.last_message_type).toBe('text');
    expect(updateArg.data.last_message_sender_id).toBe(BUYER.id);
    expect(updateArg.data.last_message_at).toBeInstanceOf(Date);
  });

  it('卖家回复：receiver 为买方 → buyer_unread_count +1', async () => {
    const { prisma, messageService } = setup();
    happyMock(prisma);

    await messageService.sendMessage(SELLER, '500', { type: 'text', content: '在的' });

    const updateArg = prisma.conversation.update.mock.calls[0][0];
    expect(updateArg.data.buyer_unread_count).toEqual({ increment: 1 });
    expect(updateArg.data.seller_unread_count).toBeUndefined();
    expect(prisma.message.create.mock.calls[0][0].data.receiver_id).toBe(BUYER.id);
  });

  it('图片消息：last_message_content 落摘要 [图片]，image_url 写入', async () => {
    const { prisma, messageService } = setup();
    happyMock(prisma);

    await messageService.sendMessage(BUYER, '500', {
      type: 'image',
      image_url: 'https://cdn/x/1.jpg',
    });

    expect(prisma.message.create.mock.calls[0][0].data).toMatchObject({
      type: 'image',
      content: null,
      image_url: 'https://cdn/x/1.jpg',
    });
    expect(prisma.conversation.update.mock.calls[0][0].data.last_message_content).toBe('[图片]');
  });

  it('非会话成员发送 → 1003，不落库', async () => {
    const { prisma, messageService } = setup();
    happyMock(prisma);

    await expect(
      messageService.sendMessage(STRANGER, '500', { type: 'text', content: 'hi' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.PERMISSION_DENIED });
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('会话不存在 → 3001', async () => {
    const { prisma, messageService } = setup();
    prisma.conversation.findUnique.mockResolvedValue(null);

    await expect(
      messageService.sendMessage(BUYER, '500', { type: 'text', content: 'hi' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.CONVERSATION_NOT_FOUND });
  });

  it('文本消息缺 content / 图片消息缺 image_url → 9001', async () => {
    const { messageService } = setup();

    await expect(messageService.sendMessage(BUYER, '500', { type: 'text' })).rejects.toMatchObject({
      code: ERROR_CODES.PARAM_VALIDATION_FAILED,
    });
    await expect(messageService.sendMessage(BUYER, '500', { type: 'image' })).rejects.toMatchObject({
      code: ERROR_CODES.PARAM_VALIDATION_FAILED,
    });
  });
});

// ---------- 消息游标分页（GET /conversations/:id/messages?before_id=&limit=） ----------

describe('MessageService.listMessages（@api §5.2 #26 游标分页）', () => {
  const mockMessages = (prisma: ReturnType<typeof makePrismaMock>, rows: unknown[]) => {
    prisma.conversation.findUnique.mockResolvedValue(makeConversationRow());
    prisma.message.findMany.mockResolvedValue(rows);
  };

  it('按 id 倒序取 limit 条：多取 1 条判定 has_more=true', async () => {
    const { prisma, messageService } = setup();
    const rows = [5, 4, 3].map((i) => makeMessageRow({ id: BigInt(i) }));
    mockMessages(prisma, rows);

    const result = await messageService.listMessages(BUYER, '500', { limit: '2' });

    expect(prisma.message.findMany).toHaveBeenCalledWith({
      where: { conversation_id: CONV_ID },
      orderBy: { id: 'desc' },
      take: 3, // limit+1
    });
    expect(result.has_more).toBe(true);
    expect(result.list.map((m) => m.msg_id)).toEqual(['5', '4']);
  });

  it('不足 limit+1 条 → has_more=false', async () => {
    const { prisma, messageService } = setup();
    mockMessages(prisma, [makeMessageRow({ id: BigInt(2) })]);

    const result = await messageService.listMessages(BUYER, '500', { limit: '20' });

    expect(result.has_more).toBe(false);
    expect(result.list).toHaveLength(1);
  });

  it('before_id 游标：where id < before_id；缺省 limit=20', async () => {
    const { prisma, messageService } = setup();
    mockMessages(prisma, []);

    const result = await messageService.listMessages(SELLER, '500', { before_id: '50' });

    expect(prisma.message.findMany).toHaveBeenCalledWith({
      where: { conversation_id: CONV_ID, id: { lt: BigInt(50) } },
      orderBy: { id: 'desc' },
      take: 21,
    });
    expect(result.list).toEqual([]);
    expect(result.has_more).toBe(false);
  });

  it('消息项字段映射：msg_id/sender_id/type/content/is_read/created_at', async () => {
    const { prisma, messageService } = setup();
    mockMessages(prisma, [makeMessageRow()]);

    const result = await messageService.listMessages(BUYER, '500', {});

    expect(result.list[0]).toMatchObject({
      msg_id: '900',
      sender_id: '1',
      receiver_id: '2',
      type: 'text',
      content: '你好，还在吗？',
      is_read: false,
    });
  });

  it('非会话成员拉取 → 1003', async () => {
    const { prisma, messageService } = setup();
    prisma.conversation.findUnique.mockResolvedValue(makeConversationRow());

    await expect(messageService.listMessages(STRANGER, '500', {})).rejects.toMatchObject({
      code: ERROR_CODES.PERMISSION_DENIED,
    });
  });
});

// ---------- 已读回执（POST /conversations/:id/read） ----------

describe('ConversationService.markRead（@ac F12-AC1 已读回执）', () => {
  it('卖方已读：对方（买方）发的消息批量 is_read=true+read_at，seller_unread_count 清零（同事务）', async () => {
    const { prisma, conversationService } = setup();
    prisma.conversation.findUnique.mockResolvedValue(
      makeConversationRow({ seller_unread_count: 3 }),
    );
    prisma.message.updateMany.mockResolvedValue({ count: 3 });
    prisma.conversation.update.mockResolvedValue(makeConversationRow());

    const result = await conversationService.markRead(SELLER, '500');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const updateManyArg = prisma.message.updateMany.mock.calls[0][0];
    expect(updateManyArg.where).toEqual({
      conversation_id: CONV_ID,
      receiver_id: SELLER.id,
      is_read: false,
    });
    expect(updateManyArg.data.is_read).toBe(true);
    expect(updateManyArg.data.read_at).toBeInstanceOf(Date);
    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: CONV_ID },
      data: { seller_unread_count: 0 },
    });
    expect(result).toEqual({ conversation_id: '500', cleared: 3 });
  });

  it('买方已读：buyer_unread_count 清零', async () => {
    const { prisma, conversationService } = setup();
    prisma.conversation.findUnique.mockResolvedValue(makeConversationRow());
    prisma.message.updateMany.mockResolvedValue({ count: 0 });
    prisma.conversation.update.mockResolvedValue(makeConversationRow());

    await conversationService.markRead(BUYER, '500');

    expect(prisma.message.updateMany.mock.calls[0][0].where.receiver_id).toBe(BUYER.id);
    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: CONV_ID },
      data: { buyer_unread_count: 0 },
    });
  });

  it('非会话成员 → 1003；会话不存在 → 3001', async () => {
    const { prisma, conversationService } = setup();
    prisma.conversation.findUnique.mockResolvedValue(makeConversationRow());

    await expect(conversationService.markRead(STRANGER, '500')).rejects.toMatchObject({
      code: ERROR_CODES.PERMISSION_DENIED,
    });

    prisma.conversation.findUnique.mockResolvedValue(null);
    await expect(conversationService.markRead(BUYER, '500')).rejects.toMatchObject({
      code: ERROR_CODES.CONVERSATION_NOT_FOUND,
    });
  });
});

// ---------- 会话列表（GET /conversations） ----------

describe('ConversationService.listConversations（@api §5.2 #25）', () => {
  it('买方视角：未读数取 buyer_unread_count，peer 为卖方 nickname/identity_type', async () => {
    const { prisma, conversationService } = setup();
    const conv = makeConversationRow({
      buyer_unread_count: 2,
      last_message_content: '在的',
      last_message_type: 'text',
      last_message_sender_id: SELLER.id,
      last_message_at: new Date('2026-10-06T02:00:00.000Z'),
    });
    prisma.conversation.findMany.mockResolvedValue([conv]);
    prisma.user.findMany.mockResolvedValue([
      { id: SELLER.id, nickname: '卖家小张', identity_type: 'student', avatar_url: 'https://cdn/a.jpg' },
    ]);

    const result = await conversationService.listConversations(BUYER);

    expect(prisma.conversation.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { buyer_id: BUYER.id, buyer_deleted: false },
          { seller_id: BUYER.id, seller_deleted: false },
        ],
      },
      orderBy: { last_message_at: 'desc' },
    });
    expect(result.list).toHaveLength(1);
    expect(result.list[0]).toMatchObject({
      conv_id: '500',
      product_id: '100',
      unread: 2,
      peer: { id: '2', nickname: '卖家小张', identity_type: 'student' },
      last_msg: { content: '在的', type: 'text', sender_id: '2' },
    });
  });

  it('卖方视角：同一对话未读数取 seller_unread_count，peer 为买方', async () => {
    const { prisma, conversationService } = setup();
    const conv = makeConversationRow({ seller_unread_count: 5 });
    prisma.conversation.findMany.mockResolvedValue([conv]);
    prisma.user.findMany.mockResolvedValue([
      { id: BUYER.id, nickname: '买家小李', identity_type: 'staff', avatar_url: '' },
    ]);

    const result = await conversationService.listConversations(SELLER);

    expect(result.list[0].unread).toBe(5);
    expect(result.list[0].peer).toMatchObject({ id: '1', nickname: '买家小李', identity_type: 'staff' });
  });

  it('user 表查询为白名单 select（id/nickname/identity_type/avatar_url），peer 缺失兜底空串', async () => {
    const { prisma, conversationService } = setup();
    prisma.conversation.findMany.mockResolvedValue([makeConversationRow()]);
    prisma.user.findMany.mockResolvedValue([]);

    const result = await conversationService.listConversations(BUYER);

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: [SELLER.id] } },
      select: { id: true, nickname: true, identity_type: true, avatar_url: true },
    });
    expect(result.list[0].peer).toEqual({ id: '2', nickname: '', identity_type: '', avatar_url: '' });
    expect(result.list[0].last_msg).toBeNull();
  });

  it('空列表 → list=[] 且不查 user 表', async () => {
    const { prisma, conversationService } = setup();
    prisma.conversation.findMany.mockResolvedValue([]);

    const result = await conversationService.listConversations(BUYER);

    expect(result.list).toEqual([]);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});

// ---------- 校验器与控制器 ----------

describe('chat.validator 纯函数', () => {
  it('parseConversationId：非法 id → 9001', () => {
    expect(parseConversationId('500')).toBe(BigInt(500));
    expect(() => parseConversationId('abc')).toThrow(BusinessError);
    expect(() => parseConversationId('0')).toThrow(BusinessError);
  });

  it('parseCursorQuery：limit 上限钳制 50，非法 before_id → 9001', () => {
    expect(parseCursorQuery({})).toEqual({ beforeId: null, limit: 20 });
    expect(parseCursorQuery({ limit: '100' }).limit).toBe(50);
    expect(() => parseCursorQuery({ before_id: 'x' })).toThrow(BusinessError);
  });

  it('validateSendMessageFields：非法 type / 超长文本 → 9001', () => {
    expect(() => validateSendMessageFields({ type: 'video', content: 'x' })).toThrow(BusinessError);
    expect(() =>
      validateSendMessageFields({ type: 'text', content: 'a'.repeat(2001) }),
    ).toThrow(BusinessError);
    expect(validateSendMessageFields({ type: 'text', content: ' hi ' }).content).toBe('hi');
  });

  it('validateCreateConversationFields：非法 product_id → 9001', () => {
    expect(validateCreateConversationFields({ product_id: '100' }).productId).toBe(BigInt(100));
    expect(() => validateCreateConversationFields({ product_id: '-1' })).toThrow(BusinessError);
  });
});

describe('ChatController 响应包络（§5.1 统一包络）', () => {
  it('POST /conversations：req.user.uid 转 BigInt 上下文，返回 {code:0,data}', async () => {
    const { prisma, controller } = setup();
    prisma.product.findUnique.mockResolvedValue(makeProductRow());
    prisma.conversation.findUnique.mockResolvedValue(null);
    prisma.block.findFirst.mockResolvedValue(null);
    prisma.conversation.create.mockResolvedValue(makeConversationRow());

    const res = await controller.create({ product_id: '100' }, { user: { uid: '1' } });

    expect(res.code).toBe(0);
    expect(res.message).toBe('ok');
    expect(res.data.conversation_id).toBe('500');
  });

  it('POST /conversations/:id/messages：返回 {code:0,data.msg_id}', async () => {
    const { prisma, controller } = setup();
    prisma.conversation.findUnique.mockResolvedValue(makeConversationRow());
    prisma.message.create.mockResolvedValue(makeMessageRow());
    prisma.conversation.update.mockResolvedValue(makeConversationRow());

    const res = await controller.sendMessage('500', { type: 'text', content: 'hi' }, { user: { uid: '1' } });

    expect(res.code).toBe(0);
    expect(res.data.msg_id).toBe('900');
  });

  it('GET /conversations/:id/messages 与 POST /conversations/:id/read、GET /conversations 均包络返回', async () => {
    const { prisma, controller } = setup();
    prisma.conversation.findUnique.mockResolvedValue(makeConversationRow());
    prisma.message.findMany.mockResolvedValue([]);
    prisma.message.updateMany.mockResolvedValue({ count: 0 });
    prisma.conversation.update.mockResolvedValue(makeConversationRow());
    prisma.conversation.findMany.mockResolvedValue([]);

    const msgs = await controller.listMessages('500', {}, { user: { uid: '1' } });
    const read = await controller.markRead('500', { user: { uid: '1' } });
    const list = await controller.list({ user: { uid: '1' } });

    expect(msgs.code).toBe(0);
    expect(read.code).toBe(0);
    expect(list.code).toBe(0);
    expect(list.data.list).toEqual([]);
  });
});
