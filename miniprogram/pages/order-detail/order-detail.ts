/**
 * @page U17 订单详情页（五态步骤条 / 48h 确认收货倒计时 / 状态化操作按钮 / 订单事件 timeline）
 * @ac F34-AC3（订单五态：pending_delivery 待交货 / pending_confirm 待确认 / completed 已完成 /
 *     cancelled 已取消 / appealing 申诉中，当前态高亮）
 *     F35-AC1（未录入约定交货时间时以付款成功时刻+48h 起算确认收货倒计时，超时自动确认）
 *     F35-AC3（取消订单须对方确认或 24h 未响应默认同意；现场拒收留痕）
 * @module PIM-BC-04 订单与履约
 * 接口：§5.2 #31 GET /orders/{id} / #32 confirm-receive / #33 cancel / #35 reject-onsite。
 * 接口未就绪：USE_MOCK=true 时走本地 Mock（按契约结构），就绪后置 false 切换。
 */
import {
  getOrderDetail,
  confirmReceive,
  requestCancel,
  rejectOnsite,
  OrderDetailResult,
  OrderStatusStr,
} from '../../services/api/order';

const USE_MOCK = true;

/** 五态步骤条配置（F34-AC3） */
const STATUS_STEPS: { key: OrderStatusStr; label: string }[] = [
  { key: 'pending_delivery', label: '待交货' },
  { key: 'pending_confirm', label: '待确认' },
  { key: 'completed', label: '已完成' },
  { key: 'cancelled', label: '已取消' },
  { key: 'appealing', label: '申诉中' },
];

/** Mock 订单详情（按 §5.2 #31 契约结构；confirm_deadline 见 order.ts 偏离 2），就绪后删除 */
const MOCK_DETAIL: OrderDetailResult = {
  order: {
    order_id: 9001,
    order_no: 'ORD202610060001',
    status: 'pending_confirm',
    channel: 'online',
    product: { id: 101, title: '高等数学（第七版）上下册', cover: '', price: 10 },
    buyer: { id: 1, nickname: '我' },
    seller: { id: 11, nickname: '高数学长', identity_type: 'student' },
    amount: 10,
    trade_point: '学校南门快递柜旁',
    trade_time: '2026-10-07 15:00',
    confirm_deadline: '2026-10-08 10:00:00',
    timeline: [
      { time: '2026-10-06 10:00', event: '订单创建，线上支付锁单' },
      { time: '2026-10-06 10:01', event: '支付成功，等待双方约定交货' },
      { time: '2026-10-06 18:30', event: '卖家确认已交货，等待买家确认收货' },
    ],
  },
};

