/**
 * @page U14 会话列表页（全部会话管理：对方昵称+身份标识小标 / 未读数 badge / 最后消息摘要 / 相对时间）
 * @ac F12-AC（会话按最后消息时间倒序，未读数展示，点击进入 U15 会话页）
 *     F33-AC1（认证商家身份标识全链路亮标，与个人闲置可区分）
 * @module PIM-BC-03 沟通与交易
 * 接口：§5.2 #25 GET /chats（peer.identity_type 为扩展字段，见 services/api/chat.ts 头注释）。
 * 接口未就绪：USE_MOCK=true 时走本地 Mock（按契约结构），就绪后置 false 切换。
 */
import { getConversations, ConversationItem } from '../../services/api/chat';

const USE_MOCK = true;

/** 会话列表展示项（契约项 + 相对时间） */
interface ConversationView extends ConversationItem {
  timeLabel: string;
}

/** Mock 会话列表（按 §5.2 #25 响应契约结构），就绪后删除 */
const MOCK_LIST: ConversationItem[] = [
  {
    conv_id: 1,
    peer: { id: 11, nickname: '高数学长', identity_type: 'student' },
    last_msg: '那明天下午南门快递柜见？',
    last_msg_at: '2026-10-06 09:40',
    unread: 2,
    product_id: 101,
  },
  {
    conv_id: 2,
    peer: { id: 21, nickname: '清凉小铺', identity_type: 'merchant' },
    last_msg: '[交易意向] ¥18 · 东区商业街自提点',
    last_msg_at: '2026-10-05 21:12',
    unread: 0,
    product_id: 103,
  },
  {
    conv_id: 3,
    peer: { id: 31, nickname: '图书馆常客', identity_type: 'staff' },
    last_msg: '还在吗？风扇能便宜点吗',
    last_msg_at: '2026-10-03 15:08',
    unread: 5,
    product_id: 102,
  },
];

/** 相对时间：刚刚 / N分钟前 / N小时前 / 昨天 / MM-DD */
export function formatRelativeTime(timeStr: string): string {
  if (!timeStr) return '';
  const t = new Date(timeStr.replace(/-/g, '/')).getTime();
  if (isNaN(t)) return timeStr;
  const diff = Date.now() - t;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  if (diff < minute) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / minute)}分钟前`;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (t >= todayStart) return `${Math.floor(diff / hour)}小时前`;
  if (t >= todayStart - 24 * hour) return '昨天';
  const d = new Date(t);
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

Page({
  data: {
    loading: true,
    error: '',
    list: [] as ConversationView[],
  },

  onShow() {
    this.loadList();
  },

  /** 加载会话列表（§5.2 #25），按最后消息时间倒序 */
  loadList() {
    this.setData({ loading: true, error: '' });

    const applyResult = (list: ConversationItem[]) => {
      const sorted = [...list].sort(
        (a, b) =>
          new Date(b.last_msg_at.replace(/-/g, '/')).getTime() -
          new Date(a.last_msg_at.replace(/-/g, '/')).getTime(),
      );
      this.setData({
        list: sorted.map((item) => ({ ...item, timeLabel: formatRelativeTime(item.last_msg_at) })),
        loading: false,
      });
    };

    if (USE_MOCK) {
      setTimeout(() => applyResult(MOCK_LIST), 300);
      return;
    }

    getConversations()
      .then((res) => applyResult(res.list))
      .catch((err: Error) => this.setData({ error: err.message, loading: false }));
  },

  onRetry() {
    this.loadList();
  },

  /** 进入 U15 会话页（携带对方信息用于导航标题与身份标识） */
  onTapConversation(e: WechatMiniprogram.BaseEvent) {
    const { convId, nickname, identityType } = e.currentTarget.dataset as {
      convId: number;
      nickname: string;
      identityType: string;
    };
    wx.navigateTo({
      url: `/pages/chat/chat?conv_id=${convId}&nickname=${encodeURIComponent(nickname)}&identity_type=${identityType || ''}`,
    });
  },
});
