/**
 * @page U8 商品详情页（图集 / 商品信息 / 卖家信息条 / 安全提示 / 联系卖家 / 举报入口）
 * @ac F6-AC2（搜索/列表结果点击进入详情，展示完整商品与卖家信息）
 *     F7-AC2（status==='sold' 全屏「已售出」遮罩，商品不可再交易）
 * @module PIM-BC-02 商品与交易
 * 接口：§5.2 #14 GET /products/{id}（扁平结构 + seller{id,nickname,identity_type}）。
 */
import {
  getProductDetail,
  ProductDetailResult,
  ConditionLevel,
} from '../../services/api/product';

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

Page({
  data: {
    id: 0,
    loading: true,
    error: '',
    detail: null as ProductDetailResult | null,
    conditionLabel: '',
    tradeModeLabel: '',
    isSold: false,
  },

  onLoad(options: Record<string, string | undefined>) {
    const id = Number(options.id) || 0;
    this.setData({ id });
    this.loadDetail(id);
  },

  /** 加载详情（§5.2 #14） */
  loadDetail(id: number) {
    this.setData({ loading: true, error: '' });

    getProductDetail(id)
      .then((res) => {
        this.setData({
          detail: res,
          conditionLabel: CONDITION_LABELS[res.condition] || '',
          tradeModeLabel: TRADE_MODE_LABELS[res.trade_mode] || '',
          isSold: res.status === 'sold',
          loading: false,
        });
      })
      .catch((err: Error) => this.setData({ error: err.message, loading: false }));
  },

  onRetry() {
    this.loadDetail(this.data.id);
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
