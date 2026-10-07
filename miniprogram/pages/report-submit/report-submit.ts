/**
 * @page U20 举报提交页（举报对象信息条 + 匿名保护提示卡 + report-form 复合表单 + 回执页）
 * @ac F18-AC1（举报分类受限枚举四选一：诈骗/违禁品/虚假描述/其他，凭证 ≤9 张）
 *     F18-AC2（匿名保护：举报人身份对被举报方不可见，页面常驻提示卡）
 * @module PIM-BC-05 评价与治理
 * 接口：§5.2 #40（services/api/report.ts submitReport）。
 * 接口未就绪：USE_MOCK=true 时走本地 Mock（按契约结构），就绪后置 false 切换。
 * 入口参数：target_type（product/user/chat）/ target_id / target_title。
 */
import { submitReport } from '../../services/api/report';
import { ReportTargetType, ReportCategory } from '../../types/contract';

const USE_MOCK = true;

/** 举报对象类型 → 展示文案 */
const TARGET_LABEL: Record<string, string> = {
  [ReportTargetType.PRODUCT]: '商品',
  [ReportTargetType.USER]: '用户',
  [ReportTargetType.MERCHANT]: '商家',
  [ReportTargetType.CHAT]: '聊天内容',
};

Page({
  data: {
    targetType: '' as ReportTargetType | '',
    targetId: 0,
    targetTitle: '',
    targetTypeLabel: '',
    submitting: false,
    /** 提交成功后展示回执页 */
    submitted: false,
    reportId: 0,
  },

  onLoad(options: Record<string, string>) {
    const targetType = (options.target_type || '') as ReportTargetType | '';
    const targetTitle = decodeURIComponent(options.target_title || '');
    if (!targetType || !TARGET_LABEL[targetType]) {
      wx.showToast({ title: '举报对象缺失', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    this.setData({
      targetType,
      targetId: Number(options.target_id) || 0,
      targetTitle,
      targetTypeLabel: TARGET_LABEL[targetType],
    });
  },

  /** report-form submit 事件：detail = { category, desc, evidence }（≤9 图） */
  onFormSubmit(e: WechatMiniprogram.CustomEvent<{ category: ReportCategory; desc: string; evidence: string[] }>) {
    if (this.data.submitting || this.data.submitted) return;
    const { category, desc, evidence } = e.detail;
    this.setData({ submitting: true });

    if (USE_MOCK) {
      setTimeout(() => {
        this.setData({
          submitting: false,
          submitted: true,
          /** report_id 占位（接口就绪后由 #40 返回） */
          reportId: Date.now() % 100000,
        });
        wx.showToast({ title: '提交成功', icon: 'success' });
      }, 300);
      return;
    }

    submitReport({
      target_type: this.data.targetType as ReportTargetType,
      target_id: this.data.targetId,
      type: category,
      desc,
      evidence,
    })
      .then((res) => {
        this.setData({ submitting: false, submitted: true, reportId: res.report_id });
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
