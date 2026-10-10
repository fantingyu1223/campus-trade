/**
 * @page U8 商品详情页（图集 / 商品信息 / 卖家信息条 / 安全提示 / 联系卖家 / 举报入口）
 * @ac F6-AC2（搜索/列表结果点击进入详情，展示完整商品与卖家信息）
 *     F7-AC2（status==='sold' 全屏「已售出」遮罩，商品不可再交易）
 * @module PIM-BC-02 商品与交易
 * 接口：§5.2 #14 GET /products/{id}（扁平结构 + seller{id,nickname,identity_type}）；
 *      联系卖家（F8）→ POST /conversations 创建/复用会话后跳 U15（services/api/chat.ts）。
 */
import {
  getProductDetail,
  ProductDetailResult,
  ConditionLevel,
} from '../../services/api/product';
import { createConversation } from '../../services/api/chat';
import { ensureLogin } from '../../utils/session';

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

  /**
   * 联系卖家（F8）：登录守卫 → 自建会话拦截 → 创建/复用会话（POST /conversations）→ 跳 U15 会话页。
   * 会话以商品为上下文（uk_pair_product 同买家+同商品复用既有会话）。
   */
  onContactSeller() {
    const detail = this.data.detail;
    if (!detail) return;
    ensureLogin()
      .then((me) => {
        if (String(detail.seller.id) === String(me.id)) {
          wx.showToast({ title: '不能和自己会话', icon: 'none' });
          return;
        }
        createConversation(detail.id)
          .then((res) => {
            wx.navigateTo({
              url: `/pages/chat/chat?conv_id=${res.conversation_id}&nickname=${encodeURIComponent(detail.seller.nickname || '卖家')}&identity_type=${detail.seller.identity_type || ''}`,
            });
          })
          .catch((err: Error) => {
            wx.showToast({ title: err.message || '发起会话失败', icon: 'none' });
          });
      })
      .catch(() => {});
  },

  /** 举报入口：占位提示（F13 待接入） */
  onReport() {
    wx.showToast({ title: '举报功能即将上线', icon: 'none' });
  },
});
