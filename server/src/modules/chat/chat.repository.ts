/**
 * chat.repository.ts —— 聊天模块自含数据访问
 *
 * @table conversation/message/block/product/user → PIM-AG-05 会话与消息聚合
 * @module PIM-BC-03 沟通与协商
 *
 * 事务纪律（@rule CIM-R-04）：
 *  - createMessageTouchConversation：同一 $transaction 写 message + 会话未读数/last_message_*
 *  - markReadAndResetUnread：同一 $transaction 批量置已读 + 本人未读数清零
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infra/prisma.service';

/** 未读数字段名（按接收方身份二选一） */
export type UnreadField = 'buyer_unread_count' | 'seller_unread_count';

/** 发消息事务入参 */
export interface CreateMessageTouchInput {
  conversationId: bigint;
  message: Prisma.MessageUncheckedCreateInput;
  unreadField: UnreadField;
  lastMessageContent: string;
  lastMessageType: 'text' | 'image';
  lastMessageSenderId: bigint;
}

@Injectable()
export class ChatRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 按主键查商品（发起会话前置读取：存在性 + 状态 + 卖家） */
  findProductById(id: bigint) {
    return this.prisma.product.findUnique({ where: { id } });
  }

  /** 双向拉黑命中查询：任一方向存在记录即视为拉黑 */
  findBlockBetween(a: bigint, b: bigint) {
    return this.prisma.block.findFirst({
      where: {
        OR: [
          { blocker_id: a, blocked_id: b },
          { blocker_id: b, blocked_id: a },
        ],
      },
    });
  }

  /** uk_pair_product 唯一键查既有会话（重复发起复用判定） */
  findConversationByPair(buyerId: bigint, sellerId: bigint, productId: bigint) {
    return this.prisma.conversation.findUnique({
      where: {
        buyer_id_seller_id_product_id: {
          buyer_id: buyerId,
          seller_id: sellerId,
          product_id: productId,
        },
      },
    });
  }

  /** 创建会话（买方发起，落 buyer_id+seller_id+product_id） */
  createConversation(data: { buyer_id: bigint; seller_id: bigint; product_id: bigint }) {
    return this.prisma.conversation.create({ data });
  }

  /** 按主键查会话 */
  findConversationById(id: bigint) {
    return this.prisma.conversation.findUnique({ where: { id } });
  }

  /**
   * @rule CIM-R-04 落点：同一事务内写 message + 接收方未读数+1 + last_message_* 摘要
   * 返回新建消息行。
   */
  createMessageTouchConversation(input: CreateMessageTouchInput) {
    return this.prisma.$transaction(async (tx) => {
      const msg = await tx.message.create({ data: input.message });
      await tx.conversation.update({
        where: { id: input.conversationId },
        data: {
          [input.unreadField]: { increment: 1 },
          last_message_content: input.lastMessageContent,
          last_message_type: input.lastMessageType,
          last_message_sender_id: input.lastMessageSenderId,
          last_message_at: new Date(),
        },
      });
      return msg;
    });
  }

  /** 消息游标分页：id 倒序，多取 1 条供 has_more 判定；beforeId 存在时 where id < beforeId */
  findMessagesPage(conversationId: bigint, beforeId: bigint | null, take: number) {
    return this.prisma.message.findMany({
      where: {
        conversation_id: conversationId,
        ...(beforeId !== null ? { id: { lt: beforeId } } : {}),
      },
      orderBy: { id: 'desc' },
      take,
    });
  }

  /**
   * 已读回执：同一事务内将对方发给本人的未读消息批量置 is_read=true+read_at，
   * 并将本人侧未读数清零。返回本次置已读条数。
   */
  markReadAndResetUnread(
    conversationId: bigint,
    receiverId: bigint,
    unreadField: UnreadField,
  ): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.message.updateMany({
        where: {
          conversation_id: conversationId,
          receiver_id: receiverId,
          is_read: false,
        },
        data: { is_read: true, read_at: new Date() },
      });
      await tx.conversation.update({
        where: { id: conversationId },
        data: { [unreadField]: 0 },
      });
      return result.count;
    });
  }

  /** 会话列表：本人作为买方（未软删）或卖方（未软删），last_message_at 倒序 */
  findConversationsByUser(userId: bigint) {
    return this.prisma.conversation.findMany({
      where: {
        OR: [
          { buyer_id: userId, buyer_deleted: false },
          { seller_id: userId, seller_deleted: false },
        ],
      },
      orderBy: { last_message_at: 'desc' },
    });
  }

  /** 对方公开档案批量查询：白名单字段（防实名泄漏 N6） */
  findUsersPublicByIds(ids: bigint[]) {
    return this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, nickname: true, identity_type: true, avatar_url: true },
    });
  }
}
