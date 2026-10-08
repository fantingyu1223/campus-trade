/**
 * @page U22 通知中心（未读数 + 全部已读 + 5 类通知列表 + 单条已读并按类型跳转 + 空态）
 * @ac F15-AC1（通知触达承接：求购匹配/订单状态/评价提醒/求购到期/举报结果 5 类，
 *     未读圆点与计数、单条标记已读并跳转对应页面、全部已读）
 * @module PIM-BC-05 评价与治理（触达承接）
 * 接口：§5.2 #44 列表 / #45 标记已读（services/api/notify.ts）。
 * 接口未就绪：USE_MOCK=true 时走本地 Mock（按契约结构），就绪后置 false 切换。
 */
import {
  listNotifications,
  markNotificationsRead,
  NotificationItem,
  NotificationType,
} from '../../services/api/notify';

const USE_MOCK = true;

/** 类型展示配置（§4.28 type 枚举 → 图标/标题） */
const TYPE_META: Record<NotificationType, { icon: string; label: string }> = {
  want_buy_match: { icon: '🎯', label: '求购匹配' },
  order_status: { icon: '📦', label: '订单状态' },
  review_remind: { icon: '⭐', label: '评价提醒' },
  want_buy_expire: { icon: '⏰', label: '求购到期' },
  report_result: { icon: '🛡️', label: '举报结果' },
};

/** 带展示字段的通知项 */
interface NotificationView extends NotificationItem {
  icon: string;
  type_label: string;
  relative_time: string;
}

/** Mock 通知池（按 §5.2 #44 响应契约结构），就绪后删除 */
const MOCK_LIST: NotificationItem[] = [
  { id: 501, type: 'want_buy_match', title: '你的求购「求购《高等数学（第七版）》上册」有新匹配商品', payload: { product_id: 101 }, is_read: false, created_at: '2026-10-06 14:20' },
  { id: 502, type: 'order_status', title: '订单 #20261006001 卖家已交货，请确认收货', payload: { order_id: 9001 }, is_read: false, created_at: '2026-10-06 11:05' },
  { id: 503, type: 'review_remind', title: '订单 #20261004003 已完成，快来评价对方吧', payload: { order_id: 9003 }, is_read: false, created_at: '2026-10-05 18:40' },
  { id: 504, type: 'want_buy_expire', title: '你的求购「求购 iPad 2021 或更新款」将于 2 天后到期', payload: { want_buy_id: 302 }, is_read: true, created_at: '2026-10-05 09:00' },
  { id: 505, type: 'report_result', title: '你举报的商品「超低价转让手机」处理结果已出', is_read: true, created_at: '2026-10-04 16:30' },
];

Page({
  data: {
    loading: true,
    error: '',
    list: [] as NotificationView[],
    unreadCount: 0,
  },

  onLoad() {
    this.loadList();
  },

  onPullDownRefresh() {
    this.loadList(() => wx.stopPullDownRefresh());
  },

  /** 加载通知列表（§5.2 #44） */
  loadList(done?: () => void) {
    this.setData({ loading: true, error: '' });

    if (USE_MOCK) {
      setTimeout(() => {
        const list = MOCK_LIST.map((item) => this.toView(item));
        this.setData({ list, unreadCount: list.filter((i) => !i.is_read).length, loading: false });
        if (done) done();
      }, 300);
      return;
    }

    listNotifications()
      .then((res) => {
        this.setData({
          list: res.list.map((item) => this.toView(item)),
          unreadCount: res.unread_count,
          loading: false,
        });
        if (done) done();
      })
      .catch((err: Error) => {
        this.setData({ error: err.message, loading: false });
        if (done) done();
      });
  },

  /** 补充展示字段 */
  toView(item: NotificationItem): NotificationView {
    const meta = TYPE_META[item.type];
    return {
      ...item,
      icon: meta.icon,
      type_label: meta.label,
      relative_time: this.formatRelative(item.created_at),
    };
  },

  /** 相对时间：刚刚 / N分钟前 / N小时前 / 昨天 / MM-DD */
  formatRelative(createdAt: string): string {
    const ts = new Date(createdAt.replace(/-/g, '/')).getTime();
    const diff = Date.now() - ts;
    const minute = 60 * 1000;
    const hour = 60 * minute;
    if (diff < minute) return '刚刚';
    if (diff < hour) return `${Math.floor(diff / minute)}分钟前`;
    if (diff < 24 * hour) return `${Math.floor(diff / hour)}小时前`;
    const now = new Date();
    const d = new Date(ts);
    if (now.getDate() - d.getDate() === 1 && now.getMonth() === d.getMonth()) return '昨天';
    const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  },

  /** 点击单条：标记已读（§5.2 #45）+ 按类型跳转 */
  onItemTap(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id);
    const item = this.data.list.find((i) => i.id === id);
    if (!item) return;

    if (!item.is_read) {
      this.setData({
        list: this.data.list.map((i) => (i.id === id ? { ...i, is_read: true } : i)),
        unreadCount: Math.max(0, this.data.unreadCount - 1),
      });
      if (!USE_MOCK) {
        markNotificationsRead([id]).catch(() => {});
      }
    }

    switch (item.type) {
      case 'want_buy_match':
        if (item.payload && item.payload.product_id) {
          wx.navigateTo({ url: `/pages/product-detail/product-detail?id=${item.payload.product_id}` });
        }
        break;
      case 'order_status':
        if (item.payload && item.payload.order_id) {
          wx.navigateTo({ url: `/pages/order-detail/order-detail?order_id=${item.payload.order_id}` });
        }
        break;
      case 'review_remind':
        if (item.payload && item.payload.order_id) {
          wx.navigateTo({ url: `/pages/review-submit/review-submit?order_id=${item.payload.order_id}` });
        }
        break;
      case 'want_buy_expire':
        wx.switchTab({ url: '/pages/want-buy/want-buy' });
        break;
      case 'report_result':
        wx.showToast({ title: item.title, icon: 'none' });
        break;
    }
  },

  /** 全部已读（§5.2 #45，ids 空数组=全部） */
  onReadAll() {
    if (this.data.unreadCount === 0) return;
    this.setData({
      list: this.data.list.map((i) => ({ ...i, is_read: true })),
      unreadCount: 0,
    });
    wx.showToast({ title: '已全部已读', icon: 'none' });
    if (!USE_MOCK) {
      markNotificationsRead([]).catch(() => {});
    }
  },

  onRetry() {
    this.loadList();
  },
});
