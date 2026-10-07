/**
 * publish.dto.ts —— 商品发布入参/出参 DTO（契约 §5.2 #10 POST /products）
 *
 * @model PIM-AG-03 商品聚合
 */

/** 成色档位（PRD F5 枚举） */
export type ConditionLevelValue = 'new' | 'like_new' | 'good' | 'fair' | 'poor';

/** 交易方式枚举 */
export type ProductTradeModeValue = 'meet' | 'online' | 'both';

/** 原始发布请求体（snake_case，与 API 契约一致） */
export interface PublishProductDto {
  title: string;
  desc: string;
  price: string;
  category_id: string;
  images: string[];
  condition: ConditionLevelValue;
  trade_mode: ProductTradeModeValue;
  trade_point?: string;
  available_time?: string;
  original_price?: string;
  is_urgent?: boolean;
  stock?: number;
}

/** 发布成功响应体 */
export interface PublishProductResult {
  product_id: string;
  status: string;
}
