/**
 * services/api/school.ts —— school 学校分组接口封装。
 * @api §5.2 school 学校分组（#5 GET /schools / #6 POST /schools/join）
 * 复用 auth.ts 的通用 request() 与 BASE_URL。
 */
import { PageResult } from '../../types/contract';
import { request } from './auth';

// ---------- #5 GET /schools 支持学校列表（F36，免登录） ----------
export interface SchoolItem {
  id: number;
  name: string;
  city: string | null;
}

export interface SchoolQuery {
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export function getSchools(query: SchoolQuery = {}): Promise<PageResult<SchoolItem>> {
  return request<PageResult<SchoolItem>>({
    url: '/schools',
    data: {
      keyword: query.keyword || '',
      page: query.page || 1,
      pageSize: query.pageSize || 20,
    },
    auth: false,
  });
}

// ---------- #6 POST /schools/join 名单外加入申请（F36-AC1） ----------
export interface SchoolJoinPayload {
  school_id: number;
  evidence?: string[];
}

export interface SchoolJoinResult {
  apply_id: number;
  status: 'pending';
}

export function joinSchool(payload: SchoolJoinPayload): Promise<SchoolJoinResult> {
  return request<SchoolJoinResult>({ url: '/schools/join', method: 'POST', data: payload as unknown as Record<string, unknown> });
}
