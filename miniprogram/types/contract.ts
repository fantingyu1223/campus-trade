/**
 * ★ 由 server/src/contract 同步（enums.ts + error-codes.ts + dto.ts 拼接拷贝）。
 * 仅声明，勿手改：任何修改必须改 server/src/contract 后重新同步；
 * 一致性由 server/test/contract/contract-sync.spec.ts 强制校验。
 */

/**
 * contract/enums.ts —— 全部状态枚举的唯一事实源（docs/design §3.3「枚举集中」）。
 *
 * 纪律：本层仅限声明（enum/type/const），禁止任何逻辑函数。
 * 每个枚举以 @model 标注对应的 PIM 状态机/聚合编号（见 Modeling/traceability.md 主表）。
 * 枚举取值与 docs/design §4 各表 VARCHAR(32) 枚举注释保持一致；前端两处
 * types/contract.ts 为本文件的拷贝同步，由 test/contract/contract-sync.spec.ts 校验。
 */

// ==================== 用户 / 认证 ====================

/**
 * 用户身份类型（user.identity_type）。
 * 升级路径：guest → student/staff → merchant（F1/F32/F33 亮标）。
 * @model PIM-AG-01 账号与认证聚合
 */
export enum UserIdentityType {
  GUEST = 'guest',
  STUDENT = 'student',
  STAFF = 'staff',
  MERCHANT = 'merchant',
}

/**
 * 用户账号状态（user.status，F21/F26/F27）。
 * @model PIM-AG-01 账号与认证聚合
 */
export enum UserStatus {
  NORMAL = 'normal',
  BANNED = 'banned',
  READONLY = 'readonly',
  CLEARANCE = 'clearance',
  CANCELLED = 'cancelled',
}

/**
 * 实名/校园认证方式（identity_verification.verify_type，F1）。
 * @model PIM-AG-01 账号与认证聚合
 */
export enum VerifyType {
  STUDENT_NO = 'student_no',
  CAMPUS_EMAIL = 'campus_email',
}

/**
 * 认证审核状态（identity_verification.status，F1）。
 * @model PIM-AG-01 账号与认证聚合
 */
export enum VerificationStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

// ==================== 商品 / 求购 ====================

/**
 * 商品状态（product.status，F5-F7）。
 * on_sale 上架 / off_sale 下架 / trading 交易中（锁定防超卖）/ sold 已售（终态，须指定买家）。
 * @model PIM-SM-02 商品状态机（PIM-AG-03）
 */
export enum ProductStatus {
  ON_SALE = 'on_sale',
  OFF_SALE = 'off_sale',
  TRADING = 'trading',
  SOLD = 'sold',
}

/**
 * 求购状态（want_buy.status，F9；30 天有效期，终态不可复活）。
 * @model PIM-SM-03 求购状态机（PIM-AG-04）
 */
export enum WantBuyStatus {
  ACTIVE = 'active',
  CLOSED = 'closed',
  BOUGHT = 'bought',
  EXPIRED = 'expired',
}

// ==================== 订单（五态 + 取消子状态） ====================

/**
 * 订单五态（trade_order.status，F34/F35）。
 * 流转：pending_delivery → pending_confirm → completed；
 * 前两态可转 cancelled；未终态可转 appealing（申诉中，结案后恢复原态）。
 * 终态：completed（不可逆，裁决 8）/ cancelled。
 * @model PIM-SM-01 订单状态机（PIM-AG-06）
 */
export enum OrderStatus {
  PENDING_DELIVERY = 'pending_delivery',
  PENDING_CONFIRM = 'pending_confirm',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  APPEALING = 'appealing',
}

/**
 * 订单取消子状态（trade_order cancel_* 字段组，F35；24h 响应时限，超时自动同意）。
 * 非独立主状态，仅描述主状态内部的取消协商进度。
 * @model PIM-SM-01 订单状态机·取消请求子状态（PIM-AG-06）
 */
export enum OrderCancelStatus {
  NONE = 'none',
  REQUESTED = 'requested',
  REJECTED = 'rejected',
  AGREED = 'agreed',
}

// ==================== 评价 ====================

/**
 * 评价生命周期/可见性（review 表 is_public/is_default 与延迟公开规则，F17）。
 * not_available 不可评 / available 可评 / one_sided_pending 单方已评待公开 /
 * frozen 入口冻结（订单申诉中，裁决 8）/ published 已公开（终态）。
 * @model PIM-SM-05 评价生命周期状态机（PIM-AG-07）
 */
