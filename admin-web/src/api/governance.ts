/**
 * @api §5.3 治理分组（docs/design/2026-02-06-技术选型与总体方案.md）：
 *   report 举报处置 #54-56（F20/F21）、violation 风控拦截复核 #57-58（F22，预留）、
 *   risk-warning 黄牛预警 #59-60（F23）、merchant-review 卖家入驻审核 #61-64（F32）
 * @module PIM-BC-05
 *
 * 后台治理接口封装。baseURL=/admin/v1，封装风格与 api/school.ts 一致。
 * 业务 DTO 按契约「模块自含」原则在本文件声明；通用包络/分页结构引自 types/contract.ts。
 *
 * TODO(登录未就绪)：同 school.ts，JWT 暂从 localStorage('admin_token') 读取。
 *
 * 与契约的偏差记录（联调时需后端确认）：
 *  1. #54 列表契约未声明 created_at/status 字段，页面需展示「提交时间/状态」列，
 *     本文件按可选字段声明（created_at?/status?），以后端实际返回为准。
 *  2. #54 查询参数仅支持 status+分页，「对象类型」筛选由前端在当前页数据过滤。
 *  3. #60 conclusion 枚举仅 release/limit_publish/action；PRD A7「转商家入驻线索」
 *     无独立枚举，暂映射为 limit_publish（限发并转入驻核查线索，依据 §4.25 表注）。
 *  4. #64 reason_code 为数值 1-8，与 types/contract.ts MerchantRejectReasonCode
 *     字符串枚举语义不一致（契约两处口径冲突），本文件按 #64 接口表数值口径实现。
 */
import type { ApiResponse, PageQuery, PageResult } from '../types/contract';

const BASE_URL = '/admin/v1';

// ---------- 举报处置（#54-56） ----------

/** #54 队列状态筛选口径：pending/processing/done */
export type ReportQueueStatus = 'pending' | 'processing' | 'done';

/** 举报对象类型（report.target_type） */
export type ReportTargetType = 'product' | 'user' | 'merchant' | 'chat';

/** #54 list 项：{id, target_type, reason, evidence_count, sla_deadline, sla_remaining_sec, sla_overdue, handler} */
export interface ReportItem {
  id: number;
  target_type: ReportTargetType;
  reason: string;
  evidence_count: number;
  /** SLA 截止时间（ISO） */
  sla_deadline: string;
  /** 服务端计算的剩余秒数 */
  sla_remaining_sec: number;
  sla_overdue: boolean;
  /** 处理人（未认领为空） */
  handler: string | null;
  /** 偏差说明见文件头 1：列表契约未声明，按可选声明 */
  created_at?: string;
  status?: ReportQueueStatus;
}

/** #55 详情时间线条目（处置留痕） */
export interface ReportTimelineItem {
  time: string;
  operator?: string;
  action: string;
  note?: string;
}

/** #55 report{...}（举报人匿名，不含 reporter 身份） */
export interface ReportDetail {
  id: number;
  target_type: ReportTargetType;
  /** 被举报对象快照（商品/用户/会话等，结构由后端给出） */
  target_snapshot: Record<string, unknown> | null;
  reason: string;
  description: string;
  evidence_urls: string[];
  status: ReportQueueStatus;
  timeline: ReportTimelineItem[];
  sla_deadline: string;
  sla_overdue: boolean;
  created_at?: string;
}

/** #56 处置结果严格枚举：下架/警告/封禁/驳回（禁止自由文本） */
export type DisposalResult = 'off_shelf' | 'warning' | 'ban' | 'rejected';

export interface DisposalPayload {
  result: DisposalResult;
  note: string;
  /** result=ban 时必填 */
  duration_days?: number;
}

export interface ReportListQuery extends PageQuery {
  status?: ReportQueueStatus;
}

// ---------- 黄牛预警（#59-60） ----------

/** §4.25 rule_code：daily_ge5 日发≥5件 / cross_ge3_cat 跨≥3类目 / suspected_merchant 疑似伪装商家 */
export type RiskRuleType = 'daily_ge5' | 'cross_ge3_cat' | 'suspected_merchant';

export type RiskWarningStatus = 'pending' | 'handled';

/** #59 list 项：{id, user_masked, rule_type, evidence{...}, status, created_at} */
export interface RiskWarningItem {
  id: number;
  user_masked: string;
  rule_type: RiskRuleType;
  evidence: Record<string, unknown> | null;
  status: RiskWarningStatus;
  created_at: string;
  /** handled 时后端返回的复核结论（契约未在 list 项声明，可选） */
  conclusion?: RiskReviewConclusion;
}

/** #60 复核结论枚举 */
export type RiskReviewConclusion = 'release' | 'limit_publish' | 'action';

export interface RiskReviewPayload {
  conclusion: RiskReviewConclusion;
  /** conclusion=action 时必填：warning/ban */
  action_detail?: 'warning' | 'ban';
  limit_days?: number;
}

export interface RiskWarningListQuery extends PageQuery {
  status?: RiskWarningStatus;
  rule_type?: RiskRuleType;
}

// ---------- 商家入驻审核（#61-64） ----------

export type MerchantReviewStatus = 'pending' | 'approved' | 'rejected';

/** #61 list 项：{id, applicant_masked, submitted_at, sla_deadline, sla_remaining_sec, sla_overdue} */
export interface MerchantReviewItem {
  id: number;
  applicant_masked: string;
  submitted_at: string;
  sla_deadline: string;
  sla_remaining_sec: number;
  sla_overdue: boolean;
  status?: MerchantReviewStatus;
}

