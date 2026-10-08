/**
 * @page U1 首页（商品聚合入口与平台门面，小程序默认启动页）
 * @ac F13-AC3（常驻安全提示条） / F1-AC1（未认证拦截由 ensureLogin 守卫承接）
 * @module PIM-BC-01 用户与认证
 * 关键元素：搜索框、分类入口、商品流（§5.2 #15 列表接口）、常驻安全提示条、发布入口。
 */
import { isLoggedIn, ensureLogin } from '../../utils/session';
import { listProducts, ProductListItem } from '../../services/api/product';

interface CategoryItem {
  id: number;
  name: string;
  icon: string;
}

// 一级分类（与后台 category 表一致；子品类筛选由服务端父类目展开承接）
const CATEGORIES: CategoryItem[] = [
  { id: 1, name: '教材书籍', icon: '📚' },
  { id: 2, name: '数码电子', icon: '💻' },
  { id: 3, name: '生活用品', icon: '🪑' },
  { id: 4, name: '服饰鞋包', icon: '👟' },
];

Page({
  data: {
    categories: CATEGORIES,
    products: [] as ProductListItem[],
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

  /** 商品流加载（§5.2 #15 GET /products，默认排除已售、按最新排序） */
  loadProducts() {
    this.setData({ productsLoading: true, productsError: '' });
    listProducts({ exclude_sold: 1, sort: 'new', page: 1, pageSize: 20 })
      .then((res) => {
        this.setData({ products: res.list, productsLoading: false });
      })
      .catch((err: Error) => {
        this.setData({ productsError: err.message || '加载失败', productsLoading: false });
      });
  },

  onSearchInput(e: WechatMiniprogram.Input) {
    this.setData({ searchKeyword: e.detail.value });
  },

  /** 搜索跳转 U7 搜索结果页 */
  onSearch() {
    const keyword = this.data.searchKeyword.trim();
    wx.navigateTo({
      url: `/pages/search/search?keyword=${encodeURIComponent(keyword)}&auto=1`,
    });
  },

  /** 分类跳转 U7（按 category_id 筛选，父品类由服务端展开子类目） */
  onCategoryTap(e: WechatMiniprogram.BaseEvent) {
    const { id, name } = e.currentTarget.dataset as { id: number; name: string };
    wx.navigateTo({
      url: `/pages/search/search?category_id=${id}&category_name=${encodeURIComponent(name)}`,
    });
  },

  /** 商品卡片点击 → U8 详情页 */
  onProductTap(e: WechatMiniprogram.BaseEvent) {
    const { id } = e.currentTarget.dataset as { id: number };
    wx.navigateTo({ url: `/pages/product-detail/product-detail?id=${id}` });
  },

  /** 发布入口（F1-AC2：未登录先跳 U2 登录页） */
  onPublishTap() {
    ensureLogin()
      .then(() => wx.navigateTo({ url: '/pages/publish/publish' }))
      .catch(() => {});
  },

  onRetryProducts() {
    this.loadProducts();
  },
});
