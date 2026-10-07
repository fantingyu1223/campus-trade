/**
 * components/safety-banner —— 常驻安全提示条。
 * @ac F13-AC3：聊天页/发布页/首页等关键链路页面加载时常驻可见（N2 可见率 100%）。
 */
Component({
  options: { multipleSlots: false },
  properties: {
    /** 提示文案，默认通用防诈骗提示 */
    tip: {
      type: String,
      value: '平台不托管资金，请当面交易并验货后再付款，谨防诈骗与私下转账。',
    },
  },
});
