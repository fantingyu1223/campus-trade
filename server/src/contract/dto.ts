/**
 * contract/dto.ts —— API 通用结构声明（docs/design §5.1 通用约定）。
 *
 * 纪律：本层仅限声明（type/interface），禁止任何逻辑函数。
 * 具体业务 DTO 由各模块自含（§3.1 自给自足规则），本文件只放跨模块通用结构。
 */

/**
 * 统一响应包络。
 * code=0 表示成功；HTTP 状态码仅表达传输层语义，业务判定一律以 code 为准。
 * 失败时 data 为 null（chat 发消息命中风险词等特殊场景除外，见 §5.2 #27）。
 */
export interface ApiResponse<T> {
  /** 业务错误码，取值见 contract/error-codes.ts */
  code: number;
  /** 人类可读信息，失败时为可直接展示给用户的提示 */
  message: string;
  /** 成功时的业务数据，失败时为 null */
  data: T | null;
}

/**
 * 分页请求参数（所有列表接口统一）。
 * page 默认 1；pageSize 默认 20、上限 50。
 */
export interface PageQuery {
  page?: number;
  pageSize?: number;
}

/**
 * 分页响应结构（所有列表接口统一）。
 */
export interface PageResult<T> {
  page: number;
  pageSize: number;
  total: number;
  list: T[];
}

/**
 * 游标式深分页请求（聊天记录等），以 before_id 向更早方向翻页。
 */
export interface CursorPageQuery {
  beforeId?: number;
  pageSize?: number;
}

/**
 * 游标式深分页响应：不返回 total，改返回 has_more。
 */
export interface CursorPageResult<T> {
  list: T[];
  hasMore: boolean;
}
