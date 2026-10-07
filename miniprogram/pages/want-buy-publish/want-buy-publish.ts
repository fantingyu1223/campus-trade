/**
 * @page U19-发布 求购发布页（标题/品类/预期价位区间/成色/描述 表单 + 必填校验）
 * @ac F9-AC1 F9-AC2（发布求购：必填校验，提交后返回求购列表并刷新）
 * @module PIM-BC-02 求购与撮合
 * 接口：§5.2 #20（services/api/wantbuy.ts publishWantBuy）。
 * 契约偏离：min_price/condition 为扩展字段（见 wantbuy.ts 头注释偏离 2/3）；有效期 30 天（偏离 1）。
 * 接口未就绪：USE_MOCK=true 时走本地 Mock（按契约结构），就绪后置 false 切换。
 */
import { publishWantBuy, PublishWantBuyPayload } from '../../services/api/wantbuy';

const USE_MOCK = true;

/** 品类静态数组（契约 category_id 未提供品类枚举接口，先用静态项） */
const CATEGORIES = ['教材', '数码', '生活用品', '服饰', '运动器材'];

/** 成色静态数组（与商品成色枚举一致） */
const CONDITIONS = ['全新', '九成新', '八成新', '七成新', '五成新及以下'];

Page({
  data: {
    categories: CATEGORIES,
    conditions: CONDITIONS,
    title: '',
    categoryIndex: -1,
    minPrice: '',
    maxPrice: '',
    conditionIndex: -1,
    desc: '',
    submitting: false,
    /** 必填校验缺失项红字提示 */
    errors: {
      title: false,
      category: false,
      price: false,
      condition: false,
    } as Record<string, boolean>,
  },

  onTitleInput(e: WechatMiniprogram.Input) {
    this.setData({ title: e.detail.value });
    if (e.detail.value.trim()) this.setError('title', false);
  },

  onCategoryChange(e: WechatMiniprogram.PickerChange) {
    this.setData({ categoryIndex: Number(e.detail.value) });
    this.setError('category', false);
  },

  onMinPriceInput(e: WechatMiniprogram.Input) {
    this.setData({ minPrice: e.detail.value });
    this.setError('price', false);
  },

  onMaxPriceInput(e: WechatMiniprogram.Input) {
    this.setData({ maxPrice: e.detail.value });
    this.setError('price', false);
  },

  onConditionChange(e: WechatMiniprogram.PickerChange) {
    this.setData({ conditionIndex: Number(e.detail.value) });
    this.setError('condition', false);
  },

  onDescInput(e: WechatMiniprogram.Input) {
    this.setData({ desc: e.detail.value });
  },

  setError(key: string, value: boolean) {
    this.setData({ [`errors.${key}`]: value });
  },

  /** 必填校验：缺失项红字 + toast；价位需 min≤max */
  validate(): boolean {
    const { title, categoryIndex, minPrice, maxPrice, conditionIndex } = this.data;
    const min = Number(minPrice);
    const max = Number(maxPrice);
    const priceInvalid =
      minPrice === '' || maxPrice === '' || isNaN(min) || isNaN(max) || min < 0 || max < 0 || min > max;

    const errors = {
      title: !title.trim(),
      category: categoryIndex < 0,
      price: priceInvalid,
      condition: conditionIndex < 0,
    };
    this.setData({ errors });

    if (errors.title || errors.category || errors.condition) {
      wx.showToast({ title: '请补全必填项', icon: 'none' });
      return false;
    }
    if (errors.price) {
      wx.showToast({ title: '请填写正确的预期价位（最低价 ≤ 最高价）', icon: 'none' });
      return false;
    }
    return true;
  },

  /** 提交（F9-AC2；§5.2 #20）：成功后 toast + 返回求购列表 */
  onSubmit() {
    if (this.data.submitting) return;
    if (!this.validate()) return;

    const payload: PublishWantBuyPayload = {
      title: this.data.title.trim(),
      desc: this.data.desc.trim(),
      min_price: Number(this.data.minPrice),
      max_price: Number(this.data.maxPrice),
      category_id: this.data.categoryIndex + 1,
      condition: CONDITIONS[this.data.conditionIndex],
      expire_days: 30,
    };

    this.setData({ submitting: true });

    if (USE_MOCK) {
      setTimeout(() => {
        this.setData({ submitting: false });
        wx.showToast({ title: '发布成功', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 800);
      }, 300);
      return;
    }

    publishWantBuy(payload)
      .then(() => {
        this.setData({ submitting: false });
        wx.showToast({ title: '发布成功', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 800);
      })
      .catch((err: Error) => {
        this.setData({ submitting: false });
        wx.showToast({ title: err.message, icon: 'none' });
      });
  },
});
