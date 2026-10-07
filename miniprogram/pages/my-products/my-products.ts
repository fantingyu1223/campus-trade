/**
 * @page U12 我的商品页（在售 / 已售 / 下架三 Tab 管理）
 * @ac F7-AC1（卖家管理自己的商品：下架 / 标记已售（须指定买家，U13 弹窗）/ 重新上架）
 * @module PIM-BC-02 商品与交易
 * 接口：§5.2 #16 GET /products/mine（status=on_sale/sold/off_sale）、
 *      #12 POST /products/{id}/offline、#13 POST /products/{id}/sold。
 * 接口未就绪：USE_MOCK=true 时走本地 Mock（按契约结构），就绪后置 false 切换。
 */
import {
  myProducts,
  offlineProduct,
  relistProduct,
  markSold,
  getBuyerCandidates,
  ProductListItem,
  BuyerCandidate,
} from '../../services/api/product';

const USE_MOCK = true;

type TabStatus = 'on_sale' | 'sold' | 'off_sale';

const TABS: { value: TabStatus; label: string }[] = [
  { value: 'on_sale', label: '在售' },
  { value: 'sold', label: '已售' },
  { value: 'off_sale', label: '下架' },
];

/** 成色五档中文映射（§4.8 condition_level） */
const CONDITION_LABELS: Record<string, string> = {
  new: '全新',
  like_new: '几乎全新',
  good: '九成新',
  fair: '八成新',
  poor: '较旧',
};

/** Mock 我的商品（按 §5.2 #16 list 契约结构），就绪后删除 */
const MOCK_MINE: ProductListItem[] = [
  { id: 201, title: '数据结构考研真题集', price: 25, cover: '', is_urgent: true, condition_level: 'good', status: 'on_sale', seller_role: 'student', seller_nickname: '我' },
  { id: 202, title: '机械键盘 87 键', price: 80, cover: '', is_urgent: false, condition_level: 'fair', status: 'on_sale', seller_role: 'student', seller_nickname: '我' },
  { id: 203, title: '宿舍床帘 遮光款', price: 18, cover: '', is_urgent: false, condition_level: 'like_new', status: 'sold', seller_role: 'student', seller_nickname: '我' },
  { id: 204, title: '旧版英语词典', price: 5, cover: '', is_urgent: false, condition_level: 'poor', status: 'off_sale', seller_role: 'student', seller_nickname: '我' },
];

/** Mock 买家候选（F7 标记已售须指定买家；就绪后由 getBuyerCandidates 下发） */
const MOCK_BUYERS: BuyerCandidate[] = [
  { id: 201, nickname: '买家A' },
  { id: 202, nickname: '买家B' },
];

Page({
  data: {
    tabs: TABS,
    activeTab: 'on_sale' as TabStatus,
    list: [] as (ProductListItem & { condition_label: string })[],
    loading: false,
    error: '',
    // 标记已售弹窗（U13）
    markSoldVisible: false,
    markSoldProductId: 0,
    buyers: [] as BuyerCandidate[],
  },

  onLoad() {
    this.loadList();
  },

  onTabTap(e: WechatMiniprogram.BaseEvent) {
    const { value } = e.currentTarget.dataset as { value: TabStatus };
    if (value === this.data.activeTab) return;
    this.setData({ activeTab: value }, () => this.loadList());
  },

  /** 加载当前 Tab 列表（§5.2 #16） */
  loadList() {
    const status = this.data.activeTab;
    this.setData({ loading: true, error: '' });

    const decorate = (list: ProductListItem[]) =>
      list.map((p) => ({ ...p, condition_label: CONDITION_LABELS[p.condition_level] || '' }));

    if (USE_MOCK) {
      setTimeout(() => {
        this.setData({
          list: decorate(MOCK_MINE.filter((p) => p.status === status)),
          loading: false,
        });
      }, 300);
      return;
    }

    myProducts(status)
      .then((res) => this.setData({ list: decorate(res.list), loading: false }))
      .catch((err: Error) => this.setData({ error: err.message, loading: false }));
  },

  // ---------- 在售：下架（§5.2 #12） ----------
  onOffline(e: WechatMiniprogram.BaseEvent) {
    const { id } = e.currentTarget.dataset as { id: number };
    wx.showModal({
      title: '下架商品',
      content: '下架后商品将不再展示给其他用户，确定下架吗？',
      confirmText: '确定下架',
      success: (res) => {
        if (!res.confirm) return;
        if (USE_MOCK) {
          const item = MOCK_MINE.find((p) => p.id === id);
          if (item) item.status = 'off_sale';
          wx.showToast({ title: '已下架', icon: 'success' });
          this.loadList();
          return;
        }
        offlineProduct(id)
          .then(() => {
            wx.showToast({ title: '已下架', icon: 'success' });
            this.loadList();
          })
          .catch((err: Error) => wx.showToast({ title: err.message, icon: 'none' }));
      },
    });
  },

  // ---------- 在售：标记已售（§5.2 #13，拉起 U13 弹窗） ----------
  onMarkSold(e: WechatMiniprogram.BaseEvent) {
    const { id } = e.currentTarget.dataset as { id: number };
    this.setData({ markSoldProductId: id });

    if (USE_MOCK) {
      this.setData({ buyers: MOCK_BUYERS, markSoldVisible: true });
      return;
    }

    getBuyerCandidates(id)
      .then((buyers) => this.setData({ buyers, markSoldVisible: true }))
      .catch((err: Error) => wx.showToast({ title: err.message, icon: 'none' }));
  },

  /** U13 弹窗选定买家（未选买家由弹窗内部拦截「必须指定买家」） */
  onMarkSoldSelect(e: WechatMiniprogram.CustomEvent) {
    const { buyer } = e.detail as { buyer: BuyerCandidate };
    const id = this.data.markSoldProductId;
    this.setData({ markSoldVisible: false });

    if (USE_MOCK) {
      const item = MOCK_MINE.find((p) => p.id === id);
      if (item) item.status = 'sold';
      wx.showToast({ title: '已标记已售', icon: 'success' });
      this.loadList();
      return;
    }

    markSold(id, buyer.id)
      .then(() => {
        wx.showToast({ title: '已标记已售', icon: 'success' });
        this.loadList();
      })
      .catch((err: Error) => wx.showToast({ title: err.message, icon: 'none' }));
  },

  onMarkSoldCancel() {
    this.setData({ markSoldVisible: false });
  },

  // ---------- 下架：重新上架 ----------
  onRelist(e: WechatMiniprogram.BaseEvent) {
    const { id } = e.currentTarget.dataset as { id: number };
    if (USE_MOCK) {
      const item = MOCK_MINE.find((p) => p.id === id);
      if (item) item.status = 'on_sale';
      wx.showToast({ title: '已重新上架', icon: 'success' });
      this.loadList();
      return;
    }
    relistProduct(id)
      .then(() => {
        wx.showToast({ title: '已重新上架', icon: 'success' });
        this.loadList();
      })
      .catch((err: Error) => wx.showToast({ title: err.message, icon: 'none' }));
  },

  /** 卡片点击 → U8 详情 */
  onCardTap(e: WechatMiniprogram.CustomEvent) {
    const { id } = e.detail as { id: number };
    wx.navigateTo({ url: `/pages/product-detail/product-detail?id=${id}` });
  },

  onRetry() {
    this.loadList();
  },

  /** 发布入口 → U10 */
  onGoPublish() {
    wx.navigateTo({ url: '/pages/publish/publish' });
  },
});