Page({
  data: {
    orderId: 0,
    loading: true,
    error: '',
    order: null as OrderDetailResult['order'] | null,
    steps: STATUS_STEPS,
    /** 48h 倒计时截止时间戳（ms；F35-AC1） */
    deadline_ts: 0,
    /** 倒计时显示文本 HH:MM:SS / 已超时 */
    countdownText: '',
    /** 倒计时是否已超时 */
    countdownExpired: false,
  },

  timer: 0 as number,

  onLoad(options: Record<string, string | undefined>) {
    const orderId = Number(options.order_id) || 0;
    this.setData({ orderId });
    this.loadDetail(orderId);
  },

  onUnload() {
    this.clearTimer();
  },

  /** 加载订单详情（§5.2 #31） */
  loadDetail(orderId: number) {
    this.setData({ loading: true, error: '' });

    const applyDetail = (order: OrderDetailResult['order']) => {
      this.setData({ order, loading: false });
      this.startCountdown(order);
    };

    if (USE_MOCK) {
      setTimeout(() => {
        const order = { ...MOCK_DETAIL.order, order_id: orderId || MOCK_DETAIL.order.order_id };
        // Mock：deadline 取当前时间 + 48h，便于演示倒计时
        const deadline = new Date(Date.now() + 48 * 3600 * 1000);
        const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
        order.confirm_deadline = `${deadline.getFullYear()}-${pad(deadline.getMonth() + 1)}-${pad(deadline.getDate())} ${pad(deadline.getHours())}:${pad(deadline.getMinutes())}:${pad(deadline.getSeconds())}`;
        applyDetail(order);
      }, 300);
      return;
    }

    getOrderDetail(orderId)
      .then((res) => applyDetail(res.order))
      .catch((err: Error) => this.setData({ error: err.message, loading: false }));
  },

  onRetry() {
    this.loadDetail(this.data.orderId);
  },

  /**
   * 启动 48h 倒计时（F35-AC1）：仅 pending_confirm 态展示；
   * 每秒更新 HH:MM:SS，≤0 显示「已超时」，onUnload 清理。
   */
  startCountdown(order: OrderDetailResult['order']) {
    this.clearTimer();
    if (order.status !== 'pending_confirm' || !order.confirm_deadline) {
      this.setData({ countdownText: '', deadline_ts: 0, countdownExpired: false });
      return;
    }
    const ts = new Date(order.confirm_deadline.replace(/-/g, '/')).getTime();
    if (isNaN(ts)) return;
    this.setData({ deadline_ts: ts });

    const tick = () => {
      const remain = this.data.deadline_ts - Date.now();
      if (remain <= 0) {
        this.setData({ countdownText: '已超时', countdownExpired: true });
        this.clearTimer();
        return;
      }
      const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
      const h = Math.floor(remain / 3600000);
      const m = Math.floor((remain % 3600000) / 60000);
      const s = Math.floor((remain % 60000) / 1000);
      this.setData({ countdownText: `${pad(h)}:${pad(m)}:${pad(s)}`, countdownExpired: false });
    };
    tick();
    this.timer = setInterval(tick, 1000) as unknown as number;
  },

  clearTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = 0;
    }
  },

  /** 追加一条 timeline 事件（Mock 操作留痕） */
  appendTimeline(event: string) {
    const order = this.data.order;
    if (!order) return;
    const now = new Date();
    const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    const time = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    this.setData({ order: { ...order, timeline: [...order.timeline, { time, event }] } });
  },

  /** 确认收货（§5.2 #32，→ completed，可触发评价入口） */
  onConfirmReceive() {
    const orderId = this.data.orderId;

    const apply = () => {
      const order = this.data.order;
      if (order) this.setData({ order: { ...order, status: 'completed' } });
      this.appendTimeline('买家确认收货，订单完成');
      this.clearTimer();
      this.setData({ countdownText: '' });
      wx.showToast({ title: '已确认收货', icon: 'success' });
    };

    if (USE_MOCK) {
      setTimeout(apply, 300);
      return;
    }
    confirmReceive(orderId)
      .then(apply)
      .catch((err: Error) => wx.showToast({ title: err.message, icon: 'none' }));
  },

  /** 取消订单（§5.2 #33，对方 24h 未响应默认同意；Mock 直接置 cancelled） */
  onCancelOrder() {
    const orderId = this.data.orderId;
    wx.showModal({
      title: '取消订单',
      content: '取消须对方确认，或 24 小时未响应默认同意。确定发起取消吗？',
      success: (res) => {
        if (!res.confirm) return;

        const apply = () => {
          const order = this.data.order;
          if (order) this.setData({ order: { ...order, status: 'cancelled' } });
          this.appendTimeline('买家发起取消，订单已取消');
          this.clearTimer();
          this.setData({ countdownText: '' });
          wx.showToast({ title: '订单已取消', icon: 'none' });
        };

        if (USE_MOCK) {
          setTimeout(apply, 300);
          return;
        }
        requestCancel(orderId, '买家主动取消')
          .then(apply)
          .catch((err: Error) => wx.showToast({ title: err.message, icon: 'none' }));
      },
    });
  },

  /** 现场拒收（§5.2 #35，时间+说明必填留痕；Mock 置 cancelled） */
  onRejectOnsite() {
    const orderId = this.data.orderId;
    wx.showModal({
      title: '现场拒收',
      content: '拒收将留存时间与说明，确定现场验货不满意并拒收吗？',
      success: (res) => {
        if (!res.confirm) return;

        const apply = () => {
          const order = this.data.order;
          if (order) this.setData({ order: { ...order, status: 'cancelled' } });
          this.appendTimeline('买家现场拒收（已留痕），订单关闭');
          this.clearTimer();
          this.setData({ countdownText: '' });
          wx.showToast({ title: '已拒收', icon: 'none' });
        };

        if (USE_MOCK) {
          setTimeout(apply, 300);
          return;
        }
        rejectOnsite(orderId, { reject_time: new Date().toISOString(), reason: '现场验货不满意' })
          .then(apply)
          .catch((err: Error) => wx.showToast({ title: err.message, icon: 'none' }));
      },
    });
  },

  /** 去评价（占位：评价页本期未实现） */
  onGoReview() {
    wx.showToast({ title: '评价功能即将上线', icon: 'none' });
  },

  /** 申诉入口（占位：申诉流本期未实现） */
  onAppeal() {
    wx.showToast({ title: '申诉功能即将上线', icon: 'none' });
  },
});
