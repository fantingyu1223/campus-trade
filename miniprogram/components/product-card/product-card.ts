/**
 * components/product-card —— 商品卡片（图 / 标题 / 价格 / 急出标 / 卖家身份标识小标）。
 * 用于 U1 商品流、U7 搜索结果、U12 我的商品等列表场景（F6/F10a 急出亮标）。
 * @module PIM-BC-02 商品与交易
 */
import { ConditionLevel } from '../../services/api/product';

/** 成色五档文案（§4.8 condition_level 枚举） */
const CONDITION_LABEL: Record<string, string> = {
  new: '全新',
  like_new: '几乎全新',
  good: '九成新',
  fair: '八成新',
  poor: '较旧',
};

Component({
  options: {
    multipleSlots: false,
  },
  properties: {
    /** 商品列表项（§5.2 #15 list 结构：id/title/price/cover/is_urgent/seller_role/condition_level） */
    product: {
      type: Object,
      value: {},
    },
    /** 是否展示已售角标（U12 已售 tab 使用） */
    showSold: {
      type: Boolean,
      value: false,
    },
  },
  data: {
    condition_label: '',
  },
  observers: {
    'product.condition_level'(level: ConditionLevel) {
      this.setData({ condition_label: CONDITION_LABEL[level] || '' });
    },
  },
  methods: {
    onTap() {
      const product = this.data.product as { id?: number };
      this.triggerEvent('cardtap', { id: product.id });
    },
  },
});
