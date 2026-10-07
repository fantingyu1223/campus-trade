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
