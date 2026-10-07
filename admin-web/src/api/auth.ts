/**
 * @api §5.3 auth 后台登录 #51（POST /admin/v1/auth/login）
 * @module PIM-BC-05
 *
 * 后台登录接口封装与鉴权失效统一处理。
 * - token 读取方式沿用既有约定：localStorage('admin_token')，各 api 文件的 authHeaders 不变；
 * - 本文件提供 redirectToLogin()，供各 api 封装在收到 401/1001（未登录/token 无效）时调用。
 *
 * 与契约的偏差记录：
 *  1. 契约 #51 响应字段为 access_token/refresh_token/operator{id, role, name}；
 *     后端当前实现返回 {access_token, refresh_token, expires_in:7200, role}（扁平 role）。
 *     本文件两种结构均兼容取值（role ?? operator?.role），待后端对齐契约。
 *  2. #52 refresh / #53 logout 后端未实现，退出登录仅清本地 token，不调接口。
 */
import type { ApiResponse } from '../types/contract';

const BASE_URL = '/admin/v1';

/** localStorage token 键名（沿用既有 api 文件约定，勿改） */
export const ADMIN_TOKEN_KEY = 'admin_token';

export interface LoginPayload {
  username: string;
  password: string;
}

/** #51 登录响应 data（兼容契约 operator 结构与后端当前扁平 role 结构） */
export interface LoginResult {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  role?: string;
  operator?: { id: number; role: string; name: string };
}

/**
 * 未登录/凭据失效统一处理：清除本地 token 并跳转 /login。
 * 触发条件：HTTP 401，或业务码 1001（未登录/token 无效）/1002（token 过期）/2001（§5.3 后台鉴权失败）。
 * 返回 true 表示已判定为鉴权失效。
 */
export function handleUnauthorized(status: number, code: number | undefined): boolean {
  const isUnauthorized = status === 401 || code === 1001 || code === 1002 || code === 2001;
  if (!isUnauthorized) return false;
  localStorage.removeItem(ADMIN_TOKEN_KEY);
  // 用整页跳转避免 api 层反向依赖 router 实例（防循环依赖）
  if (window.location.pathname !== '/login') {
    const redirect = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login?redirect=${redirect}`;
  }
  return true;
}

/**
 * #51 POST /admin/v1/auth/login 后台登录。
 * 错误码：1001 凭据错误、1003 账号停用（错误信息直接展示 envelope.message）。
 */
export async function adminLogin(payload: LoginPayload): Promise<LoginResult> {
  const resp = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const envelope = (await resp.json()) as ApiResponse<LoginResult>;
  if (!resp.ok || envelope.code !== 0 || !envelope.data) {
    throw new Error(envelope.message || `登录失败（code=${envelope.code}）`);
  }
  return envelope.data;
}
