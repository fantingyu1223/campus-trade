/**
 * @page U19 求购页（「全部」/「我的」双 tab 列表 + 发布入口 + 续期/关闭/已买到操作）
 * @ac F9-AC1（求购列表承接撮合匹配）F9-AC2（发布求购，入口跳转发布页）
 *     F9-AC3（续期 +30 天刷新倒计时 / 关闭、已买到为终态：条目置灰且不再显示操作）
 * @module PIM-BC-02 求购与撮合
 * 接口：§5.2 #20-24（services/api/wantbuy.ts）；续期按后端 T-201 临时口径重置 30 天。
 * 接口未就绪：USE_MOCK=true 时走本地 Mock（按契约结构），就绪后置 false 切换。
 */
import {
  listWantBuys,
  renewWantBuy,
  closeWantBuy,
  boughtWantBuy,
  WantBuyItem,
} from '../../services/api/wantbuy';

const USE_MOCK = true;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Mock 求购池（按 §5.2 #24 响应契约结构），就绪后删除 */
const MOCK_ALL: WantBuyItem[] = [
  { id: 301, category_id: 1, category_name: '教材书籍', title: '求购《高等数学（第七版）》上册', desc: '笔记少一点的优先', min_price: 5, max_price: 15, condition: '九成新', status: 'active', expire_at: '2026-11-05 23:59:59', created_at: '2026-10-06 10:00' },
  { id: 302, category_id: 2, category_name: '数码电子', title: '求购 iPad 2021 或更新款', desc: '带笔可加价', min_price: 1200, max_price: 1800, condition: '八成新以上', status: 'active', expire_at: '2026-10-08 23:59:59', created_at: '2026-10-05 15:30' },
  { id: 303, category_id: 3, category_name: '生活用品', title: '求购宿舍用小冰箱', desc: '50L 左右即可', min_price: 100, max_price: 200, condition: '不限成色', status: 'active', expire_at: '2026-10-09 23:59:59', created_at: '2026-10-04 09:10' },
];
const MOCK_MINE: WantBuyItem[] = [
  { id: 302, category_id: 2, category_name: '数码电子', title: '求购 iPad 2021 或更新款', desc: '带笔可加价', min_price: 1200, max_price: 1800, condition: '八成新以上', status: 'active', expire_at: '2026-10-08 23:59:59', created_at: '2026-10-05 15:30' },
  { id: 304, category_id: 4, category_name: '运动户外', title: '求购一副羽毛球拍', desc: '', min_price: 30, max_price: 80, condition: '七成新以上', status: 'bought', expire_at: '2026-10-20 23:59:59', created_at: '2026-09-28 12:00' },
  { id: 305, category_id: 1, category_name: '教材书籍', title: '求购《线性代数》辅导书', desc: '', min_price: 3, max_price: 10, condition: '不限成色', status: 'closed', expire_at: '2026-10-01 23:59:59', created_at: '2026-09-20 08:00' },
];

