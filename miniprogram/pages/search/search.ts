/**
 * @page U7 搜索结果页（关键词搜索 + 筛选 + 排序 + 结果列表）
 * @ac F6-AC1（关键词搜索与筛选组合：价格区间 / 成色五档 / 身份过滤）
 *     F6-AC2（排序：最新 / 价格升 / 价格降）
 *     F10a-AC1（急出商品亮标展示）
 * @module PIM-BC-02 商品与交易
 * 接口：§5.2 #15 GET /products（keyword/category_id/min_price/max_price/role_filter/sort）。
 */
import {
  listProducts,
  ProductListItem,
  ConditionLevel,
  RoleFilter,
  ProductSort,
} from '../../services/api/product';

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

/** 身份过滤：全部 / 个人闲置（personal=非商家，对齐服务端枚举） / 认证商家 */
const ROLE_OPTIONS: RoleOption[] = [
  { value: '', label: '全部' },
  { value: 'personal', label: '个人闲置' },
  { value: 'merchant', label: '认证商家' },
];

const SORT_OPTIONS: SortOption[] = [
  { value: 'new', label: '最新' },
  { value: 'price_asc', label: '价格升序' },
  { value: 'price_desc', label: '价格降序' },
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
    categoryId: 0,
  },

  onLoad(options: Record<string, string | undefined>) {
    const patch: Record<string, unknown> = {};
    if (options.keyword) patch.keyword = decodeURIComponent(options.keyword);
    if (options.category_id) patch.categoryId = Number(options.category_id);
    if (options.category_name) {
      wx.setNavigationBarTitle({ title: decodeURIComponent(options.category_name) });
    }
    // 带关键词/分类进入或显式 auto=1（首页空关键词搜索全部）时自动执行
    if (options.keyword || options.category_id || options.auto === '1') {
      this.setData(patch, () => this.doSearch());
    } else if (Object.keys(patch).length > 0) {
      this.setData(patch);
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
    const { keyword, minPrice, maxPrice, condition, roleFilter, sort, categoryId } = this.data;
    this.setData({ loading: true, error: '', searched: true, panelVisible: false });

    const query = {
      keyword: keyword || undefined,
      category_id: categoryId || undefined,
      min_price: minPrice ? Number(minPrice) : undefined,
      max_price: maxPrice ? Number(maxPrice) : undefined,
      condition_level: condition || undefined,
      role_filter: roleFilter || undefined,
      sort,
      exclude_sold: 1,
      page: 1,
      pageSize: 20,
    };

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
