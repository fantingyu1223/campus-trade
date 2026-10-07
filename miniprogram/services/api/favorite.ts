/**
 * services/api/favorite.ts —— favorite 收藏分组接口封装（F8）。
 * @api §5.2 favorite 分组（#17 POST /favorites 收藏 / #18 DELETE /favorites/{product_id} 取消 /
 *      #19 GET /favorites 收藏列表）
 * 复用 auth.ts 导出的通用 request；统一响应包络由 request 解析。
 * @module PIM-BC-05 评价与治理（收藏承接）
 *
 * 契约偏离说明（待契约修订确认）：
 * 1. #19 列表项为 {product_id, title, price, status, price_changed}；U23 需要展示
 *    「收藏时价」与当前价对比，扩展 fav_price 与 cover 字段（price_changed 不足以表达涨/降方向）。
 */
import { request } from './auth';

// ---------- 类型定义（对齐 §5.2 #19；fav_price/cover 见头注释偏离 1） ----------
export type FavoriteProductStatus = 'on_sale' | 'sold' | 'off_shelf';

/** 收藏列表项（#19） */
export interface FavoriteItem {
  product_id: number;
  title: string;
  cover?: string;
  /** 当前价 */
  price: number;
  /** 收藏时价（扩展字段，见头注释偏离 1） */
  fav_price: number;
  status: FavoriteProductStatus;
  price_changed: boolean;
}

export interface FavoriteListResult {
  list: FavoriteItem[];
  has_more: boolean;
}

// ---------- #19 GET /favorites 收藏列表 ----------
export function listFavorites(page = 1, pageSize = 20): Promise<FavoriteListResult> {
  return request<FavoriteListResult>({
    url: '/favorites',
    method: 'GET',
    data: { page, pageSize },
  });
}

// ---------- #18 DELETE /favorites/{product_id} 取消收藏 ----------
export function removeFavorite(productId: number): Promise<void> {
  return request<void>({ url: `/favorites/${productId}`, method: 'DELETE' });
}
