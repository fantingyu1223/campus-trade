/**
 * components/intent-card —— 交易意向卡片消息（U15，F14）。
 * 展示报价金额 / 约定地点 / 约定时间；status==='pending' 时展示接受/拒绝按钮，
 * 点击触发 respond 事件（{action: 'accept'|'reject'}）由会话页调 §5.2 #29。
 * @module PIM-BC-03 沟通与交易
 */
Component({
  properties: {
    /** 意向卡片载荷（§4.14 intent_payload） */
    payload: {
      type: Object,
      value: {} as {
        intent_id: number;
        price: number;
        trade_point: string;
        trade_time: string;
        status: string;
      },
    },
    /** 是否本人发起（本人发起不展示操作按钮） */
    isSelf: {
      type: Boolean,
      value: false,
    },
  },
  data: {
    statusLabel: '',
  },
  observers: {
    'payload.status'(status: string) {
      const map: Record<string, string> = {
        pending: '待确认',
        confirmed: '已接受',
        rejected: '已拒绝',
        expired: '已失效',
      };
      this.setData({ statusLabel: map[status] || '' });
    },
  },
  methods: {
    onAccept() {
      this.triggerEvent('respond', { action: 'accept', intent_id: this.data.payload.intent_id });
    },
    onReject() {
      this.triggerEvent('respond', { action: 'reject', intent_id: this.data.payload.intent_id });
    },
  },
});
