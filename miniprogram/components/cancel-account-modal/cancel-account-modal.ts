/**
 * @component components/cancel-account-modal —— 注销账号二次确认弹窗（U24 使用）。
 * @ac F26-AC1（注销须二次确认：警告文案 + 手动输入「注销」二字方可确认；
 *      存在在途交易/未结申诉将被拦截，拦截分支由页面处理）
 * @module PIM-BC-01 用户与认证
 * 交互：输入框内容不等于「注销」时确认按钮 disabled；
 * 确认触发 confirm 事件，取消/遮罩触发 cancel 事件。
 */
Component({
  properties: {
    visible: { type: Boolean, value: false },
    /** 确认中态（防重复提交） */
    confirming: { type: Boolean, value: false },
  },
  data: {
    keyword: '注销',
    inputValue: '',
  },
  methods: {
    onInput(e: WechatMiniprogram.Input) {
      this.setData({ inputValue: e.detail.value });
    },

    /** 确认：仅当输入恰为「注销」时透传 confirm 事件 */
    onConfirm() {
      if (this.data.confirming) return;
      if (this.data.inputValue !== this.data.keyword) {
        wx.showToast({ title: '请输入「注销」二字确认', icon: 'none' });
        return;
      }
      this.setData({ inputValue: '' });
      this.triggerEvent('confirm');
    },

    onCancel() {
      this.setData({ inputValue: '' });
      this.triggerEvent('cancel');
    },

    /** 阻止冒泡：点击面板不关闭 */
    noop() {},
  },
});
