/**
 * @page U16 付款页（订单摘要卡 / 「去支付」唤起付款强制风险确认弹层 / 支付成功跳转 U17 订单详情）
 * @ac F13-AC2（线上支付链路强制确认弹层：未勾选「我已阅读并理解」确认按钮禁用）
 *     F34-AC1（创建订单锁单防超卖后进入付款；支付成功生成订单并留痕）
 * @module PIM-BC-04 订单与履约
 * 接口：§5.2 #30 POST /orders（由 product_id 创建订单）/ #31 GET /orders/{id}（摘要回填）。
 * 接口未就绪：USE_MOCK=true 时走本地 Mock（按契约结构），就绪后置 false 切换。
 */
import { createOrder, getOrderDetail, OrderProduct, OrderParty } from '../../services/api/order';

const USE_MOCK = true;

/** 订单摘要展示数据（对齐 §5.2 #31 order 子集） */
interface PaySummary {
  order_id: number;
  amount: number;
  product: OrderProduct;
  seller: OrderParty;
}

/** Mock 订单摘要（按 §5.2 #31 契约结构），就绪后删除 */
const MOCK_SUMMARY: PaySummary = {
  order_id: 9001,
  amount: 10,
  product: { id: 101, title: '高等数学（第七版）上下册', cover: '', price: 10 },
  seller: { id: 11, nickname: '高数学长', identity_type: 'student' },
};

Page({
  data: {
    loading: true,
    error: '',
    summary: null as PaySummary | null,
    /** pay-confirm-modal 弹层状态（F13-AC2） */
    payVisible: false,
    paying: false,
    /** 入口参数（product_id 直达购买场景） */
    productId: 0,
  },

  onLoad(options: Record<string, string | undefined>) {
    const orderId = Number(options.order_id) || 0;
    const productId = Number(options.product_id) || 0;
    this.setData({ productId });
    this.loadSummary(orderId, productId);
  },

  /** 加载订单摘要：有 order_id 直接取详情（#31）；仅 product_id 则先创建订单（#30，锁单） */
  loadSummary(orderId: number, productId: number) {
    this.setData({ loading: true, error: '' });

    if (USE_MOCK) {
      setTimeout(() => {
        const summary = { ...MOCK_SUMMARY };
        if (orderId) summary.order_id = orderId;
        if (productId) summary.product = { ...summary.product, id: productId };
        this.setData({ summary, loading: false });
      }, 300);
      return;
    }

    const applyDetail = (res: { order: { order_id: number; amount: number; product: OrderProduct; seller: OrderParty } }) => {
      this.setData({
        summary: {
          order_id: res.order.order_id,
          amount: res.order.amount,
          product: res.order.product,
          seller: res.order.seller,
        },
        loading: false,
      });
    };

    if (orderId) {
      getOrderDetail(orderId)
        .then(applyDetail)
        .catch((err: Error) => this.setData({ error: err.message, loading: false }));
      return;
    }

    createOrder({ product_id: productId })
      .then((res) => getOrderDetail(res.order_id))
      .then(applyDetail)
      .catch((err: Error) => this.setData({ error: err.message, loading: false }));
  },

  onRetry() {
    const summary = this.data.summary;
    this.loadSummary(summary ? summary.order_id : 0, this.data.productId);
  },

  /** 点「去支付」：唤起付款强制风险确认弹层（F13-AC2） */
  onGoPay() {
    if (!this.data.summary) return;
    this.setData({ payVisible: true });
  },

  /** 弹层确认（已勾选「我已阅读并理解」）：Mock 支付成功 → redirectTo U17 订单详情 */
  onPayConfirm() {
    const summary = this.data.summary;
    if (!summary || this.data.paying) return;
    this.setData({ paying: true });

    const finish = () => {
      this.setData({ payVisible: false, paying: false });
      wx.showToast({ title: '支付成功', icon: 'success' });
      setTimeout(() => {
        wx.redirectTo({ url: `/pages/order-detail/order-detail?order_id=${summary.order_id}` });
      }, 800);
    };

    if (USE_MOCK) {
      setTimeout(finish, 500);
      return;
    }
    // 真实支付（wx.requestPayment）接口未就绪，本期占位：成功后同样 finish()
    setTimeout(finish, 500);
  },

  /** 弹层「再想想」：关闭弹层返回 */
  onPayCancel() {
    this.setData({ payVisible: false });
  },
});
