/**
 * @page U23 收藏页（收藏列表：价格变动红绿标识 / 已售出已下架灰标 / 长按取消收藏 / 空态）
 * @ac F8-AC1（收藏列表展示与取消收藏；收藏时价与当前价对比提示涨跌，sold/off_shelf 置灰标识）
 * @module PIM-BC-05 评价与治理（收藏承接）
 * 接口：§5.2 #19 列表 / #18 取消收藏（services/api/favorite.ts）。
 * 契约偏离：fav_price/cover 为扩展字段（见 favorite.ts 头注释偏离 1）。
 * 接口未就绪：USE_MOCK=true 时走本地 Mock（按契约结构），就绪后置 false 切换。
 */
import { listFavorites, removeFavorite, FavoriteItem } from '../../services/api/favorite';

const USE_MOCK = true;

/** 带展示字段的收藏项 */
interface FavoriteView extends FavoriteItem {
  /** 价格变动方向：down 降价 / up 涨价 / '' 无变动 */
  price_trend: '' | 'down' | 'up';
}

/** Mock 收藏池（按 §5.2 #19 响应契约结构），就绪后删除 */
const MOCK_LIST: FavoriteItem[] = [
  { product_id: 101, title: '九成新《高等数学（第七版）》上册', price: 10, fav_price: 15, status: 'on_sale', price_changed: true },
  { product_id: 102, title: 'iPad 2021 64G 深空灰', price: 1900, fav_price: 1700, status: 'on_sale', price_changed: true },
  { product_id: 103, title: '宿舍用小冰箱 50L', price: 150, fav_price: 150, status: 'sold', price_changed: false },
  { product_id: 104, title: '羽毛球拍一副（尤尼克斯）', price: 60, fav_price: 60, status: 'off_shelf', price_changed: false },
];

Page({
  data: {
    loading: true,
    error: '',
    list: [] as FavoriteView[],
  },

  onLoad() {
    this.loadList();
  },

  onPullDownRefresh() {
    this.loadList(() => wx.stopPullDownRefresh());
  },

  /** 加载收藏列表（§5.2 #19） */
  loadList(done?: () => void) {
    this.setData({ loading: true, error: '' });

    if (USE_MOCK) {
      setTimeout(() => {
        this.setData({ list: MOCK_LIST.map((item) => this.toView(item)), loading: false });
        if (done) done();
      }, 300);
      return;
    }

    listFavorites()
      .then((res) => {
        this.setData({ list: res.list.map((item) => this.toView(item)), loading: false });
        if (done) done();
      })
      .catch((err: Error) => {
        this.setData({ error: err.message, loading: false });
        if (done) done();
      });
  },

  /** 补充价格变动方向展示字段 */
  toView(item: FavoriteItem): FavoriteView {
    let price_trend: FavoriteView['price_trend'] = '';
    if (item.price < item.fav_price) price_trend = 'down';
    else if (item.price > item.fav_price) price_trend = 'up';
    return { ...item, price_trend };
  },

  /** 点击条目跳商品详情 */
  onItemTap(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id);
    wx.navigateTo({ url: `/pages/product-detail/product-detail?id=${id}` });
  },

  /** 长按取消收藏（F8-AC1：confirm 后移除并刷新；§5.2 #18） */
  onItemLongPress(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id);
    wx.showModal({
      title: '取消收藏',
      content: '取消收藏？',
      success: (res) => {
        if (!res.confirm) return;
        if (USE_MOCK) {
          const idx = MOCK_LIST.findIndex((i) => i.product_id === id);
          if (idx >= 0) MOCK_LIST.splice(idx, 1);
          this.setData({ list: this.data.list.filter((i) => i.product_id !== id) });
          wx.showToast({ title: '已取消收藏', icon: 'none' });
          return;
        }
        removeFavorite(id)
          .then(() => {
            this.setData({ list: this.data.list.filter((i) => i.product_id !== id) });
            wx.showToast({ title: '已取消收藏', icon: 'none' });
          })
          .catch((err: Error) => wx.showToast({ title: err.message, icon: 'none' }));
      },
    });
  },

  onRetry() {
    this.loadList();
  },
});
