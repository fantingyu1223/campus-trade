/**
 * @page U17列表 订单列表页（我的订单：状态标签五色 / 商品标题 / 金额 / 时间，点击进入 U17 订单详情）
 * @ac F34（订单全程留痕与状态管理，列表按创建时间倒序）
 * @module PIM-BC-04 订单与履约
 * 接口：§5.2 #37 GET /orders 我的订单列表（role=buyer，分页）。
 * 接口未就绪：USE_MOCK=true 时走本地 Mock（按契约结构），就绪后置 false 切换。
 */
import { getMyOrders, OrderListItem, OrderStatusStr } from '../../services/api/order';

const USE_MOCK = true;

/** 状态标签展示配置（五色） */
const STATUS_META: Record<OrderStatusStr, { label: string; color: string }> = {
  pending_delivery: { label: '待交货', color: '#1890ff' },
  pending_confirm: { label: '待确认', color: '#fa8c16' },
  completed: { label: '已完成', color: '#07c160' },
  cancelled: { label: '已取消', color: '#999' },
  appealing: { label: '申诉中', color: '#ff4d4f' },
};

/** 列表展示项（契约项 + 状态文案/颜色） */
interface OrderListView extends OrderListItem {
  statusLabel: string;
  statusColor: string;
}

/** Mock 订单列表（按 §5.2 #37 响应契约结构），就绪后删除 */
const MOCK_LIST: OrderListItem[] = [
  {
    order_id: 9001,
    order_no: 'ORD202610060001',
    status: 'pending_confirm',
    amount: 10,
    product: { id: 101, title: '高等数学（第七版）上下册', price: 10 },
    peer: { id: 11, nickname: '高数学长' },
    created_at: '2026-10-06 10:00',
  },
  {
    order_id: 9002,
    order_no: 'ORD202610050002',
    status: 'pending_delivery',
    amount: 18,
    product: { id: 103, title: '便携小风扇 USB 充电款', price: 18 },
    peer: { id: 21, nickname: '清凉小铺' },
    created_at: '2026-10-05 21:30',
  },
  {
    order_id: 9003,
    order_no: 'ORD202610010003',
    status: 'completed',
    amount: 5,
    product: { id: 105, title: '英语四级词汇书', price: 5 },
    peer: { id: 31, nickname: '图书馆常客' },
    created_at: '2026-10-01 14:20',
  },
  {
    order_id: 9004,
    order_no: 'ORD202609280004',
    status: 'cancelled',
    amount: 30,
    product: { id: 107, title: '宿舍折叠桌', price: 30 },
    peer: { id: 41, nickname: '隔壁宿舍老王' },
    created_at: '2026-09-28 09:12',
  },
  {
    order_id: 9005,
    order_no: 'ORD202609250005',
    status: 'appealing',
    amount: 45,
    product: { id: 108, title: '九成新蓝牙耳机', price: 45 },
    peer: { id: 51, nickname: '数码小站' },
    created_at: '2026-09-25 16:45',
  },
];

Page({
  data: {
    loading: true,
    error: '',
    list: [] as OrderListView[],
  },

  onShow() {
    this.loadList();
  },

  /** 加载订单列表（§5.2 #37），按创建时间倒序 */
  loadList() {
    this.setData({ loading: true, error: '' });

    const applyResult = (list: OrderListItem[]) => {
      const sorted = [...list].sort(
        (a, b) =>
          new Date(b.created_at.replace(/-/g, '/')).getTime() -
          new Date(a.created_at.replace(/-/g, '/')).getTime(),
      );
      this.setData({
        list: sorted.map((item) => {
          const meta = STATUS_META[item.status] || { label: item.status, color: '#999' };
          return { ...item, statusLabel: meta.label, statusColor: meta.color };
        }),
        loading: false,
      });
    };

    if (USE_MOCK) {
      setTimeout(() => applyResult(MOCK_LIST), 300);
      return;
    }

    getMyOrders('buyer')
      .then((res) => applyResult(res.list))
      .catch((err: Error) => this.setData({ error: err.message, loading: false }));
  },

  onRetry() {
    this.loadList();
  },

  /** 进入 U17 订单详情 */
  onTapOrder(e: WechatMiniprogram.BaseEvent) {
    const { orderId } = e.currentTarget.dataset as { orderId: number };
    wx.navigateTo({ url: `/pages/order-detail/order-detail?order_id=${orderId}` });
  },
});
