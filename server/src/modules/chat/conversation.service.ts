/**
 * conversation.service.ts —— 会话应用服务（发起会话 / 已读回执 / 会话列表）
 *
 * @module PIM-BC-03 沟通与协商
 * @model PIM-AG-05 会话与消息聚合
 * @api §5.2 #25 GET /conversations + POST /conversations + POST /conversations/:id/read
 * @ac F12-AC1 已读回执 / F12-AC2 已下架·已售商品无既有会话拦截（2002）
 *
 * 规则落点：
 *  - 发起会话编排：字段校验(9001) → 商品存在(2001) → 既有会话复用(reused=true)
 *    → 非 on_sale 且无既有会话(2002) → 双向拉黑(3003) → 禁止自聊(9001) → 创建
 *  - 已读回执：非成员 1003 / 会话不存在 3001；事务内置已读+未读清零（CIM-R-04）
 *  - 会话列表：双方视角未读数 / peer 白名单字段 / last_message_at 倒序
 */
import { Injectable } from '@nestjs/common';
import { ERROR_CODES, ProductStatus } from '@contract/index';
import { ChatRepository, UnreadField } from './chat.repository';
import {
  assertConversationMember,
  parseConversationId,
  validateCreateConversationFields,
} from './chat.validator';
import type {
  ConversationListResult,
  CreateConversationResult,
  MarkReadResult,
} from './dto/message.dto';

/** 业务错误：code/message/details，由全局过滤器统一包装为响应包络 */
export class BusinessError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'BusinessError';
  }
}

/** 认证用户上下文（控制器由 req.user.uid 转换而来） */
export interface ChatUserContext {
  id: bigint;
}

@Injectable()
export class ConversationService {
  constructor(private readonly repo: ChatRepository) {}

  /**
   * 发起会话（@ac F12-AC2）：
   * 既有会话（uk_pair_product）一律复用优先返回 reused=true——
   * 复用优先于商品状态拦截，故已下架商品存在既有会话时仍可继续沟通。
   */
  async createConversation(
    user: ChatUserContext,
    raw: unknown,
  ): Promise<CreateConversationResult> {
    const { productId } = validateCreateConversationFields(raw);

    const product = await this.repo.findProductById(productId);
    if (!product) {
      throw new BusinessError(ERROR_CODES.PRODUCT_NOT_FOUND, '商品不存在');
    }
    const sellerId = product.seller_id as bigint;

    // 重复会话复用优先：命中 uk_pair_product 直接返回，不再校验状态/拉黑
    const existing = await this.repo.findConversationByPair(user.id, sellerId, productId);
    if (existing) {
      return { conversation_id: existing.id.toString(), reused: true };
    }

    // 无既有会话时，仅 on_sale 商品允许发起（已下架/已售 → 2002）
    if ((product.status as string) !== ProductStatus.ON_SALE) {
      throw new BusinessError(ERROR_CODES.PRODUCT_OFF_SHELF, '商品已下架或已售，无法发起会话');
    }

    // 双向拉黑拦截：任一方向命中即 3003
    const blocked = await this.repo.findBlockBetween(user.id, sellerId);
    if (blocked) {
      throw new BusinessError(ERROR_CODES.BLOCKED_BY_PEER, '无法与对方发起会话');
    }

    // 禁止对自己的商品发起会话
    if (sellerId === user.id) {
      throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, '不能对自己的商品发起会话');
    }

    const created = await this.repo.createConversation({
      buyer_id: user.id,
      seller_id: sellerId,
      product_id: productId,
    });
    return { conversation_id: created.id.toString(), reused: false };
  }

  /**
   * 已读回执（@ac F12-AC1）：会话不存在 3001 / 非成员 1003；
   * 事务内将对方发给本人的未读消息批量置 is_read=true+read_at，本人侧未读数清零。
   */
  async markRead(user: ChatUserContext, conversationIdRaw: unknown): Promise<MarkReadResult> {
    const conversationId = parseConversationId(conversationIdRaw);
    const conversation = await this.repo.findConversationById(conversationId);
    if (!conversation) {
      throw new BusinessError(ERROR_CODES.CONVERSATION_NOT_FOUND, '会话不存在');
    }
    assertConversationMember(conversation, user.id);

    const unreadField: UnreadField =
      conversation.buyer_id === user.id ? 'buyer_unread_count' : 'seller_unread_count';
    const cleared = await this.repo.markReadAndResetUnread(conversationId, user.id, unreadField);
    return { conversation_id: conversationId.toString(), cleared };
  }

  /**
   * 会话列表（@api §5.2 #25）：买卖双方双视角。
   * 未读数按本人身份取 buyer/seller_unread_count；peer 为对方公开档案白名单字段；
   * 无消息会话 last_msg=null；peer 档案缺失时白名单字段兜底空串。
   */
  async listConversations(user: ChatUserContext): Promise<ConversationListResult> {
    const conversations = await this.repo.findConversationsByUser(user.id);
    if (conversations.length === 0) {
      return { list: [] };
    }

    const peerIds = conversations.map((c) =>
      c.buyer_id === user.id ? c.seller_id : c.buyer_id,
    );
    const peers = await this.repo.findUsersPublicByIds(peerIds);
    const peerMap = new Map(peers.map((p) => [p.id.toString(), p]));

    return {
      list: conversations.map((c) => {
        const isBuyer = c.buyer_id === user.id;
        const peerId = isBuyer ? c.seller_id : c.buyer_id;
        const peerRow = peerMap.get(peerId.toString());
        const hasLastMessage = c.last_message_at !== null;
        return {
          conv_id: c.id.toString(),
          product_id: c.product_id.toString(),
          peer: {
            id: peerId.toString(),
            nickname: peerRow?.nickname ?? '',
            identity_type: peerRow?.identity_type ?? '',
            avatar_url: peerRow?.avatar_url ?? '',
          },
          unread: isBuyer ? c.buyer_unread_count : c.seller_unread_count,
          last_msg: hasLastMessage
            ? {
                content: c.last_message_content,
                type: c.last_message_type,
                sender_id: c.last_message_sender_id?.toString() ?? null,
                at: c.last_message_at?.toISOString() ?? null,
              }
            : null,
        };
      }),
    };
  }
}
