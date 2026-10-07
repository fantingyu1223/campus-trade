/**
 * @api §5.3 治理分组扩展：申诉仲裁（F30 纠纷申诉 / F31 处罚申诉裁决）
 * @module PIM-BC-05
 *
 * A8 申诉仲裁页接口封装。baseURL=/admin/v1，封装风格与 api/governance.ts 一致。
 * 业务 DTO 按契约「模块自含」原则在本文件声明；通用包络/分页结构引自 types/contract.ts。
 *
 * TODO(登录未就绪)：JWT 暂从 localStorage('admin_token') 读取。
 *
 * 与契约的偏差记录（联调时需后端确认）：
 *  1. docs/design §5.3 未列申诉仲裁接口编号，端点按治理分组命名习惯拟定为
 *     /admin/v1/appeals（GET 列表 / GET {id} / POST {id}/adjudicate），待后端落契约。
 *  2. intervene_deadline（48h 介入时限）由后端返回 ISO 时间，超时判定前端计算。
 *  3. linked_action（可选关联处置）复用举报处置枚举 off_shelf/warning/ban/rejected，'无' 不传。
 */
import type { ApiResponse, PageQuery, PageResult } from '../types/contract';

const BASE_URL = '/admin/v1';

// ---------- 申诉仲裁（A8） ----------

/** 申诉类型：dispute 纠纷申诉（F30）/ punishment 处罚申诉（F31） */
export type AppealType = 'dispute' | 'punishment';

export type AppealStatus = 'pending' | 'processing' | 'done';

/** list 项：{id, type, related_no, submitted_at, intervene_deadline, status} */
export interface AppealItem {
  id: number;
  type: AppealType;
  /** 关联单号（订单号或举报号/处罚记录号） */
  related_no: string;
  submitted_at: string;
  /** 48h 平台介入截止时间（ISO），超时标红 */
  intervene_deadline: string;
  status: AppealStatus;
}

/** 详情：申诉理由/证据图/关联上下文/聊天摘要 */
export interface AppealDetail {
  id: number;
  type: AppealType;
  related_no: string;
  reason: string;
  evidence_urls: string[];
  /** 关联上下文（订单号或举报号等，结构由后端给出） */
  context: Record<string, unknown> | null;
  /** 双方聊天摘要（占位字段） */
  chat_summary: string | null;
  status: AppealStatus;
  submitted_at: string;
  intervene_deadline: string;
}

/** 裁决结果严格枚举（禁止自由文本） */
export type AdjudicateResult = 'buyer_win' | 'seller_win' | 'both_warning' | 'invalid';

export interface AdjudicatePayload {
  result: AdjudicateResult;
  /** 裁决备注（必填） */
  note: string;
  /** 可选关联处置（复用举报处置枚举），'无' 时不传 */
  linked_action?: 'off_shelf' | 'warning' | 'ban' | 'rejected';
}

export interface AppealListQuery extends PageQuery {
  type?: AppealType;
  status?: AppealStatus;
}

// ---------- 请求封装（与 governance.ts 同款） ----------

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

// ---------- 申诉仲裁接口 ----------

/** GET /admin/v1/appeals 申诉列表（按介入时限升序） */
export function listAppeals(query: AppealListQuery): Promise<PageResult<AppealItem>> {
  return request<PageResult<AppealItem>>('/appeals', { query: { ...query } });
}

/** GET /admin/v1/appeals/{id} 申诉详情（理由/证据/关联上下文/聊天摘要） */
export function getAppeal(id: number): Promise<{ appeal: AppealDetail }> {
  return request<{ appeal: AppealDetail }>(`/appeals/${id}`);
}

/** POST /admin/v1/appeals/{id}/adjudicate 裁决提交（4002 result 非法/状态冲突） */
export function adjudicateAppeal(
  id: number,
  payload: AdjudicatePayload,
): Promise<{ appeal: { status: AppealStatus; result: AdjudicateResult } }> {
  return request(`/appeals/${id}/adjudicate`, { method: 'POST', body: payload });
}
