/**
 * @page U7 搜索结果页（关键词搜索 + 筛选 + 排序 + 结果列表）
 * @ac F6-AC1（关键词搜索与筛选组合：价格区间 / 成色五档 / 身份过滤）
 *     F6-AC2（排序：最新 / 价格升 / 价格降）
 *     F10a-AC1（急出商品亮标展示）
 * @module PIM-BC-02 商品与交易
 * 接口：§5.2 #15 GET /products（keyword/min_price/max_price/role_filter/sort）。
 * 接口未就绪：USE_MOCK=true 时走本地 Mock（按契约结构），就绪后置 false 切换。
 */
import {
  listProducts,
  ProductListItem,
  ConditionLevel,
  RoleFilter,
  ProductSort,
} from '../../services/api/product';

const USE_MOCK = true;

interface ConditionOption {
  value: ConditionLevel | '';
  label: string;
}
interface RoleOption {
  value: '' | RoleFilter;
  label: string;
}
interface SortOption {
  value: ProductSort;
  label: string;
}

/** 成色五档（§4.8 condition_level；'' = 不限） */
const CONDITION_OPTIONS: ConditionOption[] = [
  { value: '', label: '不限' },
  { value: 'new', label: '全新' },
  { value: 'like_new', label: '几乎全新' },
  { value: 'good', label: '九成新' },
  { value: 'fair', label: '八成新' },
  { value: 'poor', label: '较旧' },
];

/** 身份过滤：全部 / 个人闲置（person=非商家，契约偏离见 product.ts） / 认证商家 */
const ROLE_OPTIONS: RoleOption[] = [
  { value: '', label: '全部' },
  { value: 'person', label: '个人闲置' },
  { value: 'merchant', label: '认证商家' },
];

const SORT_OPTIONS: SortOption[] = [
  { value: 'new', label: '最新' },
  { value: 'price_asc', label: '价格升序' },
  { value: 'price_desc', label: '价格降序' },
];

/** Mock 搜索结果（按 §5.2 #15 list 契约结构），就绪后删除 */
const MOCK_LIST: ProductListItem[] = [
  { id: 101, title: '高等数学（下）教材', price: 12, cover: '', is_urgent: true, condition_level: 'good', status: 'on_sale', seller_role: 'student', seller_nickname: '高数学长' },
  { id: 102, title: '罗技无线鼠标 M330', price: 45, cover: '', is_urgent: false, condition_level: 'fair', status: 'on_sale', seller_role: 'student', seller_nickname: '数码控' },
  { id: 103, title: '宿舍用小风扇 静音款', price: 20, cover: '', is_urgent: false, condition_level: 'fair', status: 'on_sale', seller_role: 'merchant', seller_nickname: '清凉小铺' },
  { id: 104, title: '瑜伽垫 加厚防滑', price: 15, cover: '', is_urgent: true, condition_level: 'like_new', status: 'on_sale', seller_role: 'staff', seller_nickname: '爱运动的TA' },
  { id: 105, title: '全新未拆封英语六级真题', price: 30, cover: '', is_urgent: false, condition_level: 'new', status: 'on_sale', seller_role: 'student', seller_nickname: '六级必过' },
];

Page({
  data: {
    keyword: '',
    // 筛选面板
    panelVisible: false,
    conditionOptions: CONDITION_OPTIONS,
    roleOptions: ROLE_OPTIONS,
    sortOptions: SORT_OPTIONS,
    minPrice: '',
    maxPrice: '',
    condition: '' as ConditionLevel | '',
    roleFilter: '' as '' | RoleFilter,
    sort: 'new' as ProductSort,
    // 列表
    list: [] as ProductListItem[],
    loading: false,
    error: '',
    total: 0,
    searched: false,
  },

  onLoad(options: Record<string, string | undefined>) {
    if (options.keyword) {
      this.setData({ keyword: decodeURIComponent(options.keyword) }, () => this.doSearch());
    }
  },

  onKeywordInput(e: WechatMiniprogram.Input) {
    this.setData({ keyword: e.detail.value });
  },

  onSearchConfirm() {
    this.doSearch();
  },

  /** 执行搜索（F6-AC1/AC2：筛选 + 排序参数组装） */
  doSearch() {
    const { keyword, minPrice, maxPrice, condition, roleFilter, sort } = this.data;
    this.setData({ loading: true, error: '', searched: true, panelVisible: false });

    const query = {
      keyword,
      min_price: minPrice ? Number(minPrice) : undefined,
      max_price: maxPrice ? Number(maxPrice) : undefined,
      condition_level: condition || undefined,
      role_filter: roleFilter || undefined,
      sort,
      exclude_sold: 1,
      page: 1,
      pageSize: 20,
    };

    if (USE_MOCK) {
      setTimeout(() => {
        let list = MOCK_LIST.filter((p) => !keyword || p.title.includes(keyword));
        if (query.min_price !== undefined) list = list.filter((p) => p.price >= (query.min_price as number));
        if (query.max_price !== undefined) list = list.filter((p) => p.price <= (query.max_price as number));
        if (condition) list = list.filter((p) => p.condition_level === condition);
        if (roleFilter === 'merchant') list = list.filter((p) => p.seller_role === 'merchant');
        if (roleFilter === 'person') list = list.filter((p) => p.seller_role !== 'merchant');
        if (sort === 'price_asc') list = [...list].sort((a, b) => a.price - b.price);
        if (sort === 'price_desc') list = [...list].sort((a, b) => b.price - a.price);
        this.setData({ list, total: list.length, loading: false });
      }, 300);
      return;
    }

    listProducts(query)
      .then((res) => this.setData({ list: res.list, total: res.total, loading: false }))
      .catch((err: Error) => this.setData({ error: err.message, loading: false }));
  },

  // ---------- 筛选面板 ----------
  onTogglePanel() {
    this.setData({ panelVisible: !this.data.panelVisible });
  },
  onMinPriceInput(e: WechatMiniprogram.Input) {
    this.setData({ minPrice: e.detail.value });
  },
  onMaxPriceInput(e: WechatMiniprogram.Input) {
    this.setData({ maxPrice: e.detail.value });
  },
  onConditionTap(e: WechatMiniprogram.BaseEvent) {
    const { value } = e.currentTarget.dataset as { value: ConditionLevel | '' };
    this.setData({ condition: value });
  },
  onRoleTap(e: WechatMiniprogram.BaseEvent) {
    const { value } = e.currentTarget.dataset as { value: '' | RoleFilter };
    this.setData({ roleFilter: value });
  },
  onResetFilter() {
    this.setData({ minPrice: '', maxPrice: '', condition: '', roleFilter: '' });
  },
  onApplyFilter() {
    this.doSearch();
  },

  // ---------- 排序 ----------
  onSortTap(e: WechatMiniprogram.BaseEvent) {
    const { value } = e.currentTarget.dataset as { value: ProductSort };
    this.setData({ sort: value }, () => this.doSearch());
  },

  /** 卡片点击 → U8 详情 */
  onCardTap(e: WechatMiniprogram.CustomEvent) {
    const { id } = e.detail as { id: number };
    wx.navigateTo({ url: `/pages/product-detail/product-detail?id=${id}` });
  },

  onRetry() {
    this.doSearch();
  },
});