export enum ReviewVisibility {
  NOT_AVAILABLE = 'not_available',
  AVAILABLE = 'available',
  ONE_SIDED_PENDING = 'one_sided_pending',
  FROZEN = 'frozen',
  PUBLISHED = 'published',
}

// ==================== 举报 ====================

/**
 * 举报对象类型（report.target_type，F18）。
 * @model PIM-AG-08 举报聚合
 */
export enum ReportTargetType {
  PRODUCT = 'product',
  USER = 'user',
  MERCHANT = 'merchant',
  CHAT = 'chat',
}

/**
 * 举报分类（report.category，F18）。
 * @model PIM-AG-08 举报聚合
 */
export enum ReportCategory {
  FRAUD = 'fraud',
  PROHIBITED = 'prohibited',
  FALSE_DESC = 'false_desc',
  OTHER = 'other',
}

/**
 * 举报处理状态（report.status，F20 队列）。
 * @model PIM-AG-08 举报聚合
 */
export enum ReportStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  RESOLVED = 'resolved',
}

/**
 * 举报处置结果（report.result，F20/F21）。
 * @model PIM-AG-08 举报聚合（DisposalResult）
 */
export enum ReportResult {
  OFF_SHELF = 'off_shelf',
  WARNING = 'warning',
  BAN = 'ban',
  REJECTED = 'rejected',
}

/**
 * 举报 SLA 分级（report.sla_level，F20：urgent 4h / high 24h / normal 48h）。
 * @model PIM-AG-08 举报聚合（SlaDeadline）
 */
export enum ReportSlaLevel {
  URGENT = 'urgent',
  HIGH = 'high',
  NORMAL = 'normal',
}

// ==================== 申诉 ====================

/**
 * 申诉类型（appeal.appeal_type，F30 交易纠纷 / F31 处罚申诉）。
 * @model PIM-AG-09 申诉聚合
 */
export enum AppealType {
  DISPUTE = 'dispute',
  PUNISHMENT = 'punishment',
}

/**
 * 申诉状态（appeal.status；48h 介入时限，超有效期仅可查看）。
 * @model PIM-AG-09 申诉聚合
 */
export enum AppealStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  RESOLVED = 'resolved',
  EXPIRED = 'expired',
}

/**
 * 申诉裁决结果（appeal.result，F30/F31）。
 * @model PIM-AG-09 申诉聚合
 */
export enum AppealResult {
  SUPPORT = 'support',
  REJECT = 'reject',
  PARTIAL = 'partial',
}

// ==================== 商家入驻 ====================

/**
 * 商家入驻申请状态（merchant_application.status，F32）。
 * cancelled=用户撤回（终态，PSM-INC-03 裁决）；「审核中」不单列枚举，由操作日志承载。
 * @model PIM-SM-04 商家入驻申请状态机（PIM-AG-10）
 */
export enum MerchantApplicationStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  CANCELLED = 'cancelled',
}

/**
 * 商家入驻驳回理由码（merchant_application.reject_reason_code，§8.5 八枚举）。
 * @model PIM-AG-10 商家入驻申请聚合
 */
export enum MerchantRejectReasonCode {
  LICENSE_INVALID = 'license_invalid',
  LICENSE_UNCLEAR = 'license_unclear',
  INFO_MISMATCH = 'info_mismatch',
  SHOP_PROOF_MISSING = 'shop_proof_missing',
  DUPLICATE_SHOP = 'duplicate_shop',
  BLACKLISTED = 'blacklisted',
  SCOPE_NOT_ALLOWED = 'scope_not_allowed',
  OTHER = 'other',
}

// ==================== 通知 ====================

/**
 * 站内通知类型（notification.type，F15；payload 按 type 解析路由）。
 * @model PIM-BC-06 通知触达（消费 PIM-EV-01~15）
 */
export enum NotificationType {
  NEW_MESSAGE = 'new_message',
  PRICE_CHANGE = 'price_change',
  WANT_BUY_MATCH = 'want_buy_match',
  ORDER_STATUS = 'order_status',
  REPORT_RESULT = 'report_result',
  APPEAL_RESULT = 'appeal_result',
  REVIEW_REMIND = 'review_remind',
  WANT_BUY_EXPIRE = 'want_buy_expire',
}

// ==================== 词表 / 风险 ====================

/**
 * 词库类型（word_list.type，F13 风险词 / F22 违规词 / 违禁品词）。
 * @model PIM-BC-06 词表管理（word_list 表）
 */
export enum WordListType {
  RISK = 'risk',
  VIOLATION = 'violation',
  PROHIBITED = 'prohibited',
}

