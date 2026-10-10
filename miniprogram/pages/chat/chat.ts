/**
 * @page U15 会话页（消息流游标分页 / 已读未读 / 已读回执 / 风险词警示弹层 / 交易意向卡片）
 * @ac F12-AC（消息流展示与发送，「加载更早」游标分页，onShow 触发已读回执）
 *     F13-AC1（命中风险词弹警示：「继续发送」带 confirm_risk=true 重发并留痕 /「修改」关闭弹层）
 *     F14（交易意向卡片：见下方 TODO）
 * @module PIM-BC-03 沟通与交易
 * 接口（服务端实际路由，见 services/api/chat.ts 头注释）：
 *   GET /conversations/{id}/messages（游标分页）/ POST 同路径（发消息，3002 风险词）/
 *   POST /conversations/{id}/read（已读回执）/ POST /intents/{id}/respond（意向响应）。
 *
 * TODO（F14 意向卡片展示侧）：意向卡在服务端是独立的 trade_intent 聚合，不以消息形式
 * 落库，故真实消息流中不会出现 intent_card 类型消息；卡片列表展示待服务端扩展
 * 会话/消息读模型后接入。onIntentRespond 已按 #29 真实路由接线（respondIntent）。
 */
import {
  getMessages,
  sendMessage,
  markRead,
  respondIntent,
  ChatMessage,
} from '../../services/api/chat';
import { getUser } from '../../utils/session';
import { STATIC_BASE } from '../../config';

/** 意向卡片展示载荷（TODO F14：当前无真实数据源，仅保留组件对接形状） */
interface IntentPayloadView {
  intent_id: string;
  product_id: string;
  price: string;
  trade_point: string;
  trade_time: string;
  status: string;
}

/** 消息展示项（服务端 MessageItem + 图片展示 URL + 意向卡片占位） */
interface MessageView {
  msg_id: string;
  sender_id: string;
  type: string;
  content: string | null;
  imageDisplay: string;
  is_read: boolean;
  created_at: string;
  intent_payload?: IntentPayloadView;
}

/** 服务端消息 → 展示项（image 消息 image_url 拼展示 URL） */
const toView = (m: ChatMessage): MessageView => ({
  msg_id: m.msg_id,
  sender_id: m.sender_id,
  type: m.type,
  content: m.content,
  imageDisplay: m.image_url
    ? m.image_url.startsWith('/static/')
      ? `${STATIC_BASE}${m.image_url}`
      : m.image_url
    : '',
  is_read: m.is_read,
  created_at: m.created_at,
});

