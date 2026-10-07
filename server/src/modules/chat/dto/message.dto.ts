/**
 * message.dto.ts —— 聊天模块出入参类型（纯声明，无逻辑）
 *
 * @module PIM-BC-03 沟通与协商
 * @model PIM-AG-05 会话与消息聚合
 * @api §5.2 #25-27 + POST /conversations（发起会话）+ POST /conversations/:id/read（已读回执）
 */

/** 消息类型（本批仅 text/image；intent_card 由 F14 意向卡片批次实现） */
export type MessageTypeValue = 'text' | 'image';

/** 发起会话结果：reused=true 表示命中 uk_pair_product 复用既有会话 */
export interface CreateConversationResult {
  conversation_id: string;
  reused: boolean;
}

/** 发消息结果 */
export interface SendMessageResult {
  msg_id: string;
  created_at: string;
}

/** 消息列表项（契约 §5.2 #26） */
export interface MessageItem {
  msg_id: string;
  sender_id: string;
  receiver_id: string;
  type: string;
  content: string | null;
  image_url: string | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

/** 消息游标分页结果 */
export interface MessageListResult {
  list: MessageItem[];
  has_more: boolean;
}

/** 会话对方公开档案（user 表白名单字段，防实名泄漏 N6） */
export interface ConversationPeer {
  id: string;
  nickname: string;
  identity_type: string;
  avatar_url: string;
}

/** 最后一条消息摘要 */
export interface LastMessageBrief {
  content: string | null;
  type: string | null;
  sender_id: string | null;
  at: string | null;
}

/** 会话列表项（契约 §5.2 #25：conv_id/peer/last_msg/unread/product_id） */
export interface ConversationListItem {
  conv_id: string;
  product_id: string;
  peer: ConversationPeer;
  unread: number;
  last_msg: LastMessageBrief | null;
}

/** 会话列表结果 */
export interface ConversationListResult {
  list: ConversationListItem[];
}

/** 已读回执结果：cleared 为本次置已读的消息条数 */
export interface MarkReadResult {
  conversation_id: string;
  cleared: number;
}
