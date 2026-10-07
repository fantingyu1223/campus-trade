/**
 * @page U10 发布商品页（三步：实拍图 → 商品信息表单 → 汇总确认提交）
 * @ac F5-AC1（必填项校验：逐项红字提示 + toast 首个缺失项，收集缺失字段列表）
 *     F5-AC2（实拍图上传 wx.chooseImage，最多 9 张，缩略图可删除）
 *     F5-AC3（提交成功反馈并返回；急出标识附「同时最多 3 件」提示）
 *     F10a-AC1（急出商品标识录入）
 * 违规拦截：后端敏感词/违规内容返回 9001（Mock 分支以标题含「代考」模拟 showModal 拦截）。
 * @module PIM-BC-02 商品与交易
 * 接口：§5.2 #10 POST /products（入参对齐 PublishPayload）。
 * 接口未就绪：USE_MOCK=true 时走本地 Mock（按契约结构），就绪后置 false 切换。
 */
import {
  publishProduct,
  PublishPayload,
  ConditionLevel,
  TradeMode,
} from '../../services/api/product';

const USE_MOCK = true;

/** 静态分类（契约扩展前占位；就绪后应由分类接口下发） */
const CATEGORY_OPTIONS = [
  { id: 1, name: '教材书籍' },
  { id: 2, name: '数码电子' },
  { id: 3, name: '生活用品' },
  { id: 4, name: '服饰鞋包' },
  { id: 5, name: '运动户外' },
  { id: 6, name: '其他' },
];

/** 成色五档（§4.8 condition_level） */
const CONDITION_OPTIONS: { value: ConditionLevel; label: string }[] = [
  { value: 'new', label: '全新' },
  { value: 'like_new', label: '几乎全新' },
  { value: 'good', label: '九成新' },
  { value: 'fair', label: '八成新' },
  { value: 'poor', label: '较旧' },
];

/** 交易方式（§4.8 trade_mode） */
const TRADE_MODE_OPTIONS: { value: TradeMode; label: string }[] = [
  { value: 'meet', label: '线下自提' },
  { value: 'online', label: '线上交易' },
  { value: 'both', label: '自提 / 线上均可' },
];

/** 必填字段中文名（校验缺失字段列表展示用） */
const FIELD_LABELS: Record<string, string> = {
  images: '实拍图',
  title: '商品标题',
  category: '商品分类',
  condition: '成色',
  price: '价格',
  meetLocation: '自提地点',
  desc: '商品描述',
  tradeMode: '交易方式',
};

