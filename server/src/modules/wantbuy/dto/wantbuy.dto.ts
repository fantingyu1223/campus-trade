/**
 * wantbuy.dto.ts —— 求购模块 DTO 声明（仅类型，无逻辑）
 *
 * @module PIM-BC-02 商品与供给（求购子域）
 * @model PIM-AG-04 求购聚合
 * @api §5.2 #20 POST /want-buys、#24 GET /want-buys、#21 renew、#22 close、#23 bought
 * @ac F9-AC1/F9-AC2/F9-AC3
 */

/** 求购状态值联合（契约 enums.ts WantBuyStatus 的字符串值） */
export type WantBuyStatusValue = 'active' | 'closed' | 'bought' | 'expired';

/** @api §5.2 #20 发布成功响应：id、expire_at（ISO8601） */
export interface PublishWantBuyResult {
  id: string;
  expire_at: string;
}

/** @api §5.2 #21 续期响应：expire_at（重置为 now+30 天，@rule CIM-R-33） */
export interface RenewWantBuyResult {
  expire_at: string;
}

/** @api §5.2 #22 关闭响应：status=closed（终态） */
export interface CloseWantBuyResult {
  status: WantBuyStatusValue;
}

/** @api §5.2 #23 标记已买到响应：status=bought（终态） */
export interface BoughtWantBuyResult {
  status: WantBuyStatusValue;
}

/** GET /want-buys 查询参数（控制器透传的原始字符串形态） */
export interface WantBuyListRawQuery {
  scope?: string;
  keyword?: string;
  category_id?: string;
  page?: string;
  pageSize?: string;
}

/** 列表项：BigInt → string，时间 → ISO 或 null */
export interface WantBuyListItem {
  id: string;
  user_id: string;
  category_id: string;
  title: string;
  description: string | null;
  price_min: string | null;
  price_max: string | null;
  condition_level: string | null;
  status: WantBuyStatusValue;
  expire_at: string;
  renewed_count: number;
  created_at: string;
}

/** @api §5.2 #24 分页列表响应（通用分页包络口径：page/pageSize/total/list） */
export interface WantBuyListResult {
  page: number;
  pageSize: number;
  total: number;
  list: WantBuyListItem[];
}
