/**
 * @page U8 商品详情页（图集 / 商品信息 / 卖家信息条 / 安全提示 / 联系卖家 / 举报入口）
 * @ac F6-AC2（搜索/列表结果点击进入详情，展示完整商品与卖家信息）
 *     F7-AC2（status==='sold' 全屏「已售出」遮罩，商品不可再交易）
 * @module PIM-BC-02 商品与交易
 * 接口：§5.2 #14 GET /products/{id}（响应 product{...} + seller{id,nickname,role...}）。
 * 接口未就绪：USE_MOCK=true 时走本地 Mock（按契约结构），就绪后置 false 切换。
 */
import {
  getProductDetail,
  ProductDetailResult,
  ConditionLevel,
} from '../../services/api/product';

const USE_MOCK = true;

/** 成色五档中文映射（§4.8 condition_level） */
const CONDITION_LABELS: Record<ConditionLevel, string> = {
  new: '全新',
  like_new: '几乎全新',
  good: '九成新',
  fair: '八成新',
  poor: '较旧',
};

/** 交易方式中文映射（§4.8 trade_mode） */
const TRADE_MODE_LABELS: Record<string, string> = {
  meet: '线下自提',
  online: '线上交易',
  both: '自提 / 线上均可',
};

/** Mock 详情（按 §5.2 #14 响应契约结构），就绪后删除 */
const MOCK_DETAIL_MAP: Record<number, ProductDetailResult> = {
  101: {
    product: {
      id: 101,
      title: '高等数学（下）教材',
      description: '考研自用教材，内页有少量笔记，无缺页破损，南门自提。',
      price: 12,
      original_price: 45,
      condition_level: 'good',
      trade_mode: 'meet',
      meet_location: '学校南门快递柜旁',
      images: [],
      status: 'on_sale',
      is_urgent: true,
      published_at: '2026-09-28 10:00',
    },
    seller: { id: 11, nickname: '高数学长', credit_score: 96, identity_type: 'student' },
    is_favorited: false,
  },
  103: {
    product: {
      id: 103,
      title: '宿舍用小风扇 静音款',
      description: '商家清库存，三档风速，USB 供电。',
      price: 20,
      condition_level: 'fair',
      trade_mode: 'both',
      meet_location: '东区商业街自提点',
      images: [],
      status: 'sold',
      is_urgent: false,
      published_at: '2026-09-20 14:30',
    },
    seller: { id: 21, nickname: '清凉小铺', credit_score: 88, identity_type: 'merchant' },
    is_favorited: false,
  },
};

/** 兜底 Mock：未命中 id 时按在售商品生成 */
const MOCK_FALLBACK: ProductDetailResult = {
  product: {
    id: 0,
    title: '校园闲置好物',
    description: '卖家很懒，什么都没有留下。',
    price: 10,
    condition_level: 'good',
    trade_mode: 'meet',
    meet_location: '校内自提',
    images: [],
    status: 'on_sale',
    is_urgent: false,
  },
  seller: { id: 0, nickname: '卖家', credit_score: 90, identity_type: 'student' },
  is_favorited: false,
};

Page({
  data: {
    loading: true,
    error: '',
    detail: null as ProductDetailResult | null,
    conditionLabel: '',
    tradeModeLabel: '',
    isSold: false,
  },

  onLoad(options: Record<string, string | undefined>) {
    const id = Number(options.id) || 0;
    this.loadDetail(id);
  },

  /** 加载详情（§5.2 #14） */
  loadDetail(id: number) {
    this.setData({ loading: true, error: '' });

    const applyResult = (res: ProductDetailResult) => {
      this.setData({
        detail: res,
        conditionLabel: CONDITION_LABELS[res.product.condition_level] || '',
        tradeModeLabel: TRADE_MODE_LABELS[res.product.trade_mode] || '',
        isSold: res.product.status === 'sold',
        loading: false,
      });
    };

    if (USE_MOCK) {
      setTimeout(() => {
        const mock = MOCK_DETAIL_MAP[id] || { ...MOCK_FALLBACK, product: { ...MOCK_FALLBACK.product, id } };
        applyResult(mock);
      }, 300);
      return;
    }

    getProductDetail(id)
      .then(applyResult)
      .catch((err: Error) => this.setData({ error: err.message, loading: false }));
  },

  onRetry() {
    const id = this.data.detail?.product.id || 0;
    this.loadDetail(id);
  },

  /** 联系卖家：聊天功能未上线，占位提示（F8 待接入） */
  onContactSeller() {
    wx.showToast({ title: '聊天功能即将上线', icon: 'none' });
  },

  /** 举报入口：占位提示（F13 待接入） */
  onReport() {
    wx.showToast({ title: '举报功能即将上线', icon: 'none' });
  },
});
