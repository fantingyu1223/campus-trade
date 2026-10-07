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
