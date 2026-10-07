/**
 * @page U18 评价提交页（星级点选 + 文字评价 500 字实时计数 + 延迟公开提示 + 提交后待公开态）
 * @ac F17-AC1（订单完成后 7 天窗口内提交评价；评分必选否则禁用提交）
 *     F17-AC2（延迟公开：双方均提交或 7 天评价期结束后统一公开，提交后显示「待公开」）
 * @module PIM-BC-05 评价与治理
 * 接口：§5.2 #38（services/api/review.ts submitReview）。
 * 接口未就绪：USE_MOCK=true 时走本地 Mock（按契约结构），就绪后置 false 切换。
 */
import { submitReview } from '../../services/api/review';

const USE_MOCK = true;

const MAX_LEN = 500;

Page({
  data: {
    orderId: 0,
    /** 订单摘要（Mock：§5.2 #38 不返回订单摘要，需由订单详情带入；接口就绪后换 order.ts 查询） */
    orderSummary: {
      product_title: '九成新《高等数学（第七版）》上册',
      peer_nickname: '王同学',
    },
    /** 评分 1-5（默认 5） */
    score: 5,
    stars: [1, 2, 3, 4, 5],
    content: '',
    contentLen: 0,
    submitting: false,
    /** 提交成功后展示「已提交，待公开」结果页 */
    submitted: false,
    publishedAt: '',
  },

  onLoad(options: Record<string, string>) {
    this.setData({ orderId: Number(options.order_id) || 0 });
  },

  /** 星级点选 1-5 */
  onStarTap(e: WechatMiniprogram.TouchEvent) {
    const score = Number(e.currentTarget.dataset.score);
    this.setData({ score });
  },

  /** 文字评价（≤500 字实时计数） */
  onContentInput(e: WechatMiniprogram.Input) {
    this.setData({ content: e.detail.value, contentLen: e.detail.value.length });
  },

  /** 提交评价（F17-AC1：未选星禁用；§5.2 #38） */
  onSubmit() {
    if (this.data.submitting || this.data.submitted) return;
    if (!this.data.score) {
      wx.showToast({ title: '请先选择星级评分', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });

    if (USE_MOCK) {
      setTimeout(() => {
        this.setData({
          submitting: false,
          submitted: true,
          publishedAt: '双方均提交或 7 天评价期结束后',
        });
      }, 300);
      return;
    }

    submitReview({
      order_id: this.data.orderId,
      score: this.data.score,
      content: this.data.content.trim() || undefined,
    })
      .then((res) => {
        this.setData({ submitting: false, submitted: true, publishedAt: res.published_at });
      })
      .catch((err: Error) => {
        this.setData({ submitting: false });
        wx.showToast({ title: err.message, icon: 'none' });
      });
  },

  /** 结果页返回订单详情 */
  onBack() {
    wx.navigateBack();
  },
});
