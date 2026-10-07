/**
 * status.dto.ts —— 商品状态管理出参/查询 DTO（下架/重新上架/标记已售/我的商品/买家候选）
 *
 * @model PIM-AG-03 商品聚合
 * @api §5.2 #12 POST /products/{id}/offline、#13 POST /products/{id}/sold、#16 GET /products/mine
 *      补充接口（本批次声明）：POST /products/{id}/relist、GET /products/{id}/buyer-candidates（U13 配套）
 *
 * 纪律：本文件仅限类型声明（契约形状），禁止任何逻辑函数。
 */

/** 下架成功响应体（#12） */
export interface OfflineResult {
  status: string;
}

/** 重新上架成功响应体（补充接口 relist） */
export interface RelistResult {
  status: string;
}

/**
 * 标记已售成功响应体（#13）。
 * 契约 #13 响应关键字段为 order_id（自动生成线下订单）；本批次订单模块未就绪，
 * 口径暂定为 order_id=null 占位（偏离说明见服务层头注释，待订单批次回填）。
 */
export interface MarkSoldResult {
  status: string;
  sold_buyer_id: string;
  /** ISO 8601 时间串 */
  sold_at: string;
  order_id: null;
}

/** 我的商品列表项（#16；id 与时间均为字符串形态，null 表示无） */
export interface MineProductItem {
  id: string;
  title: string;
  price: string;
  status: string;
  is_urgent: boolean;
  published_at: string | null;
  sold_at: string | null;
  off_sale_at: string | null;
  sold_buyer_id: string | null;
}

/** GET /products/mine 带 status 参数时的分页单组响应（契约 #16「分页列表」形状） */
export interface MineListResult {
  list: MineProductItem[];
  total: number;
  page: number;
  pageSize: number;
}

/** GET /products/mine 无 status 参数时的分栏三组响应（在售组=on_sale+trading 合并） */
export interface MineTabsResult {
  on_sale: MineProductItem[];
  sold: MineProductItem[];
  off_sale: MineProductItem[];
}

/** 买家候选项（补充接口 buyer-candidates，U13 配套；仅公开字段，防实名泄漏） */
export interface BuyerCandidateItem {
  buyer_id: string;
  nickname: string;
  conversation_id: string;
  /** ISO 8601 时间串；无消息时为 null */
  last_message_at: string | null;
}
