/**
 * services/api/chat.ts —— chat 聊天分组接口封装（F12/F13/F14）。
 * @api §5.2 chat 分组（服务端实际路由，server/src/modules/chat）：
 *      POST /conversations（发起会话，{product_id} → {conversation_id, reused}）
 *      GET  /conversations（会话列表 → {list:[{conv_id, product_id, peer, unread, last_msg}]}）
 *      GET  /conversations/{id}/messages（游标分页 before_id/limit → {list, has_more}）
 *      POST /conversations/{id}/messages（发消息；命中风险词未确认时 code=3002 且 data.hits 带命中词）
 *      POST /conversations/{id}/read（已读回执 → {conversation_id, cleared}）
 *      POST /conversations/{id}/intents（意向卡片 → {intent_id, status}）
 *      POST /intents/{id}/respond（响应意向 {action: accept/reject} → {status, order_id}）
 *
 * 口径：所有 id 均为字符串（服务端 BigInt 序列化）；会话列表无分页参数（服务端全量返回）。
 * 复用 auth.ts 导出的通用 request；3002 的 hits 经 err.data 透传（risk-warning-modal 承接）。
 *
 * TODO（F14 意向卡片）：意向卡在服务端是独立的 trade_intent 聚合，不以消息形式落库，
 * 故消息流中不会出现 intent_card 类型；意向卡的列表展示需服务端扩展会话/消息读模型
 * 后接入（chat 页 onIntentRespond 已按 #29 真实路由接线，展示侧留待后续批次）。
 */
import { request } from './auth';

// ---------- 类型定义（对齐 server/src/modules/chat/dto/message.dto.ts 与 dto/intent.dto.ts） ----------

/** 消息类型（服务端当前仅 text/image；intent_card 见头注释 TODO） */
export type MessageType = 'text' | 'image' | 'intent_card';

/** 意向卡片状态（trade_intent.status；respond reject 后为 cancelled） */
export type IntentStatus = 'pending' | 'confirmed' | 'cancelled';

/** 会话对方公开档案（user 表白名单字段，N6 实名不出站） */
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

/** 会话列表项 */
export interface ConversationItem {
  conv_id: string;
  product_id: string;
  peer: ConversationPeer;
  unread: number;
  last_msg: LastMessageBrief | null;
}

export interface ConversationListResult {
  list: ConversationItem[];
}

/** 消息（§5.2 #26 响应 list 项） */
export interface ChatMessage {
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

export interface MessageListResult {
  list: ChatMessage[];
  has_more: boolean;
}

/** 发消息响应（命中且未确认时 reject err.code=3002，err.data.hits 为命中词列表） */
export interface SendMessageResult {
  msg_id: string;
  created_at: string;
}

/** 意向卡片响应（#28 发起 / #29 响应；order_id 由订单模块契约接口生成，当前恒 null） */
export interface IntentResult {
  intent_id?: string;
  status: IntentStatus;
  order_id?: string | null;
}

// ---------- POST /conversations 发起会话（CIM-R-01：需实名认证） ----------
export interface CreateConversationResult {
  conversation_id: string;
  /** true 表示命中同买家+同商品复用既有会话 */
  reused: boolean;
}

export function createConversation(productId: string | number): Promise<CreateConversationResult> {
  return request<CreateConversationResult>({
    url: '/conversations',
    method: 'POST',
    data: { product_id: String(productId) },
  });
}

// ---------- #25 GET /conversations 会话列表（F12，U14） ----------
export function getConversations(): Promise<ConversationListResult> {
  return request<ConversationListResult>({ url: '/conversations', method: 'GET' });
}

// ---------- #26 GET /conversations/{id}/messages 游标分页（F12，U15） ----------
export function getMessages(convId: string, beforeId?: string, limit = 20): Promise<MessageListResult> {
  const data: Record<string, unknown> = { limit };
  if (beforeId) data.before_id = beforeId;
  return request<MessageListResult>({
    url: `/conversations/${convId}/messages`,
    method: 'GET',
    data,
  });
}

// ---------- #27 POST /conversations/{id}/messages 发消息（F13 风险词 3002） ----------
export function sendMessage(
  convId: string,
  payload: { type: 'text' | 'image'; content: string; confirm_risk?: boolean },
): Promise<SendMessageResult> {
  return request<SendMessageResult>({
    url: `/conversations/${convId}/messages`,
    method: 'POST',
    data: payload as unknown as Record<string, unknown>,
  });
}

// ---------- POST /conversations/{id}/read 已读回执（F12） ----------
export function markRead(convId: string): Promise<{ conversation_id: string; cleared: number }> {
  return request<{ conversation_id: string; cleared: number }>({
    url: `/conversations/${convId}/read`,
    method: 'POST',
  });
}

// ---------- #28 POST /conversations/{id}/intents 发起意向卡片（F14） ----------
export function createIntent(
  convId: string,
  payload: { product_id: string; price: string; meet_location: string; meet_time: string },
): Promise<IntentResult> {
  return request<IntentResult>({
    url: `/conversations/${convId}/intents`,
    method: 'POST',
    data: payload as unknown as Record<string, unknown>,
  });
}

// ---------- #29 POST /intents/{id}/respond 确认/拒绝意向卡片（F14） ----------
export function respondIntent(intentId: string, action: 'accept' | 'reject'): Promise<IntentResult> {
  return request<IntentResult>({
    url: `/intents/${intentId}/respond`,
    method: 'POST',
    data: { action },
  });
}
