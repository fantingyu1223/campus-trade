/**
 * risk-word.spec.ts —— T-204 聊天风险词警示（发送链路风控 + 留痕）
 *
 * @module PIM-BC-03 沟通与协商
 * @model PIM-AG-05 会话与消息聚合（RiskWordHit）
 * @rule CIM-R-32 命中风险词未确认 → 3002 不落库；确认放行 → 每次命中写 message_risk_log
 * @rule CIM-R-10 风控留痕字段固定，不得裁剪
 * @table message_risk_log/word_list → PIM-AG-05
 * @api §5.2 #27 POST /conversations/:id/messages（confirm_risk）
 * @ac F13-AC1 命中风险词发送侧弹警示、可确认继续发送（留痕）/ F13-AC3 常驻安全提示（词表冻结快照）
 *
 * 覆盖验收点：
 *  - WordSnapshot：findHits 命中/未命中/多词/空文本；RISK_WORDS 冻结
 *  - RiskWordService.evaluate：命中未确认 → BusinessError(3002, {hits})；确认 → 放行返回 hits；未命中 → []
 *  - MessageService.sendMessage 接入：3002 不落库不留痕；confirm_risk=true 落库 + 每词一条
 *    message_risk_log（conversation_id/sender_id/receiver_id/hit_word/content_snapshot 五字段
 *    + message_id/level/action）；未命中正常发送不留痕
 *
 * 无真实 MySQL：PrismaService 一律 jest mock（同 conversation-message.spec.ts 口径）。
 */
import { ERROR_CODES } from '@contract/index';
import { MessageService } from '../../src/modules/chat/message.service';
import { RiskWordService } from '../../src/modules/chat/risk-word.service';
import { RISK_WORDS, WordSnapshot } from '../../src/modules/chat/infra-snapshot/word-snapshot';
import { ChatRepository } from '../../src/modules/chat/chat.repository';
import { BusinessError } from '../../src/modules/chat/conversation.service';
import { ChatController } from '../../src/modules/chat/chat.controller';
import { ConversationService } from '../../src/modules/chat/conversation.service';
import { PrismaService } from '../../src/infra/prisma.service';

// ---------- 测试夹具 ----------

const BUYER = { id: BigInt(1) };
const SELLER = { id: BigInt(2) };
const CONV_ID = BigInt(500);

const makeConversationRow = (over: Record<string, unknown> = {}) => ({
  id: CONV_ID,
  buyer_id: BUYER.id,
  seller_id: SELLER.id,
  product_id: BigInt(100),
  buyer_unread_count: 0,
  seller_unread_count: 0,
  buyer_deleted: false,
  seller_deleted: false,
  ...over,
});

const makeMessageRow = (over: Record<string, unknown> = {}) => ({
  id: BigInt(900),
  conversation_id: CONV_ID,
  sender_id: BUYER.id,
  receiver_id: SELLER.id,
  type: 'text',
  content: '你好',
  image_url: null,
  is_read: false,
  read_at: null,
  created_at: new Date('2026-10-06T01:00:00.000Z'),
  ...over,
});

const makePrismaMock = () =>
  ({
    conversation: { findUnique: jest.fn(), update: jest.fn() },
    message: { create: jest.fn() },
    messageRiskLog: { create: jest.fn() },
    $transaction: jest.fn(),
  }) as unknown as PrismaService & {
    conversation: { findUnique: jest.Mock; update: jest.Mock };
    message: { create: jest.Mock };
    messageRiskLog: { create: jest.Mock };
    $transaction: jest.Mock;
  };

const setup = () => {
  const prisma = makePrismaMock();
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
  const repo = new ChatRepository(prisma);
  const riskWord = new RiskWordService(prisma);
  const messageService = new MessageService(repo, riskWord);
  const conversationService = new ConversationService(repo);
  const controller = new ChatController(conversationService, messageService);
  return { prisma, repo, riskWord, messageService, controller };
};

const happyMock = (prisma: ReturnType<typeof makePrismaMock>) => {
  prisma.conversation.findUnique.mockResolvedValue(makeConversationRow());
  prisma.message.create.mockResolvedValue(makeMessageRow());
  prisma.conversation.update.mockResolvedValue(makeConversationRow());
  prisma.messageRiskLog.create.mockResolvedValue({ id: BigInt(1) });
};

