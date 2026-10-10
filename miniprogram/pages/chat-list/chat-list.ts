/**
 * @page U14 会话列表页（全部会话管理：对方昵称+身份标识小标 / 未读数 badge / 最后消息摘要 / 相对时间）
 * @ac F12-AC（会话按最后消息时间倒序，未读数展示，点击进入 U15 会话页）
 *     F33-AC1（认证商家身份标识全链路亮标，与个人闲置可区分）
 * @module PIM-BC-03 沟通与交易
 * 接口：GET /conversations（§5.2 #25 会话列表，服务端实际路由；响应 {list:[{conv_id,
 *       product_id, peer{id,nickname,identity_type,avatar_url}, unread, last_msg{content,type,sender_id,at}}]}）。
 */
import { getConversations, ConversationItem } from '../../services/api/chat';
import { STATIC_BASE } from '../../config';

/** 会话列表展示项（契约项 + 摘要文本/相对时间/头像展示 URL） */
interface ConversationView extends ConversationItem {
  lastMsgText: string;
  timeLabel: string;
  peerAvatar: string;
}

/** 相对时间：刚刚 / N分钟前 / N小时前 / 昨天 / MM-DD（入参为 ISO 8601） */
export function formatRelativeTime(timeStr: string): string {
  if (!timeStr) return '';
  const t = new Date(timeStr).getTime();
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

/** 头像展示 URL：/static/ 相对路径拼 STATIC_BASE，http 外链原样，空串返回 '' */
const toDisplayUrl = (url: string): string =>
  url && url.startsWith('/static/') ? `${STATIC_BASE}${url}` : url;

Page({
  data: {
    loading: true,
    error: '',
    list: [] as ConversationView[],
  },

  onShow() {
    this.loadList();
  },

  /** 加载会话列表（GET /conversations），按最后消息时间倒序 */
  loadList() {
    this.setData({ loading: true, error: '' });

    getConversations()
      .then((res) => {
        const timeOf = (item: ConversationItem) =>
          item.last_msg?.at ? new Date(item.last_msg.at).getTime() : 0;
        const sorted = [...res.list].sort((a, b) => timeOf(b) - timeOf(a));
        this.setData({
          list: sorted.map((item) => ({
            ...item,
            lastMsgText: item.last_msg
              ? item.last_msg.type === 'image'
                ? '[图片]'
                : item.last_msg.content ?? ''
              : '开始对话吧',
            timeLabel: formatRelativeTime(item.last_msg?.at ?? ''),
            peerAvatar: toDisplayUrl(item.peer.avatar_url || ''),
          })),
          loading: false,
        });
      })
      .catch((err: Error) => this.setData({ error: err.message, loading: false }));
  },

  onRetry() {
    this.loadList();
  },

  /** 进入 U15 会话页（携带对方信息用于导航标题与身份标识） */
  onTapConversation(e: WechatMiniprogram.BaseEvent) {
    const { convId, nickname, identityType } = e.currentTarget.dataset as {
      convId: string;
      nickname: string;
      identityType: string;
    };
    wx.navigateTo({
      url: `/pages/chat/chat?conv_id=${convId}&nickname=${encodeURIComponent(nickname)}&identity_type=${identityType || ''}`,
    });
  },
});
