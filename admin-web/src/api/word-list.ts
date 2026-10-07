/**
 * @api §5.3 治理分组扩展：词表配置（F22 敏感词/违禁词过滤、F13 违禁品管控）
 * @module PIM-BC-06
 *
 * A9 词表配置页接口封装。baseURL=/admin/v1，封装风格与 api/governance.ts 一致。
 * 业务 DTO 按契约「模块自含」原则在本文件声明；通用包络/分页结构引自 types/contract.ts。
 *
 * TODO(登录未就绪)：JWT 暂从 localStorage('admin_token') 读取。
 *
 * 与契约的偏差记录（联调时需后端确认）：
 *  1. docs/design §5.3 未列词表接口编号，端点按治理分组命名习惯拟定为
 *     /admin/v1/word-lists（GET/POST/PUT {id} / POST {id}/toggle / GET {id}/history），待后端落契约。
 *  2. 「保存后自动刷新各端词表快照」为后端职责，前端仅做文案提示。
 */
import type { ApiResponse, PageQuery, PageResult } from '../types/contract';
import { handleUnauthorized } from './auth';

const BASE_URL = '/admin/v1';

// ---------- 词表配置（A9） ----------

/** 词类型：risk 风险词 / violation 违规词 / prohibited 违禁品词 */
export type WordType = 'risk' | 'violation' | 'prohibited';

/** 命中级别：block 直接拦截 / review 转人工复核 */
export type WordLevel = 'block' | 'review';

export type WordStatus = 'enabled' | 'disabled';

/** list 项 */
export interface WordItem {
  id: number;
  word: string;
  type: WordType;
  level: WordLevel;
  status: WordStatus;
  updated_at?: string;
}

export interface WordPayload {
  word: string;
  type: WordType;
  level: WordLevel;
}

/** 变更历史条目（时间/操作人/前后值） */
export interface WordHistoryItem {
  time: string;
  operator?: string;
  action: 'create' | 'update' | 'toggle';
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export interface WordListQuery extends PageQuery {
  type?: WordType;
}

// ---------- 请求封装（与 governance.ts 同款） ----------

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

// ---------- 词表接口 ----------

/** GET /admin/v1/word-lists 词表列表 */
export function listWords(query: WordListQuery): Promise<PageResult<WordItem>> {
  return request<PageResult<WordItem>>('/word-lists', { query: { ...query } });
}

/** POST /admin/v1/word-lists 新增词条（4001 缺 word/type/level） */
export function createWord(payload: WordPayload): Promise<{ word: WordItem }> {
  return request('/word-lists', { method: 'POST', body: payload });
}

/** PUT /admin/v1/word-lists/{id} 编辑词条 */
export function updateWord(id: number, payload: WordPayload): Promise<{ word: WordItem }> {
  return request(`/word-lists/${id}`, { method: 'PUT', body: payload });
}

/** POST /admin/v1/word-lists/{id}/toggle 停用/启用（保存后自动刷新各端词表快照） */
export function toggleWord(id: number): Promise<{ word: { status: WordStatus } }> {
  return request(`/word-lists/${id}/toggle`, { method: 'POST' });
}

/** GET /admin/v1/word-lists/{id}/history 变更历史 */
export function listWordHistory(id: number): Promise<{ history: WordHistoryItem[] }> {
  return request<{ history: WordHistoryItem[] }>(`/word-lists/${id}/history`);
}
