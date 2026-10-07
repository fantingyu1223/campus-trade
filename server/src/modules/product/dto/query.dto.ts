/**
 * query.dto.ts —— 商品列表查询参数与列表项/详情响应类型
 *
 * @model PIM-AG-03 商品聚合（检索读模型）
 * @api §5.2 #14 GET /products/{id}、#15 GET /products
 *
 * 纪律：本文件仅限类型声明（契约形状），禁止任何逻辑函数。
 * 实名信息（student_no/license/openid/unionid/real_name）不属于本 DTO 任何字段，
 * 详情 seller 仅暴露身份标识（identity_type / is_merchant，@rule CIM-R-28）。
 */

/** 排序枚举（§5.2 #15）：new 最新 / price_asc 价格升 / price_desc 价格降 */
export type ProductSort = 'new' | 'price_asc' | 'price_desc';

/** 身份过滤枚举（F6-AC2 / F33 联动）：personal 个人闲置 / merchant 认证商家 */
export type RoleFilter = 'personal' | 'merchant';

/** 成色枚举（与 schema ConditionLevel 一致） */
export type ConditionLevel = 'new' | 'like_new' | 'good' | 'fair' | 'poor';

/** GET /products 原始查询参数（全部可选，字符串形态，service 层校验归一化） */
export interface ProductListRawQuery {
  keyword?: string;
  category_id?: string;
  min_price?: string;
  max_price?: string;
  condition?: string;
  role_filter?: string;
  exclude_sold?: string;
  sort?: string;
  urgent_only?: string;
  page?: string;
  pageSize?: string;
}

/** 校验归一化后的查询参数（service 内部使用） */
export interface ProductListQuery {
  keyword: string | null;
  categoryId: bigint | null;
  minPrice: string | null;
  maxPrice: string | null;
  condition: ConditionLevel | null;
  roleFilter: RoleFilter | null;
  excludeSold: boolean;
  sort: ProductSort;
  urgentOnly: boolean;
  page: number;
  pageSize: number;
}

/** 列表项（§5.2 #15 契约字段：id/title/price/cover/is_urgent/seller_role） */
export interface ProductListItem {
  id: string;
  title: string;
  price: string;
  /** 首图（sort_order=0）URL，无图时为 null */
  cover: string | null;
  is_urgent: boolean;
  /** 卖家身份标识（user.identity_type 派生；卖家缺失兜底 'guest'） */
  seller_role: string;
}

/** 列表分页响应 */
export interface ProductListResult {
  list: ProductListItem[];
  total: number;
  page: number;
  pageSize: number;
}

/** 详情页卖家身份标识（@rule CIM-R-28：is_merchant 由 identity_type 派生，不可关闭；实名不出站） */
export interface ProductSellerBrief {
  id: string;
  nickname: string;
  identity_type: string;
  is_merchant: boolean;
}

/** 商品详情响应（§5.2 #14） */
export interface ProductDetailResponse {
  id: string;
  title: string;
  desc: string;
  price: string;
  original_price: string | null;
  condition: string;
  trade_mode: string;
  meet_location: string | null;
  available_time: string | null;
  status: string;
  is_urgent: boolean;
  category_id: string;
  view_count: number;
  favorite_count: number;
  published_at: string | null;
  /** 全部图片 URL，按 sort_order 升序（0=首图） */
  images: string[];
  seller: ProductSellerBrief;
}
