/**
 * components/risk-warning-modal —— 风险词警示弹层（U15，F13-AC1）。
 * 命中风险词表（§8.1）时发送侧弹出；点「继续发送」触发 continue 事件
 * （会话页带 confirm_risk=true 重发，行为留痕：发送人/接收人/命中词/时间/原文）；
 * 点「修改」触发 edit 事件关闭弹层，用户回输入框修改。
 * @module PIM-BC-03 沟通与交易
 */
Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
    },
    /** 命中风险词列表（§5.2 #27 risk_words） */
    words: {
      type: Array,
      value: [] as string[],
    },
  },
  methods: {
    onContinue() {
      this.triggerEvent('continue');
    },
    onEdit() {
      this.triggerEvent('edit');
    },
    /** 阻止冒泡：点击面板不关闭，遮罩亦不响应（强制二选一） */
    noop() {},
  },
});
