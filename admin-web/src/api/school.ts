/**
 * @api §5.3 #68-73（docs/design/2026-02-06-技术选型与总体方案.md「school 学校名单（F36）」后台契约）
 * @module PIM-BC-06
 *
 * 后台高校名单接口封装。baseURL=/admin/v1。
 * 业务 DTO 按契约「模块自含」原则在本文件声明；通用包络/分页结构引自 types/contract.ts。
 *
 * TODO(登录未就绪)：后台登录页未实现，JWT 暂从 localStorage('admin_token') 读取，
 * 登录页落地后改为统一 auth store 注入。
 */
import type { ApiResponse, PageQuery, PageResult } from '../types/contract';
import { handleUnauthorized } from './auth';

const BASE_URL = '/admin/v1';

// ---------- 契约 DTO（§5.3 #68-73 响应/请求关键字段） ----------

/** #68 名单状态枚举（契约口径：active/pending/offboarded） */
export type SchoolStatus = 'active' | 'pending' | 'offboarded';

/** #68 list 项：{id, name, domain, member_count, status} */
export interface SchoolItem {
  id: number;
  name: string;
  /** 校园邮箱后缀 */
  domain: string;
  member_count: number;
  status: SchoolStatus;
  /** #70 修改字段，列表契约未返回，编辑时可能为空 */
  remark?: string;
}

/** #69 新增学校请求（字段对齐后端契约：email_suffix；remark 为空则不传，后端自动生成事由） */
export interface SchoolCreatePayload {
  name: string;
  /** 邮箱后缀 */
  email_suffix: string;
  remark?: string;
}

/** #70 修改学校请求 */
export type SchoolUpdatePayload = SchoolCreatePayload;

/** #72 申请状态枚举 */
export type JoinRequestStatus = 'pending' | 'approved' | 'rejected';

/** #72 list 项：{id, school_name, contact, reason, status, created_at} */
export interface SchoolJoinRequestItem {
  id: number;
  school_name: string;
  contact: string;
  reason: string;
  status: JoinRequestStatus;
  created_at: string;
}

/** #73 处理动作 */
export type JoinRequestAction = 'approve' | 'reject';

export interface JoinRequestHandlePayload {
  action: JoinRequestAction;
  note?: string;
}

export interface SchoolListQuery extends PageQuery {
  keyword?: string;
  status?: SchoolStatus;
}

export interface JoinRequestListQuery extends PageQuery {
  status?: JoinRequestStatus;
}

// ---------- 请求封装 ----------

function authHeaders(): Record<string, string> {
  // 登录页（/login）成功后写入 localStorage('admin_token')，见 api/auth.ts
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
    // 401/1001 等鉴权失效：清 token 跳 /login（@api §5.3 #51）
    handleUnauthorized(resp.status, envelope.code);
    throw new Error(envelope.message || `请求失败（code=${envelope.code}）`);
  }
  return envelope.data as T;
}

// ---------- 接口 ----------

/** #68 GET /admin/v1/schools 名单列表 */
export function fetchSchools(query: SchoolListQuery): Promise<PageResult<SchoolItem>> {
  return request<PageResult<SchoolItem>>('/schools', { query: { ...query } });
}

/** #69 POST /admin/v1/schools 新增学校（域名重复错误码 1002） */
export function createSchool(payload: SchoolCreatePayload): Promise<{ id: number }> {
  return request<{ id: number }>('/schools', { method: 'POST', body: payload });
}

/** #70 PUT /admin/v1/schools/{id} 修改 */
export function updateSchool(id: number, payload: SchoolUpdatePayload): Promise<SchoolItem> {
  return request<SchoolItem>(`/schools/${id}`, { method: 'PUT', body: payload });
}

/** #71 DELETE /admin/v1/schools/{id} 移除（软删除留痕；存在在册成员返回 4002） */
export function removeSchool(id: number): Promise<null> {
  return request<null>(`/schools/${id}`, { method: 'DELETE', body: { confirm: true } });
}

/** #72 GET /admin/v1/school-join-requests 加入申请列表 */
export function fetchJoinRequests(
  query: JoinRequestListQuery,
): Promise<PageResult<SchoolJoinRequestItem>> {
  return request<PageResult<SchoolJoinRequestItem>>('/school-join-requests', {
    query: { ...query },
  });
}

/** #73 POST /admin/v1/school-join-requests/{id}/handle 审批（approve 自动建校并开通） */
export function handleJoinRequest(
  id: number,
  payload: JoinRequestHandlePayload,
): Promise<{ status: JoinRequestStatus }> {
  return request<{ status: JoinRequestStatus }>(`/school-join-requests/${id}/handle`, {
    method: 'POST',
    body: payload,
  });
}
