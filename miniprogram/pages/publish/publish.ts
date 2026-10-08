/**
 * @page U10 发布商品页（三步：实拍图 → 商品信息表单 → 汇总确认提交）
 * @ac F5-AC1（必填项校验：逐项红字提示 + toast 首个缺失项，收集缺失字段列表）
 *     F5-AC2（实拍图上传 wx.chooseImage，最多 9 张，缩略图可删除）
 *     F5-AC3（提交成功反馈并返回；急出标识附「同时最多 3 件」提示）
 *     F10a-AC1（急出商品标识录入）
 * 违规拦截：后端敏感词/违规内容返回 9001（showModal 拦截承接）。
 * @module PIM-BC-02 商品与交易
 * 接口：§5.2 #10 POST /products（入参对齐 PublishPayload）。
 */
import {
  publishProduct,
  PublishPayload,
  ConditionLevel,
  TradeMode,
} from '../../services/api/product';
import { ensureLogin } from '../../utils/session';
import { STATIC_PLACEHOLDER_IMAGE } from '../../config';

/** 叶子品类（与数据库 category 表一致；服务端 CIM-R-07 只接受叶子节点） */
const CATEGORY_OPTIONS = [
  { id: 5, name: '教材教辅' },
  { id: 6, name: '考试用书' },
  { id: 7, name: '手机/平板' },
  { id: 8, name: '笔记本电脑' },
  { id: 9, name: '耳机/音箱' },
  { id: 10, name: '宿舍用品' },
  { id: 11, name: '洗护清洁' },
  { id: 13, name: '其他' },
];

/** 「其他」品类的数据库叶子 id（选中后需自定义输入品类名） */
const OTHER_CATEGORY_ID = 13;

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
  customCategory: '自定义品类',
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
    customCategory: '',
    otherCategoryId: OTHER_CATEGORY_ID,
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

  onLoad() {
    // 发布为受限操作（F1-AC2）：未登录先跳 U2 登录页
    ensureLogin().catch(() => wx.navigateBack());
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
  onCustomCategoryInput(e: WechatMiniprogram.Input) {
    this.setData({ customCategory: e.detail.value });
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
    } else if (d.categoryOptions[d.categoryIndex].id === OTHER_CATEGORY_ID && !d.customCategory.trim()) {
      missing.push(FIELD_LABELS.customCategory);
      errors.customCategory = `请填写${FIELD_LABELS.customCategory}`;
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
    const categoryId = d.categoryOptions[d.categoryIndex].id;
    const customCategory = d.customCategory.trim();
    // 「其他」品类：自定义品类名落为描述首行（服务端只接受正面清单叶子品类）
    const desc =
      categoryId === OTHER_CATEGORY_ID && customCategory
        ? `品类：${customCategory}\n${d.desc.trim()}`
        : d.desc.trim();
    const payload: PublishPayload = {
      title: d.title.trim(),
      desc,
      price: Number(d.price).toFixed(2),
      category_id: String(categoryId),
      // COS 未开通、无上传接口：本地图暂以占位图 URL 提交（见 config.ts）
      images: d.images.map(() => STATIC_PLACEHOLDER_IMAGE),
      stock: 1,
      is_urgent: d.isUrgent,
      trade_point: d.meetLocation.trim(),
      condition: d.conditionOptions[d.conditionIndex].value,
      trade_mode: d.tradeModeOptions[d.tradeModeIndex].value,
    };

    this.setData({ submitting: true });

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
