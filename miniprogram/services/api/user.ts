/**
 * services/api/user.ts —— user 用户档案分组接口封装。
 * @api §5.2 #46 GET /users/{id}（公开档案）+ 补充接口 PATCH /users/me（资料编辑，N6 匿名开关）
 */
import { request } from './auth';

// ---------- §5.2 #46 GET /users/{id} 公开档案（游客可读） ----------
export interface PublicProfileUser {
  id: string;
  nickname: string;
  avatar: string;
  bio: string;
  role: string;
  is_merchant: boolean;
  school_id: string | null;
  school_name: string | null;
  credit_score: number | null;
  join_at: string;
}

export interface PublicProfileResult {
  user: PublicProfileUser;
  on_sale_count: number;
  sold_count: number;
  on_sale_list: unknown[];
  sold_list: unknown[];
  review_summary: { avg_rating: number | null; total: number };
}

export function getPublicProfile(userId: string): Promise<PublicProfileResult> {
  return request<PublicProfileResult>({ url: `/users/${userId}`, auth: false });
}

// ---------- 补充接口 PATCH /users/me 资料编辑（含 N6 匿名开关） ----------
export interface UpdateProfilePayload {
  nickname?: string;
  bio?: string;
  avatar_url?: string;
  is_anonymous?: boolean;
}

/** 更新后的本人档案（本人视角不脱敏） */
export interface UpdateProfileResult {
  id: string;
  nickname: string;
  avatar: string;
  bio: string;
  is_anonymous: boolean;
  role: string;
  school_id: string | null;
  join_at: string;
}

export function updateProfile(payload: UpdateProfilePayload): Promise<UpdateProfileResult> {
  return request<UpdateProfileResult>({
    url: '/users/me',
    method: 'PATCH',
    data: payload as unknown as Record<string, unknown>,
  });
}
