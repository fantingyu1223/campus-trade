/**
 * @page U15 会话页（消息流游标分页 / 已读未读 / 已读回执 / 风险词警示弹层 / 交易意向卡片）
 * @ac F12-AC（消息流展示与发送，「加载更早」游标分页，onShow 触发已读回执）
 *     F13-AC1（命中风险词弹警示：「继续发送」带 confirm_risk=true 重发并留痕 /「修改」关闭弹层）
 *     F14（交易意向卡片：价格/地点/时间 + 接受/拒绝，§5.2 #29 respond）
 * @module PIM-BC-03 沟通与交易
 * 接口：§5.2 #26 GET /chats/{conv_id}/messages / #27 POST messages（3002 风险词）/
 *       #29 POST /chats/intents/{id}/respond / markRead（占位，见 services/api/chat.ts 头注释）。
 * 接口未就绪：USE_MOCK=true 时走本地 Mock（按契约结构），就绪后置 false 切换。
 */
import {
  getMessages,
  sendMessage,
  markRead,
  respondIntent,
  ChatMessage,
} from '../../services/api/chat';

const USE_MOCK = true;

/** 当前用户 id（Mock；真实环境取自登录态） */
const MY_ID = 1;

/** Mock 风险词表（§8.1 子集；真实环境由后端 #27 判定返回 risk_words） */
const RISK_WORDS = ['先转账', '转账', '加微信', '私下交易', '押金', '保证金'];

/** Mock 消息池（按 §5.2 #26 响应契约结构，msg_id 越大越新），就绪后删除 */
const MOCK_MESSAGES: Record<number, ChatMessage[]> = {
  1: [
    { msg_id: 11, sender_id: 1, type: 'text', content: '学长，高数教材还在吗？', risk_level: 0, is_read: true, created_at: '2026-10-06 09:20' },
    { msg_id: 12, sender_id: 11, type: 'text', content: '在的，九成新，笔记不多。', risk_level: 0, is_read: true, created_at: '2026-10-06 09:25' },
    {
      msg_id: 13,
      sender_id: 1,
      type: 'intent_card',
      content: '',
      risk_level: 0,
      is_read: true,
      created_at: '2026-10-06 09:30',
      intent_payload: { intent_id: 501, product_id: 101, price: 10, trade_point: '学校南门快递柜旁', trade_time: '2026-10-07 15:00', status: 'pending' },
    },
    { msg_id: 14, sender_id: 11, type: 'text', content: '10块可以，那明天下午南门快递柜见？', risk_level: 0, is_read: false, created_at: '2026-10-06 09:40' },
  ],
};
const MOCK_DEFAULT: ChatMessage[] = [
  { msg_id: 1, sender_id: 2, type: 'text', content: '你好，请问商品还在吗？', risk_level: 0, is_read: true, created_at: '2026-10-05 20:00' },
];

