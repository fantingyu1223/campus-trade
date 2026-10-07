/**
 * intent.service.ts —— 交易意向卡片应用服务（发起 / 响应）
 *
 * @module PIM-BC-03 沟通与协商
 * @model PIM-AG-05 交易意向卡片聚合（TradeIntentCard）
 * @rule CIM-R-14 同一 conversation+product 可多次发起，裁决以最后一条 confirmed 记录为准
 * @table trade_intent → PIM-AG-05
 * @api §5.2 #28 POST /conversations/:id/intents + #29 POST /intents/:id/respond
 * @ac F14-AC1 双方确认后卡片置「双方已确认」并留痕；任一方未确认前为待确认
 *
 * 规则落点：
 *  - 发起：字段校验(9001) → 会话存在(3001) → 会话成员(1003) → 落库 status=pending
 *    （trade_mode 本批固定 offline_meet，与订单通道基线口径一致）
 *  - 响应：action 校验(9001) → 意向存在(3001) → 会话成员(1003) → 非发起者本人(1003)
 *    → status=pending(否则 3004) → accept 记录本方 confirmed_at，双方齐备才置 confirmed
 *    → reject 直接置 cancelled
 *  - confirmed 时按 CIM-R-14 查询同会话同商品最新一条 confirmed 记录作为订单引用；
 *    订单生成走 order 模块契约接口（跨模块纪律禁直调，此处仅占位注释 + 事件标注）。
 *
 * 自定口径（契约未显式覆盖，待评审追认）：
 *  - 意向卡片不存在 → 3001（归入沟通段「不存在」语义，复用 CONVERSATION_NOT_FOUND 码值）
 *  - 发起者自己响应 → 1003（契约 #29「仅会话对方可响应」的权限语义）
 */
import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@contract/index';
import { PrismaService } from '@infra/prisma.service';
import { BusinessError, ChatUserContext } from './conversation.service';
import { assertConversationMember, parseConversationId } from './chat.validator';
import type {
  CreateIntentResult,
  IntentRespondAction,
  RespondIntentResult,
} from './dto/intent.dto';

/** 约定地点最大长度（trade_intent.meet_location VARCHAR(255)） */
const MAX_LOCATION_LENGTH = 255;

/** 发起意向卡片字段（@api §5.2 #28 请求关键字段） */
interface CreateIntentFields {
  productId: bigint;
  /** Decimal(10,2) 以定点字符串落库 */
  amount: string;
  meetLocation: string;
  meetTime: Date;
}

