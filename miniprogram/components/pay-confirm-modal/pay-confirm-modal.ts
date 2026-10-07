/**
 * components/pay-confirm-modal —— 付款强制风险确认弹层（U16，F13 线上支付链路强化提示 / F35）。
 * 强制弹层：不可点遮罩关闭；复选框「我已阅读并理解」未勾选时确认按钮 disabled；
 * 确认触发 confirm 事件；点「再想想」触发 cancel 事件返回。
 * @module PIM-BC-04 订单与履约
 */
Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
    },
    /** 支付金额（元），用于按钮与摘要展示 */
    amount: {
      type: Number,
      value: 0,
    },
  },
  data: {
    agreed: false,
  },
  methods: {
    onToggleAgree() {
      this.setData({ agreed: !this.data.agreed });
    },
    /** 确认：未勾选时拦截（按钮已 disabled，双保险） */
    onConfirm() {
      if (!this.data.agreed) {
        wx.showToast({ title: '请先勾选「我已阅读并理解」', icon: 'none' });
        return;
      }
      this.triggerEvent('confirm');
    },
    onCancel() {
      this.triggerEvent('cancel');
    },
    /** 强制弹层：点遮罩不关闭 */
    noop() {},
  },
});