// ---------- WordSnapshot 词快照单测 ----------

describe('WordSnapshot（chat 模块自含词快照，@table word_list → PIM-AG-05）', () => {
  it('RISK_WORDS：冻结数组，8-10 个风险词（@ac F13-AC3 常驻提示词表口径）', () => {
    expect(Object.isFrozen(RISK_WORDS)).toBe(true);
    expect(RISK_WORDS.length).toBeGreaterThanOrEqual(8);
    expect(RISK_WORDS.length).toBeLessThanOrEqual(10);
    expect(RISK_WORDS).toEqual(
      expect.arrayContaining(['先转账', '先打款', '加微信', '保证金', '押金', '解冻费', '代付', '扫码付款']),
    );
  });

  it('findHits：命中单个词返回该词', () => {
    const snapshot = new WordSnapshot();
    expect(snapshot.findHits('请先转账再发货')).toEqual(['先转账']);
  });

  it('findHits：多词命中返回全部命中词', () => {
    const snapshot = new WordSnapshot();
    const hits = snapshot.findHits('先转账并交保证金，扫码付款也行');
    expect(hits).toEqual(expect.arrayContaining(['先转账', '保证金', '扫码付款']));
    expect(hits).toHaveLength(3);
  });

  it('findHits：未命中返回空数组；null/空串安全', () => {
    const snapshot = new WordSnapshot();
    expect(snapshot.findHits('你好，还在吗？')).toEqual([]);
    expect(snapshot.findHits('')).toEqual([]);
    expect(snapshot.findHits(null)).toEqual([]);
    expect(snapshot.findHits(undefined)).toEqual([]);
  });

  it('findHits：自定义词表可注入（运行期词库快照隔离）', () => {
    const snapshot = new WordSnapshot(['测试词']);
    expect(snapshot.findHits('这是测试词命中')).toEqual(['测试词']);
    expect(snapshot.findHits('先转账')).toEqual([]);
  });
});

// ---------- RiskWordService.evaluate ----------

describe('RiskWordService.evaluate（@rule CIM-R-32）', () => {
  it('命中且 confirm_risk!==true → 抛 BusinessError(3002)，details.hits 带命中词列表', () => {
    const { riskWord } = setup();
    try {
      riskWord.evaluate('需要先交保证金', false);
      fail('应抛出 3002');
    } catch (e) {
      const err = e as BusinessError;
      expect(err).toBeInstanceOf(BusinessError);
      expect(err.code).toBe(ERROR_CODES.RISK_WORD_HIT);
      expect(err.code).toBe(3002);
      expect(err.details).toEqual({ hits: ['保证金'] });
    }
  });

  it('命中且 confirm_risk===true → 放行，返回 hits 列表', () => {
    const { riskWord } = setup();
    expect(riskWord.evaluate('先转账吧', true)).toEqual(['先转账']);
  });

  it('未命中 → 返回空数组（confirm_risk 任意）', () => {
    const { riskWord } = setup();
    expect(riskWord.evaluate('正常聊天内容', false)).toEqual([]);
    expect(riskWord.evaluate('正常聊天内容', true)).toEqual([]);
  });

  it('图片消息 content=null → 不评估词表，返回空数组', () => {
    const { riskWord } = setup();
    expect(riskWord.evaluate(null, false)).toEqual([]);
  });
});

// ---------- sendMessage 发送链路接入（@api §5.2 #27，@ac F13-AC1） ----------

