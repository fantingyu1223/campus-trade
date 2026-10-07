/**
 * @api §5.3 治理分组扩展：账号管理（F21 账号封禁/解封、F26 信用分联动、F31 处罚申诉裁决联动）
 * @module PIM-BC-06
 *
 * A6 账号管理页接口封装。baseURL=/admin/v1，封装风格与 api/governance.ts 一致。
 * 业务 DTO 按契约「模块自含」原则在本文件声明；通用包络/分页结构引自 types/contract.ts。
 *
 * TODO(登录未就绪)：JWT 暂从 localStorage('admin_token') 读取。
 *
 * 与契约的偏差记录（联调时需后端确认）：
 *  1. docs/design §5.3 未列账号管理接口编号，端点按治理分组命名习惯拟定为
 *     /admin/v1/accounts（GET 列表 / GET {id} / POST {id}/ban / POST {id}/unban），待后端落契约。
 *  2. 状态枚举按 A 页口径 normal/banned/deactivating；contract.ts UserStatus 另有
 *     readonly/clearance/cancelled 枚举，页面兜底展示原文。
 *  3. ban payload 中 source（封禁来源：人工/举报处置/申诉裁决）由前端透传展示，枚举待契约确认。
 */
import type { ApiResponse, PageQuery, PageResult } from '../types/contract';

const BASE_URL = '/admin/v1';

// ---------- 账号管理（A6） ----------

/** 账号状态（A 页口径）：normal 正常 / banned 已封禁 / deactivating 注销清算中 */
export type AccountStatus = 'normal' | 'banned' | 'deactivating';

/** 身份类型：guest/student/staff/merchant */
export type AccountRole = 'guest' | 'student' | 'staff' | 'merchant';

/** list 项 */
export interface AccountItem {
  id: number;
  nickname: string;
  identity_type: AccountRole;
  /** 信用分（F26） */
  credit_score: number;
  status: AccountStatus;
  registered_at: string;
}

/** 详情：账号信息+统计+操作留痕 */
export interface AccountDetail {
  id: number;
  nickname: string;
  identity_type: AccountRole;
  credit_score: number;
  status: AccountStatus;
  registered_at: string;
  /** 当前封禁信息（未封禁为空） */
  ban_info: {
    duration_days: number;
    reason: string;
    source: string;
    banned_at: string;
  } | null;
  stats: {
    publish_count: number;
    order_count: number;
    report_count: number;
  };
  /** 操作留痕（时间/操作人/动作/备注） */
  operation_logs: Array<{ time: string; operator?: string; action: string; note?: string }>;
}

export interface BanPayload {
  /** 封禁天数，-1 表示永久 */
  duration_days: number;
  /** 封禁原因（必填） */
  reason: string;
  /** 封禁来源（人工/举报处置/申诉裁决等，透传展示） */
  source?: string;
}

export interface AccountListQuery extends PageQuery {
  keyword?: string;
  status?: AccountStatus;
  role?: AccountRole;
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

// ---------- 账号管理接口 ----------

/** GET /admin/v1/accounts 账号检索（keyword/status/role） */
export function listAccounts(query: AccountListQuery): Promise<PageResult<AccountItem>> {
  return request<PageResult<AccountItem>>('/accounts', { query: { ...query } });
}

/** GET /admin/v1/accounts/{id} 账号详情（统计+操作留痕） */
export function getAccount(id: number): Promise<{ account: AccountDetail }> {
  return request<{ account: AccountDetail }>(`/accounts/${id}`);
}

/** POST /admin/v1/accounts/{id}/ban 封禁（4001 缺 reason；duration_days=-1 永久） */
export function banAccount(
  id: number,
  payload: BanPayload,
): Promise<{ account: { status: AccountStatus } }> {
  return request(`/accounts/${id}/ban`, { method: 'POST', body: payload });
}

/** POST /admin/v1/accounts/{id}/unban 解封 */
export function unbanAccount(id: number): Promise<{ account: { status: AccountStatus } }> {
  return request(`/accounts/${id}/unban`, { method: 'POST' });
}