Page({
  data: {
    /** 当前 tab：all 全部 / mine 我的 */
    tab: 'all' as 'all' | 'mine',
    loading: true,
    error: '',
    list: [] as WantBuyItem[],
  },

  onLoad() {
    this.loadList();
  },

  onShow() {
    // 从发布页返回时刷新列表
    if (!this.data.loading && this.data.list.length >= 0) this.loadList();
  },

  onPullDownRefresh() {
    this.loadList(() => wx.stopPullDownRefresh());
  },

  onTabChange(e: WechatMiniprogram.TouchEvent) {
    const tab = e.currentTarget.dataset.tab as 'all' | 'mine';
    if (tab === this.data.tab) return;
    this.setData({ tab }, () => this.loadList());
  },

  /** 加载求购列表（§5.2 #24，scope=all/mine） */
  loadList(done?: () => void) {
    this.setData({ loading: true, error: '' });
    const scope = this.data.tab;

    if (USE_MOCK) {
      setTimeout(() => {
        this.setData({ list: scope === 'mine' ? [...MOCK_MINE] : [...MOCK_ALL], loading: false });
        if (done) done();
      }, 300);
      return;
    }

    listWantBuys(scope)
      .then((res) => {
        this.setData({ list: res.list, loading: false });
        if (done) done();
      })
      .catch((err: Error) => {
        this.setData({ error: err.message, loading: false });
        if (done) done();
      });
  },

  /** 发布求购入口（F9-AC2，跳发布页） */
  onPublish() {
    wx.navigateTo({ url: '/pages/want-buy-publish/want-buy-publish' });
  },

  /** 续期（F9-AC3：confirm 后 +30 天并刷新倒计时；§5.2 #21） */
  onRenew(e: WechatMiniprogram.CustomEvent<{ id: number }>) {
    const id = e.detail.id;
    wx.showModal({
      title: '续期确认',
      content: '续期后有效期将延长 30 天，确认续期？',
      success: (res) => {
        if (!res.confirm) return;
        if (USE_MOCK) {
          this.patchItem(id, (item) => ({
            ...item,
            expire_at: this.formatDate(new Date(item.expire_at.replace(/-/g, '/')).getTime() + 30 * DAY_MS),
          }));
          wx.showToast({ title: '已续期 30 天', icon: 'success' });
          return;
        }
        renewWantBuy(id)
          .then((r) => {
            this.patchItem(id, (item) => ({ ...item, expire_at: r.expire_at }));
            wx.showToast({ title: '已续期', icon: 'success' });
          })
          .catch((err: Error) => wx.showToast({ title: err.message, icon: 'none' }));
      },
    });
  },

  /** 关闭（F9-AC3：终态，confirm 后置灰不再显示操作；§5.2 #22） */
  onClose(e: WechatMiniprogram.CustomEvent<{ id: number }>) {
    const id = e.detail.id;
    wx.showModal({
      title: '关闭求购',
      content: '关闭后不可恢复，将不再接收匹配推荐，确认关闭？',
      success: (res) => {
        if (!res.confirm) return;
        if (USE_MOCK) {
          this.patchItem(id, (item) => ({ ...item, status: 'closed' }));
          wx.showToast({ title: '已关闭', icon: 'none' });
          return;
        }
        closeWantBuy(id)
          .then(() => {
            this.patchItem(id, (item) => ({ ...item, status: 'closed' }));
            wx.showToast({ title: '已关闭', icon: 'none' });
          })
          .catch((err: Error) => wx.showToast({ title: err.message, icon: 'none' }));
      },
    });
  },

  /** 标记已买到（F9-AC3：终态；§5.2 #23） */
  onBought(e: WechatMiniprogram.CustomEvent<{ id: number }>) {
    const id = e.detail.id;
    wx.showModal({
      title: '标记已买到',
      content: '确认已买到该商品？标记后求购单将结束。',
      success: (res) => {
        if (!res.confirm) return;
        if (USE_MOCK) {
          this.patchItem(id, (item) => ({ ...item, status: 'bought' }));
          wx.showToast({ title: '已标记买到', icon: 'success' });
          return;
        }
        boughtWantBuy(id)
          .then(() => {
            this.patchItem(id, (item) => ({ ...item, status: 'bought' }));
            wx.showToast({ title: '已标记买到', icon: 'success' });
          })
          .catch((err: Error) => wx.showToast({ title: err.message, icon: 'none' }));
      },
    });
  },

  /** 本地更新单个条目（Mock 操作后刷新倒计时/状态展示） */
  patchItem(id: number, patch: (item: WantBuyItem) => WantBuyItem) {
    this.setData({
      list: this.data.list.map((item) => (item.id === id ? patch(item) : item)),
    });
  },

  formatDate(ts: number): string {
    const d = new Date(ts);
    const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} 23:59:59`;
  },

  onRetry() {
    this.loadList();
  },
});