/**
 * 风险级别（word_list.level、message_risk_log.level，F13/F22）。
 * high 拦截 / mid 留痕或打码 / low 仅提示。
 * @model PIM-AG-05 会话聚合（RiskWordHit）
 */
export enum RiskLevel {
  HIGH = 'high',
  MID = 'mid',
  LOW = 'low',
}

/**
 * 词表词条状态（word_list.status；停用不删除以便追溯）。
 * @model PIM-BC-06 词表管理（word_list 表）
 */
export enum WordListStatus {
  ACTIVE = 'active',
  DISABLED = 'disabled',
}

/**
 * contract/error-codes.ts —— 业务错误码常量（docs/design §5.1 错误码分段）。
 *
 * 纪律：本层仅限声明（const 对象），禁止任何逻辑函数。
 * 分段约定：0 成功；1xxx 认证/权限；2xxx 商品；3xxx 沟通；4xxx 订单交易；
 * 5xxx 评价/举报/申诉；6xxx 后台管理；9xxx 系统。
 * §5.3 后台接口表中按接口列出的错误码（如 2001/4002）一律映射到本分段后使用，
 * 同一码值全站语义唯一，禁止在不同模块复用同一数值表达不同含义。
 */
export const ERROR_CODES = {
  // ---------- 0：成功 ----------
  /** 成功 */
  SUCCESS: 0,

  // ---------- 1xxx：认证 / 权限 ----------
  /** 未登录 / token 无效 */
  AUTH_TOKEN_INVALID: 1001,
  /** token 过期 */
  AUTH_TOKEN_EXPIRED: 1002,
  /** 无权限 */
  PERMISSION_DENIED: 1003,
  /** 未通过实名认证 */
  NOT_VERIFIED: 1004,
  /** 用户已被禁用 */
  USER_DISABLED: 1005,
  /** 学校未开放 / 加入申请被拒绝 */
  SCHOOL_NOT_OPEN: 1006,

  // ---------- 2xxx：商品 ----------
  /** 商品不存在 */
  PRODUCT_NOT_FOUND: 2001,
  /** 商品已下架 / 已售 */
  PRODUCT_OFF_SHELF: 2002,
  /** 急出打标超出 3 件上限 */
  URGENT_LIMIT_EXCEEDED: 2003,
  /** 图片数量 / 格式不合规 */
  IMAGE_INVALID: 2004,
  /** 库存不足 */
  STOCK_INSUFFICIENT: 2005,

  // ---------- 3xxx：沟通 ----------
  /** 会话不存在 */
  CONVERSATION_NOT_FOUND: 3001,
  /** 消息命中风险词需确认（data 仍返回风险详情） */
  RISK_WORD_HIT: 3002,
  /** 被拉黑无法发起会话 */
  BLOCKED_BY_PEER: 3003,
  /** 意向卡片状态冲突 */
  INTENT_STATUS_CONFLICT: 3004,

  // ---------- 4xxx：订单交易 ----------
  /** 订单不存在 */
  ORDER_NOT_FOUND: 4001,
  /** 订单状态不允许该操作 */
  ORDER_STATUS_CONFLICT: 4002,
  /** 锁单失败（已被他人锁定） */
  ORDER_LOCK_FAILED: 4003,
  /** 取消响应超时 */
  CANCEL_RESPOND_TIMEOUT: 4004,
  /** 现场拒收缺少时间或说明 */
  REJECT_ONSITE_INFO_MISSING: 4005,

  // ---------- 5xxx：评价 / 举报 / 申诉 ----------
  /** 订单不可评价 */
  ORDER_NOT_REVIEWABLE: 5001,
  /** 重复评价 */
  DUPLICATE_REVIEW: 5002,
  /** 举报类型 / 证据缺失 */
  REPORT_EVIDENCE_MISSING: 5003,
  /** 申诉不成立条件（无对应处罚记录） */
  APPEAL_GROUNDLESS: 5004,

  // ---------- 6xxx：后台管理 ----------
  /** 管理员无权限 */
  ADMIN_PERMISSION_DENIED: 6001,
  /** 审核任务不存在 / 已被处理 */
  AUDIT_TASK_NOT_FOUND: 6002,

  // ---------- 9xxx：系统 ----------
  /** 参数校验失败 */
  PARAM_VALIDATION_FAILED: 9001,
  /** 频率限制 */
  RATE_LIMITED: 9002,
  /** 系统内部错误 */
  INTERNAL_ERROR: 9999,
} as const;

/** 错误码值联合类型（0 | 1001 | ... | 9999） */
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** 错误码常量名联合类型 */
export type ErrorCodeName = keyof typeof ERROR_CODES;

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