Page({
  data: {
    convId: 0,
    peerNickname: '',
    /** 当前用户 id（Mock 常量 MY_ID；真实环境取自登录态） */
    myId: MY_ID,
    loading: true,
    error: '',
    messages: [] as ChatMessage[],
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
    const convId = Number(options.conv_id) || 0;
    const nickname = decodeURIComponent(options.nickname || '会话');
    const identityType = options.identity_type || '';
    this.setData({ convId, peerNickname: nickname });
    wx.setNavigationBarTitle({ title: nickname });
    if (identityType) {
      // 身份标识已在会话列表亮标（F33），此处仅保留标题
    }
    this.loadMessages();
  },

  /** 进入会话即触发已读回执（清零未读；§5.2 无该接口，见 chat.ts 偏离 1） */
  onShow() {
    if (!this.data.convId) return;
    if (USE_MOCK) {
      // Mock：将会话内对方消息标记为已读
      const messages = this.data.messages.map((m) =>
        m.sender_id !== MY_ID ? { ...m, is_read: true } : m,
      );
      this.setData({ messages });
      return;
    }
    markRead(this.data.convId).catch(() => {});
  },

  /** 加载消息（§5.2 #26，首屏取最新一页） */
  loadMessages() {
    this.setData({ loading: true, error: '' });

    const applyResult = (list: ChatMessage[], hasMore: boolean) => {
      const sorted = [...list].sort((a, b) => a.msg_id - b.msg_id);
      this.setData({ messages: sorted, hasMore, loading: false });
    };

    if (USE_MOCK) {
      setTimeout(() => {
        const list = MOCK_MESSAGES[this.data.convId] || MOCK_DEFAULT;
        applyResult(list, true);
      }, 300);
      return;
    }

    getMessages(this.data.convId)
      .then((res) => applyResult(res.list, res.has_more))
      .catch((err: Error) => this.setData({ error: err.message, loading: false }));
  },

  /** 游标分页：加载更早（before_id = 当前最小 msg_id） */
  onLoadEarlier() {
    if (this.data.loadingMore || !this.data.hasMore) return;
    const oldest = this.data.messages[0];
    if (!oldest) return;
    this.setData({ loadingMore: true });

    const applyResult = (list: ChatMessage[], hasMore: boolean) => {
      const older = [...list].sort((a, b) => a.msg_id - b.msg_id);
      this.setData({
        messages: [...older, ...this.data.messages],
        hasMore,
        loadingMore: false,
      });
    };

    if (USE_MOCK) {
      setTimeout(() => {
        // Mock：模拟没有更早消息
        applyResult([], false);
        wx.showToast({ title: '没有更早的消息了', icon: 'none' });
      }, 300);
      return;
    }

    getMessages(this.data.convId, oldest.msg_id)
      .then((res) => applyResult(res.list, res.has_more))
      .catch((err: Error) => {
        this.setData({ loadingMore: false });
        wx.showToast({ title: err.message, icon: 'none' });
      });
  },

  onInput(e: WechatMiniprogram.Input) {
    this.setData({ input: e.detail.value });
  },

  /** 命中本地 Mock 风险词表，返回命中词 */
  detectRiskWords(content: string): string[] {
    return RISK_WORDS.filter((w) => content.includes(w));
  },

  /** 发送消息（§5.2 #27；命中风险词且未确认时弹 risk-warning-modal） */
  onSend() {
    const content = this.data.input.trim();
    if (!content || this.data.sending) return;
    this.doSend(content, false);
  },

  doSend(content: string, confirmRisk: boolean) {
    this.setData({ sending: true });

    const appendMessage = (msg: ChatMessage) => {
      this.setData({
        messages: [...this.data.messages, msg],
        input: '',
        sending: false,
        pendingContent: '',
      });
    };

    if (USE_MOCK) {
      setTimeout(() => {
        const words = this.detectRiskWords(content);
        if (words.length > 0 && !confirmRisk) {
          // 命中风险词：弹警示（F13-AC1，不拦截，可选择继续发送并留痕）
          this.setData({ sending: false, riskVisible: true, riskWords: words, pendingContent: content });
          return;
        }
        appendMessage({
          msg_id: Date.now(),
          sender_id: MY_ID,
          type: 'text',
          content,
          risk_level: words.length > 0 ? 1 : 0,
          is_read: false,
          created_at: '2026-10-06 10:00',
        });
      }, 200);
      return;
    }

    sendMessage(this.data.convId, { type: 'text', content, confirm_risk: confirmRisk })
      .then((res) => {
        appendMessage({
          msg_id: res.msg_id,
          sender_id: MY_ID,
          type: 'text',
          content,
          risk_level: res.risk_level,
          is_read: false,
          created_at: '',
        });
      })
      .catch((err: Error & { code?: number }) => {
        this.setData({ sending: false });
        if (err.code === 3002) {
          // 命中风险词且未确认（§5.2 #27：code=3002，data 仍返回风险详情）
          this.setData({ riskVisible: true, pendingContent: content });
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

  /** 意向卡片接受/拒绝（§5.2 #29；接受成功生成订单可跳 U16 付款页） */
  onIntentRespond(e: WechatMiniprogram.CustomEvent<{ action: 'accept' | 'reject'; intent_id: number }>) {
    const { action, intent_id } = e.detail;

    const applyStatus = (status: string, orderId?: number) => {
      const messages = this.data.messages.map((m) =>
        m.intent_payload && m.intent_payload.intent_id === intent_id
          ? { ...m, intent_payload: { ...m.intent_payload, status: status as never } }
          : m,
      );
      this.setData({ messages });
      if (action === 'accept') {
        wx.showToast({ title: '已接受意向', icon: 'success' });
        if (orderId) {
          setTimeout(() => wx.navigateTo({ url: `/pages/pay/pay?order_id=${orderId}` }), 600);
        }
      } else {
        wx.showToast({ title: '已拒绝意向', icon: 'none' });
      }
    };

    if (USE_MOCK) {
      setTimeout(() => applyStatus(action === 'accept' ? 'confirmed' : 'rejected', action === 'accept' ? 9001 : undefined), 300);
      return;
    }

    respondIntent(intent_id, action)
      .then((res) => applyStatus(res.status, res.order_id))
      .catch((err: Error) => wx.showToast({ title: err.message, icon: 'none' }));
  },

  onRetry() {
    this.loadMessages();
  },
});