describe('MessageService.sendMessage 风控接入（@rule CIM-R-32/R-10）', () => {
  it('命中未确认 → 3002 带 hits，消息不落库、不留痕', async () => {
    const { prisma, messageService } = setup();
    happyMock(prisma);

    await expect(
      messageService.sendMessage(BUYER, '500', { type: 'text', content: '先转账再发货' }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.RISK_WORD_HIT,
      details: { hits: ['先转账'] },
    });

    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.messageRiskLog.create).not.toHaveBeenCalled();
  });

  it('命中 confirm_risk=true → 消息落库，message_risk_log 写五字段（@table message_risk_log）', async () => {
    const { prisma, messageService } = setup();
    happyMock(prisma);

    const result = await messageService.sendMessage(BUYER, '500', {
      type: 'text',
      content: '需要交保证金',
      confirm_risk: true,
    });

    expect(result.msg_id).toBe('900');
    expect(prisma.message.create).toHaveBeenCalledTimes(1);
    expect(prisma.messageRiskLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.messageRiskLog.create).toHaveBeenCalledWith({
      data: {
        conversation_id: CONV_ID,
        message_id: BigInt(900),
        sender_id: BUYER.id,
        receiver_id: SELLER.id,
        hit_word: '保证金',
        content_snapshot: '需要交保证金',
        level: 'mid',
        action: 'warned',
      },
    });
  });

  it('多词命中 → 每个命中词各写一条 log（多词多 log）', async () => {
    const { prisma, messageService } = setup();
    happyMock(prisma);

    await messageService.sendMessage(BUYER, '500', {
      type: 'text',
      content: '先转账并交押金',
      confirm_risk: true,
    });

    expect(prisma.message.create).toHaveBeenCalledTimes(1);
    expect(prisma.messageRiskLog.create).toHaveBeenCalledTimes(2);
    const hitWords = prisma.messageRiskLog.create.mock.calls.map(
      (c) => (c[0] as { data: { hit_word: string } }).data.hit_word,
    );
    expect(hitWords).toEqual(expect.arrayContaining(['先转账', '押金']));
    // 每条 log 均含五字段 + message_id
    for (const call of prisma.messageRiskLog.create.mock.calls) {
      const data = (call[0] as { data: Record<string, unknown> }).data;
      expect(data.conversation_id).toBe(CONV_ID);
      expect(data.sender_id).toBe(BUYER.id);
      expect(data.receiver_id).toBe(SELLER.id);
      expect(data.content_snapshot).toBe('先转账并交押金');
      expect(data.message_id).toBe(BigInt(900));
    }
  });

  it('未命中 → 正常发送，不留痕', async () => {
    const { prisma, messageService } = setup();
    happyMock(prisma);

    const result = await messageService.sendMessage(BUYER, '500', {
      type: 'text',
      content: '你好，还在吗？',
    });

    expect(result.msg_id).toBe('900');
    expect(prisma.message.create).toHaveBeenCalledTimes(1);
    expect(prisma.messageRiskLog.create).not.toHaveBeenCalled();
  });

  it('卖家侧命中确认放行：receiver_id 为买方（留痕方向正确）', async () => {
    const { prisma, messageService } = setup();
    happyMock(prisma);
    prisma.message.create.mockResolvedValue(
      makeMessageRow({ sender_id: SELLER.id, receiver_id: BUYER.id }),
    );

    await messageService.sendMessage(SELLER, '500', {
      type: 'text',
      content: '请代付一下',
      confirm_risk: true,
    });

    expect(prisma.messageRiskLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sender_id: SELLER.id,
        receiver_id: BUYER.id,
        hit_word: '代付',
      }),
    });
  });

  it('图片消息（无文本内容）→ 不触发词表评估，正常发送不留痕', async () => {
    const { prisma, messageService } = setup();
    happyMock(prisma);
    prisma.message.create.mockResolvedValue(
      makeMessageRow({ type: 'image', content: null, image_url: 'https://cdn/x/1.jpg' }),
    );

    await messageService.sendMessage(BUYER, '500', {
      type: 'image',
      image_url: 'https://cdn/x/1.jpg',
    });

    expect(prisma.message.create).toHaveBeenCalledTimes(1);
    expect(prisma.messageRiskLog.create).not.toHaveBeenCalled();
  });

  it('confirm_risk 传非 true 值（字符串"true"/1）→ 仍按未确认处理（3002）', async () => {
    const { prisma, messageService } = setup();
    happyMock(prisma);

    await expect(
      messageService.sendMessage(BUYER, '500', {
        type: 'text',
        content: '解冻费多少',
        confirm_risk: 'true',
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.RISK_WORD_HIT });
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('controller 无需改：3002 由 service 冒泡（BusinessError 穿透控制器）', async () => {
    const { prisma, controller } = setup();
    happyMock(prisma);

    await expect(
      controller.sendMessage(
        '500',
        { type: 'text', content: '加微信详聊' },
        { user: { uid: '1' } },
      ),
    ).rejects.toMatchObject({
      code: ERROR_CODES.RISK_WORD_HIT,
      details: { hits: ['加微信'] },
    });
  });
});
