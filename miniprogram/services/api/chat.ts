/**
 * services/api/chat.ts —— chat 聊天分组接口封装（F12/F13/F14）。
 * @api §5.2 chat 分组（#25 GET /chats 会话列表 / #26 GET /chats/{conv_id}/messages 游标分页 /
 *      #27 POST /chats/{conv_id}/messages 发消息（风险词 3002）/
 *      #28 POST /chats/{conv_id}/intent 意向卡片 / #29 POST /chats/intents/{id}/respond 响应意向）
 * 复用 auth.ts 导出的通用 request；统一响应包络由 request 解析。
 *
 * 契约偏离说明（待后端确认）：
 * 1. markRead：§5.2 chat 分组无「已读回执」接口（§4.14 说明批量更新 is_read/read_at），
 *    此处按 POST /chats/{conv_id}/read 占位封装。
 * 2. ConversationPeer.identity_type：#25 响应 peer 仅含 {id,nickname,avatar}，
 *    U14 要求展示对方身份标识小标（F33 全链路亮标），需契约扩展确认。
 */
import { request } from './auth';

// ---------- 类型定义（对齐 §4.14 message / §4.15 trade_intent / §5.2 #25-29） ----------
/** 消息类型（§4.14 message.type） */
export type MessageType = 'text' | 'image' | 'intent_card';
/** 意向卡片状态（§4.15 trade_intent.status；confirmed 时裁决#2 以最后一条为准） */
export type IntentStatus = 'pending' | 'confirmed' | 'rejected' | 'expired';

/** 会话对方（§5.2 #25 peer；identity_type 见头注释偏离 2） */
export interface ConversationPeer {
  id: number;
  nickname: string;
  avatar?: string;
  identity_type?: string;
}

/** 会话列表项（§5.2 #25 响应 list 结构 + last_msg_at 排序字段） */
export interface ConversationItem {
  conv_id: number;
  peer: ConversationPeer;
  last_msg: string;
  last_msg_at: string;
  unread: number;
  product_id?: number;
}

export interface ConversationListResult {
  list: ConversationItem[];
  has_more: boolean;
}

/** 意向卡片载荷（§4.14 intent_payload：报价金额、时间地点等） */
export interface IntentPayload {
  intent_id: number;
  product_id: number;
  price: number;
  trade_point: string;
  trade_time: string;
  status: IntentStatus;
}

/** 消息（§5.2 #26 响应 list 结构；is_read 来自 §4.14 message.is_read） */
export interface ChatMessage {
  msg_id: number;
  sender_id: number;
  type: MessageType;
  content: string;
  risk_level: number;
  is_read?: boolean;
  created_at: string;
  intent_payload?: IntentPayload;
}

export interface MessageListResult {
  list: ChatMessage[];
  has_more: boolean;
}

/** 发消息响应（§5.2 #27；命中且未确认时 code=3002，data 仍返回风险详情） */
export interface SendMessageResult {
  msg_id: number;
  risk_level: number;
  risk_words: string[];
}

/** 意向卡片响应（§5.2 #28/#29） */
export interface IntentResult {
  intent_id: number;
  status: IntentStatus;
  order_id?: number;
}

// ---------- #25 GET /chats 会话列表（F12，U14） ----------
export function getConversations(page = 1, pageSize = 20): Promise<ConversationListResult> {
  return request<ConversationListResult>({
    url: '/chats',
    method: 'GET',
    data: { page, pageSize },
  });
}

// ---------- #26 GET /chats/{conv_id}/messages 消息列表（游标分页，F12，U15） ----------
export function getMessages(convId: number, beforeId?: number, pageSize = 20): Promise<MessageListResult> {
  const data: Record<string, unknown> = { pageSize };
  if (beforeId) data.before_id = beforeId;
  return request<MessageListResult>({
    url: `/chats/${convId}/messages`,
    method: 'GET',
    data,
  });
}

// ---------- #27 POST /chats/{conv_id}/messages 发消息（F13 风险词；命中未确认时 reject err.code=3002） ----------
export function sendMessage(
  convId: number,
  payload: { type: 'text' | 'image'; content: string; confirm_risk?: boolean },
): Promise<SendMessageResult> {
  return request<SendMessageResult>({
    url: `/chats/${convId}/messages`,
    method: 'POST',
    data: payload as unknown as Record<string, unknown>,
  });
}

// ---------- 已读回执（F12；契约偏离 1，占位封装） ----------
export function markRead(convId: number): Promise<{ unread_count: number }> {
  return request<{ unread_count: number }>({
    url: `/chats/${convId}/read`,
    method: 'POST',
  });
}

// ---------- #28 POST /chats/{conv_id}/intent 发起意向卡片（F14） ----------
export function createIntent(
  convId: number,
  payload: { product_id: number; price: number; trade_point: string; trade_time: string },
): Promise<IntentResult> {
  return request<IntentResult>({
    url: `/chats/${convId}/intent`,
    method: 'POST',
    data: payload as unknown as Record<string, unknown>,
  });
}

// ---------- #29 POST /chats/intents/{intent_id}/respond 确认/拒绝意向卡片（F14） ----------
export function respondIntent(intentId: number, action: 'accept' | 'reject'): Promise<IntentResult> {
  return request<IntentResult>({
    url: `/chats/intents/${intentId}/respond`,
    method: 'POST',
    data: { action },
  });
}
