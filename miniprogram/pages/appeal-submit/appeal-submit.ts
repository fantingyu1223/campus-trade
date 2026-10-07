/**
 * @page U21 申诉提交页（处罚记录引用条 + 申诉类型 picker + 理由 textarea ≤500
 *      + 凭证上传 ≤9 图 + 48h 时限提示条 + 回执页）
 * @ac F30-AC1（提交申诉后运营将在 48 小时内介入处理，页面常驻时限提示）
 * @module PIM-BC-05 评价与治理
 * 接口：§5.2 #42（services/api/appeal.ts submitAppeal）。
 * 接口未就绪：USE_MOCK=true 时走本地 Mock（按契约结构），就绪后置 false 切换。
 * 入口参数：punish_id（可选，缺省时用 Mock 处罚记录占位）。
 */
import { submitAppeal, AppealSubReason } from '../../services/api/appeal';
import { AppealType } from '../../types/contract';

const USE_MOCK = true;

const MAX_LEN = 500;

/** 申诉类型 picker 枚举（U21 四项） */
const APPEAL_TYPES: Array<{ value: AppealSubReason; label: string }> = [
  { value: 'seller_lost', label: '卖家失联' },
  { value: 'wrong_sold', label: '错标已售' },
  { value: 'not_as_described', label: '货不对板' },
  { value: 'punish_review', label: '误封复核' },
];

Page({
  data: {
    /** 处罚记录引用条（Mock；接口就绪后按 punish_id 查询） */
    punish: {
      punish_id: 0,
      type_label: '警告处罚',
      created_at: '2026-09-28 14:32',
      reason: '发布内容命中违禁品词表',
    },
    appealTypes: APPEAL_TYPES,
    typeIndex: -1,
    reason: '',
    reasonLen: 0,
    images: [] as string[],
    submitting: false,
    /** 提交成功后展示回执页 */
    submitted: false,
    appealId: 0,
  },

  onLoad(options: Record<string, string>) {
    const punishId = Number(options.punish_id) || 0;
    if (punishId) {
      this.setData({ 'punish.punish_id': punishId });
    }
  },

  /** 申诉类型 picker（四选一） */
  onTypeChange(e: WechatMiniprogram.PickerChange) {
    this.setData({ typeIndex: Number(e.detail.value) });
  },

  /** 申诉理由（≤500 字实时计数） */
  onReasonInput(e: WechatMiniprogram.Input) {
    this.setData({ reason: e.detail.value, reasonLen: e.detail.value.length });
  },

  /** 凭证上传：wx.chooseImage，累计 ≤9 张 */
  onChooseImage() {
    const remain = 9 - this.data.images.length;
    if (remain <= 0) {
      wx.showToast({ title: '最多上传 9 张', icon: 'none' });
      return;
    }
    wx.chooseImage({
      count: remain,
      success: (res) => {
        this.setData({ images: [...this.data.images, ...res.tempFilePaths] });
      },
    });
  },

  onRemoveImage(e: WechatMiniprogram.BaseEvent) {
    const { index } = e.currentTarget.dataset as { index: number };
    const images = [...this.data.images];
    images.splice(index, 1);
    this.setData({ images });
  },

  /** 提交申诉（§5.2 #42）：类型必选 + 理由必填 */
  onSubmit() {
    if (this.data.submitting || this.data.submitted) return;
    if (this.data.typeIndex < 0) {
      wx.showToast({ title: '请选择申诉类型', icon: 'none' });
      return;
    }
    const reason = this.data.reason.trim();
    if (!reason) {
      wx.showToast({ title: '请填写申诉理由', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });

    const subReason = APPEAL_TYPES[this.data.typeIndex].value;
    const payload = {
      appeal_type: subReason === 'punish_review' ? AppealType.PUNISHMENT : AppealType.DISPUTE,
      sub_reason: subReason,
      punish_id: this.data.punish.punish_id || undefined,
      reason,
      evidence: this.data.images,
    };

    if (USE_MOCK) {
      setTimeout(() => {
        this.setData({
          submitting: false,
          submitted: true,
          /** appeal_id 占位（接口就绪后由 #42 返回） */
          appealId: Date.now() % 100000,
        });
        wx.showToast({ title: '提交成功', icon: 'success' });
      }, 300);
      return;
    }

    submitAppeal(payload)
      .then((res) => {
        this.setData({ submitting: false, submitted: true, appealId: res.appeal_id });
        wx.showToast({ title: '提交成功', icon: 'success' });
      })
      .catch((err: Error) => {
        this.setData({ submitting: false });
        wx.showToast({ title: err.message, icon: 'none' });
      });
  },

  /** 回执页返回 */
  onBack() {
    wx.navigateBack();
  },
});