@Injectable()
export class IntentService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 发起意向卡片（@api §5.2 #28，@ac F14-AC1）：
   * 仅会话成员可发起；初始 status=pending，等待对方响应。
   */
  async createIntent(
    user: ChatUserContext,
    conversationIdRaw: unknown,
    raw: unknown,
  ): Promise<CreateIntentResult> {
    const conversationId = parseConversationId(conversationIdRaw);
    const fields = this.validateCreateFields(raw);

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) {
      throw new BusinessError(ERROR_CODES.CONVERSATION_NOT_FOUND, '会话不存在');
    }
    assertConversationMember(conversation, user.id);

    const created = await this.prisma.tradeIntent.create({
      data: {
        conversation_id: conversationId,
        product_id: fields.productId,
        initiator_id: user.id,
        // 契约 #28 未携带 trade_mode：本批固定 offline_meet（与订单通道基线口径一致）
        trade_mode: 'offline_meet',
        amount: fields.amount,
        meet_location: fields.meetLocation,
        meet_time: fields.meetTime,
        status: 'pending',
      },
    });
    return { intent_id: created.id.toString(), status: 'pending' };
  }

  /**
   * 响应意向卡片（@api §5.2 #29，@ac F14-AC1）：
   * 仅会话对方可响应（发起者本人 → 1003，自定口径）；仅 pending 可响应（否则 3004）。
   * accept：按响应方身份记录 buyer/seller_confirmed_at；双方 confirmed_at 均非空才置 confirmed。
   * reject：直接置 cancelled。
   */
  async respond(
    user: ChatUserContext,
    intentIdRaw: unknown,
    raw: unknown,
  ): Promise<RespondIntentResult> {
    const intentId = parseConversationId(intentIdRaw);
    const action = this.validateAction(raw);

    const intent = await this.prisma.tradeIntent.findUnique({ where: { id: intentId } });
    if (!intent) {
      // 自定口径：意向不存在归入沟通段「不存在」语义（3001），待评审追认
      throw new BusinessError(ERROR_CODES.CONVERSATION_NOT_FOUND, '意向卡片不存在');
    }
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: intent.conversation_id },
    });
    if (!conversation) {
      throw new BusinessError(ERROR_CODES.CONVERSATION_NOT_FOUND, '会话不存在');
    }

    assertConversationMember(conversation, user.id);

    // 按响应方在会话中的身份定位本方/对方 confirmed_at
    const isBuyerResponder = conversation.buyer_id === user.id;
    const confirmField = isBuyerResponder ? 'buyer_confirmed_at' : 'seller_confirmed_at';
    const peerConfirmedAt = isBuyerResponder
      ? intent.seller_confirmed_at
      : intent.buyer_confirmed_at;

    // 自定口径：契约 #29「仅会话对方可响应」——对方尚未确认时，发起者本人无权响应自己的卡片 → 1003；
    // 对方已确认（其 confirmed_at 非空）后，发起者可补确认完成双方确认（@ac F14-AC1）
    const isInitiator = intent.initiator_id === user.id;
    if (isInitiator && (peerConfirmedAt === null || peerConfirmedAt === undefined)) {
      throw new BusinessError(ERROR_CODES.PERMISSION_DENIED, '发起者不能响应自己的意向卡片');
    }
    if ((intent.status as string) !== 'pending') {
      throw new BusinessError(ERROR_CODES.INTENT_STATUS_CONFLICT, '意向卡片状态冲突，不可响应');
    }

    if (action === 'reject') {
      await this.prisma.tradeIntent.update({
        where: { id: intentId },
        data: { status: 'cancelled' },
      });
      return { status: 'cancelled', order_id: null };
    }
    const bothConfirmed = peerConfirmedAt !== null && peerConfirmedAt !== undefined;

    await this.prisma.tradeIntent.update({
      where: { id: intentId },
      data: {
        [confirmField]: new Date(),
        // @ac F14-AC1：双方 confirmed_at 均非空才可置 confirmed
        ...(bothConfirmed ? { status: 'confirmed' as const } : {}),
      },
    });

    if (!bothConfirmed) {
      // 单方已确认留痕，卡片仍为待确认（@ac F14-AC1）
      return { status: 'pending', order_id: null };
    }

    /**
     * @rule CIM-R-14（裁决#2）：同一 conversation+product 可多次发起，
     * 生成订单时以最后一条 confirmed 记录为准——此处按时间倒序取最新一条作为引用。
     */
    const latestConfirmed = await this.prisma.tradeIntent.findFirst({
      where: {
        conversation_id: intent.conversation_id,
        product_id: intent.product_id,
        status: 'confirmed',
      },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    });

    /**
     * CONTRACT-CALL(order)：调用 order 模块契约接口 createOrderFromIntent，
     * 入参引用最新 confirmed 意向 id（latestConfirmed.id，CIM-R-14 裁决结果），
     * 生成订单并回填 order_id 至本接口响应。
     * 跨模块纪律：chat 不直调 order 实现，本批次仅以契约占位注释声明、不实际调用。
     *
     * @event PIM-EV-01（触发源）：TradeIntentConfirmed 事件由本处触发，
     * 订单创建/通知触达（F15）作为该事件的下游订阅方接入。
     */
    void latestConfirmed;
    return { status: 'confirmed', order_id: null };
  }

  /** 发起字段校验：product_id 正整数 / price 正数（≤2 位小数口径由定点串保证）/ meet_location 非空 ≤255 / meet_time 合法时间 */
  private validateCreateFields(raw: unknown): CreateIntentFields {
    const body = (raw ?? {}) as Record<string, unknown>;

    const productRaw = body.product_id;
    if (typeof productRaw !== 'string' || !/^[1-9]\d*$/.test(productRaw.trim())) {
      throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, '字段 product_id 必须为正整数字符串');
    }

    const priceRaw = typeof body.price === 'number' ? String(body.price) : body.price;
    if (typeof priceRaw !== 'string' || !/^\d+(\.\d{1,2})?$/.test(priceRaw.trim())) {
      throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, '字段 price 必须为正数（至多两位小数）');
    }
    const amount = Number(priceRaw.trim());
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, '字段 price 必须为正数');
    }

    const meetLocation = typeof body.meet_location === 'string' ? body.meet_location.trim() : '';
    if (!meetLocation || meetLocation.length > MAX_LOCATION_LENGTH) {
      throw new BusinessError(
        ERROR_CODES.PARAM_VALIDATION_FAILED,
        `字段 meet_location 必填且长度不超过 ${MAX_LOCATION_LENGTH}`,
      );
    }

    const meetTime = new Date(typeof body.meet_time === 'string' ? body.meet_time : '');
    if (Number.isNaN(meetTime.getTime())) {
      throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, '字段 meet_time 必须为合法时间');
    }

    return {
      productId: BigInt(productRaw.trim()),
      amount: amount.toFixed(2),
      meetLocation,
      meetTime,
    };
  }

  /** 响应动作校验：仅 accept/reject（@api §5.2 #29） */
  private validateAction(raw: unknown): IntentRespondAction {
    const action = ((raw ?? {}) as Record<string, unknown>).action;
    if (action !== 'accept' && action !== 'reject') {
      throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, '字段 action 仅支持 accept/reject');
    }
    return action;
  }
}