Page({
  data: {
    step: 1,
    // step1 实拍图
    images: [] as string[],
    // step2 表单
    title: '',
    categoryOptions: CATEGORY_OPTIONS,
    categoryIndex: -1,
    conditionOptions: CONDITION_OPTIONS,
    conditionIndex: -1,
    price: '',
    meetLocation: '',
    desc: '',
    tradeModeOptions: TRADE_MODE_OPTIONS,
    tradeModeIndex: 0,
    isUrgent: false,
    // 校验错误：{ field: 提示文案 }
    errors: {} as Record<string, string>,
    submitting: false,
  },

  // ---------- step1 实拍图（F5-AC2） ----------
  onChooseImage() {
    const remain = 9 - this.data.images.length;
    if (remain <= 0) {
      wx.showToast({ title: '最多上传 9 张', icon: 'none' });
      return;
    }
    wx.chooseImage({
      count: remain,
      success: (res) => {
        this.setData({
          images: [...this.data.images, ...res.tempFilePaths],
          errors: { ...this.data.errors, images: '' },
        });
      },
    });
  },

  onDeleteImage(e: WechatMiniprogram.BaseEvent) {
    const { index } = e.currentTarget.dataset as { index: number };
    const images = [...this.data.images];
    images.splice(index, 1);
    this.setData({ images });
  },

  // ---------- step2 表单输入 ----------
  onTitleInput(e: WechatMiniprogram.Input) {
    this.setData({ title: e.detail.value });
  },
  onCategoryChange(e: WechatMiniprogram.PickerChange) {
    this.setData({ categoryIndex: Number(e.detail.value) });
  },
  onConditionChange(e: WechatMiniprogram.PickerChange) {
    this.setData({ conditionIndex: Number(e.detail.value) });
  },
  onPriceInput(e: WechatMiniprogram.Input) {
    this.setData({ price: e.detail.value });
  },
  onMeetLocationInput(e: WechatMiniprogram.Input) {
    this.setData({ meetLocation: e.detail.value });
  },
  onDescInput(e: WechatMiniprogram.Input) {
    this.setData({ desc: e.detail.value });
  },
  onTradeModeChange(e: WechatMiniprogram.PickerChange) {
    this.setData({ tradeModeIndex: Number(e.detail.value) });
  },
  onUrgentChange(e: WechatMiniprogram.SwitchChange) {
    this.setData({ isUrgent: e.detail.value });
  },

  // ---------- 步骤流转 ----------
  onNextStep() {
    if (this.data.step === 1) {
      if (this.data.images.length === 0) {
        this.setData({ errors: { ...this.data.errors, images: `请上传${FIELD_LABELS.images}` } });
        wx.showToast({ title: `请上传${FIELD_LABELS.images}`, icon: 'none' });
        return;
      }
      this.setData({ step: 2 });
      return;
    }
    if (this.data.step === 2) {
      if (!this.validateForm()) return;
      this.setData({ step: 3 });
    }
  },

  onPrevStep() {
    if (this.data.step > 1) this.setData({ step: this.data.step - 1 });
  },

  /** 必填校验（F5-AC1）：收集缺失字段列表，逐项红字 + toast 首项 */
  validateForm(): boolean {
    const d = this.data;
    const errors: Record<string, string> = {};
    const missing: string[] = [];
    const mark = (field: string) => {
      missing.push(FIELD_LABELS[field]);
      errors[field] = `请填写${FIELD_LABELS[field]}`;
    };

    if (!d.title.trim()) mark('title');
    if (d.categoryIndex < 0) {
      missing.push(FIELD_LABELS.category);
      errors.category = `请选择${FIELD_LABELS.category}`;
    }
    if (d.conditionIndex < 0) {
      missing.push(FIELD_LABELS.condition);
      errors.condition = `请选择${FIELD_LABELS.condition}`;
    }
    if (!d.price.trim() || Number(d.price) <= 0 || isNaN(Number(d.price))) mark('price');
    if (!d.meetLocation.trim()) mark('meetLocation');
    if (!d.desc.trim()) mark('desc');

    this.setData({ errors });
    if (missing.length > 0) {
      wx.showToast({ title: `请完善：${missing[0]}`, icon: 'none' });
      return false;
    }
    return true;
  },

  /** step3 提交（F5-AC3 + 9001 违规拦截） */
  onSubmit() {
    if (this.data.submitting) return;
    if (!this.validateForm()) {
      this.setData({ step: 2 });
      return;
    }

    const d = this.data;
    const payload: PublishPayload = {
      title: d.title.trim(),
      desc: d.desc.trim(),
      price: Number(d.price),
      category_id: d.categoryOptions[d.categoryIndex].id,
      images: d.images,
      stock: 1,
      is_urgent: d.isUrgent,
      trade_point: d.meetLocation.trim(),
      condition_level: d.conditionOptions[d.conditionIndex].value,
      trade_mode: d.tradeModeOptions[d.tradeModeIndex].value,
    };

    this.setData({ submitting: true });

    if (USE_MOCK) {
      setTimeout(() => {
        this.setData({ submitting: false });
        // 模拟后端 9001 违规内容拦截
        if (payload.title.includes('代考')) {
          wx.showModal({
            title: '发布失败',
            content: '商品信息包含违规内容，已被平台拦截（错误码 9001），请修改后重新发布。',
            showCancel: false,
            confirmText: '我知道了',
          });
          return;
        }
        wx.showToast({ title: '发布成功', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 800);
      }, 500);
      return;
    }

    publishProduct(payload)
      .then(() => {
        wx.showToast({ title: '发布成功', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 800);
      })
      .catch((err: Error & { code?: number }) => {
        this.setData({ submitting: false });
        if (err.code === 9001) {
          wx.showModal({
            title: '发布失败',
            content: `商品信息包含违规内容，已被平台拦截（错误码 9001）：${err.message}`,
            showCancel: false,
            confirmText: '我知道了',
          });
          return;
        }
        wx.showToast({ title: err.message || '发布失败，请重试', icon: 'none' });
      });
  },
});
