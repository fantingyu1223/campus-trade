/**
 * message.service.ts —— 消息应用服务（发消息 / 游标分页拉取）
 *
 * @module PIM-BC-03 沟通与协商
 * @model PIM-AG-05 会话与消息聚合
 * @api §5.2 #26 GET /conversations/:id/messages + #27 POST /conversations/:id/messages
 * @ac F12-AC1 发消息接收方未读+1 / @rule CIM-R-04 事务写 message + conversation 未读数+1+last_message_*
 * @ac F13-AC1 / @rule CIM-R-32 风险词评估在事务写消息前：命中未确认 → 3002 不落库；
 *      确认放行 → 落库后写 message_risk_log 留痕（@rule CIM-R-10）
 *
 * 规则落点：
 *  - sendMessage：字段校验(9001) → 会话存在(3001) → 成员断言(1003)
 *    → 风险词评估（CIM-R-32，命中未确认抛 3002 带 hits 由 controller 冒泡）
 *    → 事务内写 message + 接收方未读数+1 + last_message_*（图片消息摘要落 [图片]）
 *    → 命中且已确认时按词写 message_risk_log（level=mid/action=warned）
 *  - listMessages：游标 before_id（id 倒序），多取 1 条判定 has_more
 */
import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@contract/index';
import { ChatRepository, UnreadField } from './chat.repository';
import { BusinessError, ChatUserContext } from './conversation.service';
import { RiskWordService } from './risk-word.service';
import {
  assertConversationMember,
  parseConversationId,
  parseCursorQuery,
  validateSendMessageFields,
} from './chat.validator';
import type { MessageItem, MessageListResult, SendMessageResult } from './dto/message.dto';

@Injectable()
export class MessageService {
  constructor(
    private readonly repo: ChatRepository,
    private readonly riskWord: RiskWordService,
  ) {}

  /**
   * 发消息（@rule CIM-R-04）：接收方为会话另一方，未读数按接收方身份 +1；
   * 图片消息 last_message_content 落摘要 [图片]。
   * 风控接入（@rule CIM-R-32，@ac F13-AC1）：事务写消息前评估风险词——
   * 命中且 confirm_risk!==true 抛 BusinessError(3002, {hits})（消息不落库不留痕）；
   * 命中且已确认则落库后逐词写 message_risk_log（@rule CIM-R-10 五字段不裁剪）。
   */
  async sendMessage(
    user: ChatUserContext,
    conversationIdRaw: unknown,
    raw: unknown,
  ): Promise<SendMessageResult> {
    const fields = validateSendMessageFields(raw);
    const conversationId = parseConversationId(conversationIdRaw);

    const conversation = await this.repo.findConversationById(conversationId);
    if (!conversation) {
      throw new BusinessError(ERROR_CODES.CONVERSATION_NOT_FOUND, '会话不存在');
    }
    assertConversationMember(conversation, user.id);

    const receiverId = conversation.buyer_id === user.id ? conversation.seller_id : conversation.buyer_id;
    const unreadField: UnreadField =
      receiverId === conversation.seller_id ? 'seller_unread_count' : 'buyer_unread_count';

    // @rule CIM-R-32：事务写消息前评估；confirm_risk 严格 ===true 才视为已确认
    const confirmRisk = ((raw ?? {}) as Record<string, unknown>).confirm_risk === true;
    const hits = this.riskWord.evaluate(fields.content, confirmRisk);

    const msg = await this.repo.createMessageTouchConversation({
      conversationId,
      message: {
        conversation_id: conversationId,
        sender_id: user.id,
        receiver_id: receiverId,
        type: fields.type,
        content: fields.content,
        image_url: fields.imageUrl,
      },
      unreadField,
      lastMessageContent: fields.type === 'image' ? '[图片]' : (fields.content as string),
      lastMessageType: fields.type,
      lastMessageSenderId: user.id,
    });

    // 命中且确认放行：逐词留痕（message_id 关联已落库消息，schema message_id NOT NULL）
    if (hits.length > 0) {
      await this.riskWord.logHits({
        conversationId,
        messageId: msg.id,
        senderId: user.id,
        receiverId,
        content: fields.content as string,
        hits,
      });
    }

    return { msg_id: msg.id.toString(), created_at: msg.created_at.toISOString() };
  }

  /**
   * 消息游标分页（@api §5.2 #26）：id 倒序取 limit+1 条，
   * 命中第 limit+1 条即 has_more=true 并截断返回前 limit 条。
   */
  async listMessages(
    user: ChatUserContext,
    conversationIdRaw: unknown,
    query: unknown,
  ): Promise<MessageListResult> {
    const conversationId = parseConversationId(conversationIdRaw);
    const conversation = await this.repo.findConversationById(conversationId);
    if (!conversation) {
      throw new BusinessError(ERROR_CODES.CONVERSATION_NOT_FOUND, '会话不存在');
    }
    assertConversationMember(conversation, user.id);

    const { beforeId, limit } = parseCursorQuery(query);
    const rows = await this.repo.findMessagesPage(conversationId, beforeId, limit + 1);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return {
      has_more: hasMore,
      list: page.map(
        (m): MessageItem => ({
          msg_id: m.id.toString(),
          sender_id: m.sender_id.toString(),
          receiver_id: m.receiver_id.toString(),
          type: m.type,
          content: m.content,
          image_url: m.image_url,
          is_read: m.is_read,
          read_at: m.read_at ? m.read_at.toISOString() : null,
          created_at: m.created_at.toISOString(),
        }),
      ),
    };
  }
}