/** #62 application{materials{...}, history[], sla_deadline, sla_overdue} */
export interface MerchantReviewDetail {
  id: number;
  materials: {
    real_name: string;
    id_card_urls: string[];
    credential_urls: string[];
  };
  history: Array<{ time: string; operator?: string; action: string; note?: string }>;
  sla_deadline: string;
  sla_overdue: boolean;
  status: MerchantReviewStatus;
}

/** #64 驳回理由码 1-8（数值口径，见文件头偏差说明 4） */
export type MerchantRejectReasonCode = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface MerchantReviewListQuery extends PageQuery {
  status?: MerchantReviewStatus;
}

// ---------- 风控拦截复核（#57-58，预留，A 页未含） ----------

export type ViolationScene = 'publish' | 'modify' | 'chat';
export type ViolationStatus = 'pending' | 'confirmed' | 'false_positive';

export interface ViolationItem {
  id: number;
  scene: ViolationScene;
  user_masked: string;
  hit_word: string;
  hit_word_list: string;
  content_snapshot: string;
  status: ViolationStatus;
  created_at: string;
}

export interface ViolationListQuery extends PageQuery {
  scene?: ViolationScene;
  status?: ViolationStatus;
}

// ---------- 请求封装（与 school.ts 同款） ----------

function authHeaders(): Record<string, string> {
  // TODO(登录未就绪)：token 占位，后台登录页完成后改从 auth store 获取
  const token = localStorage.getItem('admin_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(
  path: string,
  options: { method?: string; query?: Record<string, unknown>; body?: unknown } = {},
): Promise<T> {
  const url = new URL(BASE_URL + path, window.location.origin);
  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }
  const resp = await fetch(url.toString(), {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const envelope = (await resp.json()) as ApiResponse<T>;
  // 业务判定以 code 为准（§5.1 通用约定）
  if (!resp.ok || envelope.code !== 0) {
    throw new Error(envelope.message || `请求失败（code=${envelope.code}）`);
  }
  return envelope.data as T;
}

// ---------- 举报处置接口 ----------

/** #54 GET /admin/v1/reports 举报队列（按 SLA 剩余时限升序） */
export function listReports(query: ReportListQuery): Promise<PageResult<ReportItem>> {
  return request<PageResult<ReportItem>>('/reports', { query: { ...query } });
}

/** #55 GET /admin/v1/reports/{id} 举报详情（匿名化） */
export function getReport(id: number): Promise<{ report: ReportDetail }> {
  return request<{ report: ReportDetail }>(`/reports/${id}`);
}

/** #56 POST /admin/v1/reports/{id}/action 处置提交（4002 result 非法/状态冲突） */
export function submitDisposal(
  id: number,
  payload: DisposalPayload,
): Promise<{ report: { status: ReportQueueStatus; result: DisposalResult } }> {
  return request(`/reports/${id}/action`, { method: 'POST', body: payload });
}

// ---------- 黄牛预警接口 ----------

/** #59 GET /admin/v1/risk-warnings 黄牛预警列表 */
export function listRiskWarnings(
  query: RiskWarningListQuery,
): Promise<PageResult<RiskWarningItem>> {
  return request<PageResult<RiskWarningItem>>('/risk-warnings', { query: { ...query } });
}

/** #60 POST /admin/v1/risk-warnings/{id}/review 复核结论（4002） */
export function reviewRiskWarning(
  id: number,
  payload: RiskReviewPayload,
): Promise<{ warning: { status: RiskWarningStatus; conclusion: RiskReviewConclusion } }> {
  return request(`/risk-warnings/${id}/review`, { method: 'POST', body: payload });
}

// ---------- 商家入驻审核接口 ----------

/** #61 GET /admin/v1/merchant-reviews 待审列表（2 个工作日 SLA 倒计时） */
export function listMerchantReviews(
  query: MerchantReviewListQuery,
): Promise<PageResult<MerchantReviewItem>> {
  return request<PageResult<MerchantReviewItem>>('/merchant-reviews', { query: { ...query } });
}

/** #62 GET /admin/v1/merchant-reviews/{id} 审核详情（资质调阅，留痕） */
export function getMerchantReview(id: number): Promise<{ application: MerchantReviewDetail }> {
  return request<{ application: MerchantReviewDetail }>(`/merchant-reviews/${id}`);
}

/** #63 POST /admin/v1/merchant-reviews/{id}/approve 通过（4002） */
export function approveMerchant(
  id: number,
  payload: { note?: string } = {},
): Promise<{ application: { status: MerchantReviewStatus } }> {
  return request(`/merchant-reviews/${id}/approve`, { method: 'POST', body: payload });
}

/** #64 POST /admin/v1/merchant-reviews/{id}/reject 驳回（4001 缺 reason_code；reason_code=8 时 note 必填） */
export function rejectMerchant(
  id: number,
  payload: { reason_code: MerchantRejectReasonCode; note?: string },
): Promise<{ application: { status: MerchantReviewStatus; reason_code: MerchantRejectReasonCode } }> {
  return request(`/merchant-reviews/${id}/reject`, { method: 'POST', body: payload });
}

// ---------- 风控拦截复核（#57，预留） ----------

/** #57 GET /admin/v1/violations 拦截记录列表（预留，A 页未含） */
export function listViolations(query: ViolationListQuery): Promise<PageResult<ViolationItem>> {
  return request<PageResult<ViolationItem>>('/violations', { query: { ...query } });
}
