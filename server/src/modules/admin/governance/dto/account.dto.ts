/**
 * account.dto.ts —— 账号管理 DTO（PRD F20/F21 处置封禁、A6 账号管理页）
 *
 * @module PIM-BC-05/06（后台治理子域 admin/governance）
 *
 * 对齐基准：admin-web/src/api/account.ts DTO（前端已实现，偏差最小化）。
 * 口径说明：
 * - 契约状态 normal/banned/deactivating ↔ DB UserStatus normal/banned/clearance；
 *   DB readonly/cancelled 无契约对应项，输出兜底原文透传（前端页面兜底展示）。
 * - credit_score 在 schema 中无对应字段（F26 信用分未建模），占位返回 0。
 */

/** 账号状态过滤口径（契约）：normal/banned/deactivating */
export const ACCOUNT_STATUSES = ['normal', 'banned', 'deactivating'] as const;
export type AccountStatusFilter = (typeof ACCOUNT_STATUSES)[number];

/** 身份类型过滤（与 Prisma IdentityType 一致） */
export const ACCOUNT_ROLES = ['guest', 'student', 'staff', 'merchant'] as const;
export type AccountRoleFilter = (typeof ACCOUNT_ROLES)[number];

/** 列表查询参数 */
export interface AccountListQuery {
  keyword?: string;
  status?: AccountStatusFilter;
  role?: AccountRoleFilter;
  page: number;
  pageSize: number;
}

/** 封禁请求体：duration_days 正整数或 -1（永久）；reason 必填；source 可选透传 */
export interface BanBody {
  duration_days: number;
  reason: string;
  source?: string;
}