Page({
  data: {
    convId: '',
    peerNickname: '',
    /** 当前用户 id（字符串，来自登录态快照） */
    myId: '',
    loading: true,
    error: '',
    messages: [] as MessageView[],
    hasMore: false,
    loadingMore: false,
    input: '',
    sending: false,
    /** 风险弹层状态（F13） */
    riskVisible: false,
    riskWords: [] as string[],
    /** 待重发内容（点「继续发送」时带 confirm_risk=true 重发） */
    pendingContent: '',
  },

  onLoad(options: Record<string, string | undefined>) {
    const convId = options.conv_id || '';
    const nickname = decodeURIComponent(options.nickname || '会话');
    const me = getUser();
    this.setData({ convId, peerNickname: nickname, myId: me ? String(me.id) : '' });
    wx.setNavigationBarTitle({ title: nickname });
    this.loadMessages();
  },

  /** 进入会话即触发已读回执（清零未读；本地同步将对方消息置已读） */
  onShow() {
    if (!this.data.convId) return;
    markRead(this.data.convId)
      .then(() => {
        const messages = this.data.messages.map((m) =>
          m.sender_id !== this.data.myId ? { ...m, is_read: true } : m,
        );
        this.setData({ messages });
      })
      .catch(() => {});
  },

  /** 加载消息（首屏取最新一页，服务端倒序返回，本地转升序展示） */
  loadMessages() {
    this.setData({ loading: true, error: '' });

    getMessages(this.data.convId)
      .then((res) => {
        const sorted = [...res.list]
          .sort((a, b) => Number(a.msg_id) - Number(b.msg_id))
          .map(toView);
        this.setData({ messages: sorted, hasMore: res.has_more, loading: false });
      })
      .catch((err: Error) => this.setData({ error: err.message, loading: false }));
  },

  /** 游标分页：加载更早（before_id = 当前最小 msg_id） */
  onLoadEarlier() {
    if (this.data.loadingMore || !this.data.hasMore) return;
    const oldest = this.data.messages[0];
    if (!oldest) return;
    this.setData({ loadingMore: true });

    getMessages(this.data.convId, oldest.msg_id)
      .then((res) => {
        const older = [...res.list]
          .sort((a, b) => Number(a.msg_id) - Number(b.msg_id))
          .map(toView);
        this.setData({
          messages: [...older, ...this.data.messages],
          hasMore: res.has_more,
          loadingMore: false,
        });
        if (older.length === 0) {
          wx.showToast({ title: '没有更早的消息了', icon: 'none' });
        }
      })
      .catch((err: Error) => {
        this.setData({ loadingMore: false });
        wx.showToast({ title: err.message, icon: 'none' });
      });
  },

  onInput(e: WechatMiniprogram.Input) {
    this.setData({ input: e.detail.value });
  },

  /** 发送消息（命中风险词且未确认时弹 risk-warning-modal，F13-AC1） */
  onSend() {
    const content = this.data.input.trim();
    if (!content || this.data.sending) return;
    this.doSend(content, false);
  },

  doSend(content: string, confirmRisk: boolean) {
    this.setData({ sending: true });

    sendMessage(this.data.convId, { type: 'text', content, confirm_risk: confirmRisk })
      .then((res) => {
        this.setData({
          messages: [
            ...this.data.messages,
            {
              msg_id: res.msg_id,
              sender_id: this.data.myId,
              type: 'text',
              content,
              imageDisplay: '',
              is_read: false,
              created_at: res.created_at,
            },
          ],
          input: '',
          sending: false,
          pendingContent: '',
        });
      })
      .catch((err: Error & { code?: number; data?: { hits?: string[] } | null }) => {
        this.setData({ sending: false });
        if (err.code === 3002) {
          // 命中风险词且未确认（code=3002，data.hits 为命中词列表，弹层展示）
          this.setData({
            riskVisible: true,
            riskWords: err.data?.hits ?? [],
            pendingContent: content,
          });
          return;
        }
        wx.showToast({ title: err.message || '发送失败', icon: 'none' });
      });
  },

  /** 风险弹层「继续发送」：带 confirm_risk=true 重发（留痕：发送人/接收人/命中词/时间/原文） */
  onRiskContinue() {
    this.setData({ riskVisible: false });
    const content = this.data.pendingContent;
    if (content) this.doSend(content, true);
  },

  /** 风险弹层「修改」：关闭弹层，内容保留在输入框 */
  onRiskEdit() {
    this.setData({ riskVisible: false, pendingContent: '' });
  },

  /**
   * 意向卡片接受/拒绝（#29 真实路由已接线；展示侧 TODO 见文件头注释。
   * 注：#29 响应 status 为 confirmed/cancelled，组件展示口径 reject → rejected 映射在此转换；
   * order_id 当前恒为 null（订单模块契约接口占位），故暂无付款页跳转。
   */
  onIntentRespond(e: WechatMiniprogram.CustomEvent<{ action: 'accept' | 'reject'; intent_id: string }>) {
    const { action, intent_id } = e.detail;

    respondIntent(String(intent_id), action)
      .then((res) => {
        const displayStatus = res.status === 'cancelled' ? 'rejected' : res.status;
        const messages = this.data.messages.map((m) =>
          m.intent_payload && m.intent_payload.intent_id === String(intent_id)
            ? { ...m, intent_payload: { ...m.intent_payload, status: displayStatus } }
            : m,
        );
        this.setData({ messages });
        if (action === 'accept') {
          wx.showToast({ title: '已接受意向', icon: 'success' });
        } else {
          wx.showToast({ title: '已拒绝意向', icon: 'none' });
        }
      })
      .catch((err: Error) => wx.showToast({ title: err.message, icon: 'none' }));
  },

  onRetry() {
    this.loadMessages();
  },
});
