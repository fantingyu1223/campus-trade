/**
 * dto/merchant-review.dto.ts —— 商家入驻审核 DTO 与校验（T-306）
 * @module PIM-AG-10
 * 校验失败口径统一 9001（参数校验失败）。
 */

/** 业务错误（与 service 同源结构；此处独立声明避免循环依赖） */
export class DtoBusinessError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'BusinessError';
  }
}

export const REJECT_REASON_CODES = [
  'license_invalid',
  'license_unclear',
  'info_mismatch',
  'shop_proof_missing',
  'duplicate_shop',
  'blacklisted',
  'scope_not_allowed',
  'other',
] as const;

export type RejectReasonCode = (typeof REJECT_REASON_CODES)[number];

export const LIST_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type ListStatus = (typeof LIST_STATUSES)[number];

export interface ListQuery {
  status: ListStatus;
  page: number;
  pageSize: number;
}

export interface ApproveBody {
  note?: string;
}

export interface RejectBody {
  reason_code?: string;
  reject_reason_detail?: string;
  note?: string;
}

/** 列表查询校验：status 默认 pending，越界 9001；分页默认 1/20，pageSize ≤ 100 */
export function validateListQuery(raw: Record<string, unknown>): ListQuery {
  const status = (raw.status ?? 'pending') as string;
  if (!LIST_STATUSES.includes(status as ListStatus)) {
    throw new DtoBusinessError(9001, `status 越界：${status}`);
  }
  const page = Math.max(1, Number(raw.page ?? 1) || 1);
  const pageSizeRaw = Number(raw.pageSize ?? 20) || 20;
  const pageSize = Math.min(100, Math.max(1, pageSizeRaw));
  return { status: status as ListStatus, page, pageSize };
}

/** 驳回体校验：reason_code 必在 8 枚举内；other 必须带补充说明 */
export function validateRejectBody(body: RejectBody | undefined | null): {
  reason_code: RejectReasonCode;
  detail: string | null;
} {
  const code = body?.reason_code;
  if (!code || !REJECT_REASON_CODES.includes(code as RejectReasonCode)) {
    throw new DtoBusinessError(9001, `reason_code 越界：${code ?? '(空)'}`);
  }
  const detail = (body?.reject_reason_detail ?? body?.note ?? '').trim();
  if (code === 'other' && !detail) {
    throw new DtoBusinessError(9001, 'reason_code=other 时必须提供 reject_reason_detail/note');
  }
  return { reason_code: code as RejectReasonCode, detail: detail || null };
}
