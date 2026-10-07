/**
 * @page U1 首页（商品聚合入口与平台门面，小程序默认启动页）
 * @ac F13-AC3（常驻安全提示条） / F1-AC1（未认证拦截由 ensureLogin 守卫承接）
 * @module PIM-BC-01 用户与认证
 * 关键元素：搜索框、分类入口（正面清单静态占位）、商品流（Mock 按契约结构）、常驻安全提示条。
 */
import { isLoggedIn } from '../../utils/session';

interface CategoryItem {
  id: number;
  name: string;
  icon: string;
}

interface ProductCard {
  id: number;
  title: string;
  price: number;
  condition: string;
  cover: string;
  is_urgent: boolean;
  seller: {
    id: number;
    nickname: string;
    identity_type: string;
  };
}

// 分类入口静态占位（正面清单由后台 A9 维护，接口就绪后替换为接口数据）
const CATEGORY_PLACEHOLDER: CategoryItem[] = [
  { id: 1, name: '教材书籍', icon: '📚' },
  { id: 2, name: '数码电子', icon: '💻' },
  { id: 3, name: '生活用品', icon: '🪑' },
  { id: 4, name: '运动户外', icon: '🏀' },
  { id: 5, name: '服饰鞋包', icon: '👟' },
  { id: 6, name: '美妆个护', icon: '🧴' },
  { id: 7, name: '票务卡券', icon: '🎫' },
  { id: 8, name: '其他闲置', icon: '📦' },
];

// 商品流 Mock：按契约字段结构（product + seller 快照），接口就绪后切换 services/api
const MOCK_PRODUCTS: ProductCard[] = [
  { id: 101, title: '高等数学（下）教材 九成新', price: 12, condition: '九成新', cover: '', is_urgent: true, seller: { id: 1, nickname: '高数学长', identity_type: 'student' } },
  { id: 102, title: '罗技无线鼠标 M330', price: 45, condition: '八成新', cover: '', is_urgent: false, seller: { id: 2, nickname: '数码控', identity_type: 'student' } },
  { id: 103, title: '宿舍用小风扇 静音款', price: 20, condition: '七成新', cover: '', is_urgent: false, seller: { id: 3, nickname: '清凉小铺', identity_type: 'merchant' } },
  { id: 104, title: '瑜伽垫 加厚防滑', price: 15, condition: '九成新', cover: '', is_urgent: true, seller: { id: 4, nickname: '爱运动的TA', identity_type: 'staff' } },
];

Page({
  data: {
    categories: CATEGORY_PLACEHOLDER,
    products: [] as ProductCard[],
    productsLoading: false,
    productsError: '',
    searchKeyword: '',
    loggedIn: false,
  },

  onLoad() {
    this.loadProducts();
  },

  onShow() {
    this.setData({ loggedIn: isLoggedIn() });
  },

  /** 商品流加载（当前为 Mock；接口就绪后改为 services/api 商品列表接口） */
  loadProducts() {
    this.setData({ productsLoading: true, productsError: '' });
    setTimeout(() => {
      this.setData({ products: MOCK_PRODUCTS, productsLoading: false });
    }, 300);
  },

  onSearchInput(e: WechatMiniprogram.Input) {
    this.setData({ searchKeyword: e.detail.value });
  },

  /** 搜索跳转 U7 搜索结果页（后续任务提供，先占位提示） */
  onSearch() {
    wx.showToast({ title: '搜索结果页（U7）待接入', icon: 'none' });
  },

  onCategoryTap(e: WechatMiniprogram.BaseEvent) {
    const { name } = e.currentTarget.dataset as { name: string };
    wx.showToast({ title: `分类「${name}」列表待接入`, icon: 'none' });
  },

  /** 商品卡片点击 → U8 详情页（后续任务提供） */
  onProductTap(e: WechatMiniprogram.BaseEvent) {
    const { id } = e.currentTarget.dataset as { id: number };
    wx.showToast({ title: `商品详情页（U8，id=${id}）待接入`, icon: 'none' });
  },

  onRetryProducts() {
    this.loadProducts();
  },
});
