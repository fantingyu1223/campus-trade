/**
 * services/api/product.ts —— product 商品分组接口封装。
 * @api §5.2 product 分组（#10 POST /products 发布 / #12 POST /products/{id}/offline 下架 /
 *      #13 POST /products/{id}/sold 标记已售 / #14 GET /products/{id} 详情 /
 *      #15 GET /products 列表搜索筛选 / #16 GET /products/mine 我的商品）
 * 字段结构对齐 §4.8 product 表（condition_level / trade_mode / meet_location / is_urgent）。
 * 复用 auth.ts 导出的通用 request 与 BASE_URL；统一响应包络由 request 解析。
 *
 * 契约偏离说明（待后端确认）：
 * 1. relistProduct：§5.2 无「重新上架」接口，此处按 POST /products/{id}/relist 占位封装。
 * 2. getBuyerCandidates：§5.2 无买家候选接口（F7 标记已售须指定买家，候选预期来自会话），
 *    此处按 GET /products/{id}/buyer-candidates 占位封装。
 * 3. role_filter 契约值为 student/teacher/merchant，U7 身份过滤「个人闲置」为前端聚合值
 *    person（= 非商家），需契约扩展确认。
 */
import { request } from './auth';
import { PageResult } from '../../types/contract';

// ---------- 类型定义（对齐 §4.8 / §5.2） ----------
/** 成色五档（§4.8 product.condition_level） */
export type ConditionLevel = 'new' | 'like_new' | 'good' | 'fair' | 'poor';
/** 身份过滤（契约 student/teacher/merchant；person 为前端聚合值，见头注释偏离 3） */
export type RoleFilter = 'student' | 'teacher' | 'merchant' | 'person';
/** 排序（§5.2 #15 sort 枚举） */
export type ProductSort = 'new' | 'price_asc' | 'price_desc';
/** 商品状态（§4.8 status / types/contract ProductStatus） */
export type ProductStatusStr = 'on_sale' | 'off_sale' | 'trading' | 'sold';
/** 交易方式（§4.8 trade_mode） */
export type TradeMode = 'meet' | 'online' | 'both';

/** 列表项（§5.2 #15 响应 list 结构） */
export interface ProductListItem {
  id: number;
  title: string;
  price: number;
  cover: string;
  is_urgent: boolean;
  condition_level: ConditionLevel;
  status: ProductStatusStr;
  seller_role: string;
  seller_nickname?: string;
}

/** 详情（§5.2 #14 响应结构） */
export interface ProductDetailResult {
  product: {
    id: number;
    title: string;
    description: string;
    price: number;
    original_price?: number;
    condition_level: ConditionLevel;
    trade_mode: TradeMode;
    meet_location: string;
    images: string[];
    status: ProductStatusStr;
    is_urgent: boolean;
    published_at?: string;
  };
  seller: {
    id: number;
    nickname: string;
    avatar?: string;
    credit_score: number;
    identity_type: string;
  };
  is_favorited: boolean;
}

/** 发布入参（§5.2 #10；desc 对应表字段 description） */
export interface PublishPayload {
  title: string;
  desc: string;
  price: number;
  category_id: number;
  images: string[];
  stock: number;
  is_urgent: boolean;
  trade_point: string;
  condition_level: ConditionLevel;
  trade_mode: TradeMode;
}

export interface PublishResult {
  product_id: number;
  status: 'on_sale' | 'audit_pending';
}

/** 买家候选（F7 标记已售指定买家；契约偏离 2，占位结构） */
export interface BuyerCandidate {
  id: number;
  nickname: string;
  avatar?: string;
}

// ---------- #15 GET /products 列表 / 搜索 / 筛选（F6/F10a） ----------
export interface ProductListQuery {
  keyword?: string;
  category_id?: number;
  min_price?: number;
  max_price?: number;
  condition_level?: ConditionLevel;
  role_filter?: RoleFilter;
  exclude_sold?: number;
  sort?: ProductSort;
  urgent_only?: number;
  page?: number;
  pageSize?: number;
}

export function listProducts(query: ProductListQuery): Promise<PageResult<ProductListItem>> {
  return request<PageResult<ProductListItem>>({
    url: '/products',
    method: 'GET',
    data: query as Record<string, unknown>,
    auth: false,
  });
}

// ---------- #14 GET /products/{id} 商品详情 ----------
export function getProductDetail(id: number): Promise<ProductDetailResult> {
  return request<ProductDetailResult>({ url: `/products/${id}`, method: 'GET', auth: false });
}

// ---------- #10 POST /products 发布商品（F5） ----------
export function publishProduct(payload: PublishPayload): Promise<PublishResult> {
  return request<PublishResult>({ url: '/products', method: 'POST', data: payload as unknown as Record<string, unknown> });
}

// ---------- #12 POST /products/{id}/offline 下架（F7） ----------
export function offlineProduct(id: number, reason?: string): Promise<{ status: string }> {
  return request<{ status: string }>({
    url: `/products/${id}/offline`,
    method: 'POST',
    data: reason ? { reason } : {},
  });
}

// ---------- 重新上架（F7；契约偏离 1，占位封装） ----------
export function relistProduct(id: number): Promise<{ status: string }> {
  return request<{ status: string }>({ url: `/products/${id}/relist`, method: 'POST' });
}

// ---------- #13 POST /products/{id}/sold 标记已售（F7，须指定买家） ----------
export function markSold(id: number, buyerId: number): Promise<{ order_id: number }> {
  return request<{ order_id: number }>({
    url: `/products/${id}/sold`,
    method: 'POST',
    data: { buyer_id: buyerId },
  });
}

// ---------- #16 GET /products/mine 我的商品（F7） ----------
export function myProducts(
  status: 'on_sale' | 'off_sale' | 'sold',
  page = 1,
  pageSize = 20,
): Promise<PageResult<ProductListItem>> {
  return request<PageResult<ProductListItem>>({
    url: '/products/mine',
    method: 'GET',
    data: { status, page, pageSize },
  });
}

// ---------- 买家候选（F7 标记已售；契约偏离 2，占位封装） ----------
export function getBuyerCandidates(productId: number): Promise<BuyerCandidate[]> {
  return request<BuyerCandidate[]>({ url: `/products/${productId}/buyer-candidates`, method: 'GET' });
}
