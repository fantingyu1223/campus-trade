/**
 * components/report-form —— 举报复合表单组件（U20 复用）。
 * 组成：举报对象信息条 + 理由枚举 picker（诈骗/违禁品/虚假描述/其他）
 *      + 补充描述 textarea（≤500 字实时计数）+ 凭证上传（≤9 图 wx.chooseImage + 删除）。
 * 校验：理由必选、描述必填；submit 事件回传 { category, desc, evidence }。
 * 匿名保护提示卡由页面（U20）承载，不在本组件内。
 * @module PIM-BC-05 评价与治理
 */
import { ReportCategory } from '../../types/contract';

/** 理由枚举（对齐 types/contract.ts ReportCategory，F18） */
const CATEGORIES = [
  { value: ReportCategory.FRAUD, label: '诈骗' },
  { value: ReportCategory.PROHIBITED, label: '违禁品' },
  { value: ReportCategory.FALSE_DESC, label: '虚假描述' },
  { value: ReportCategory.OTHER, label: '其他' },
];

Component({
  properties: {
    /** 举报对象类型文案（如：商品 / 用户 / 聊天内容） */
    targetTypeLabel: { type: String, value: '' },
    /** 举报对象名称（商品标题 / 用户昵称 / 会话对方） */
    targetTitle: { type: String, value: '' },
    /** 提交中态（禁用重复提交） */
    submitting: { type: Boolean, value: false },
  },
  data: {
    categories: CATEGORIES,
    categoryIndex: -1,
    desc: '',
    descLen: 0,
    images: [] as string[],
  },
  methods: {
    /** 理由枚举 picker（受限四选一，不可自由输入） */
    onCategoryChange(e: WechatMiniprogram.PickerChange) {
      this.setData({ categoryIndex: Number(e.detail.value) });
    },

    onDescInput(e: WechatMiniprogram.Input) {
      this.setData({ desc: e.detail.value, descLen: e.detail.value.length });
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

    /** 提交：理由必选 + 描述必填校验，透传 submit 事件 */
    onSubmit() {
      if (this.data.submitting) return;
      if (this.data.categoryIndex < 0) {
        wx.showToast({ title: '请选择举报理由', icon: 'none' });
        return;
      }
      const desc = this.data.desc.trim();
      if (!desc) {
        wx.showToast({ title: '请填写补充描述', icon: 'none' });
        return;
      }
      this.triggerEvent('submit', {
        category: CATEGORIES[this.data.categoryIndex].value,
        desc,
        evidence: this.data.images,
      });
    },
  },
});
