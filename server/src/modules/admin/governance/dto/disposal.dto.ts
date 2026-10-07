/**
 * disposal.dto.ts —— 举报处置 DTO 与入参校验（T-302）
 *
 * @module PIM-BC-05 举报（后台治理子域 admin/governance）
 * @api §5.3 report #54-56（举报队列 / 举报详情 / 处置提交）
 *
 * 口径说明：
 * - 队列/详情的 status 过滤与响应使用契约口径 'done'（§5.3 #54/#56），
 *   落库映射为 DB 枚举 'resolved'（schema ReportStatus: pending/processing/resolved），
 *   映射集中在 repository 层完成，本 DTO 只出现契约口径。
 * - 错误码 4002 为 §5.3 #56 指定（result 非法 / 状态冲突），非 4xxx 订单语义。
 */

/** 处置结果枚举（契约 §5.3 #56；与 Prisma ReportResult 一致） */
export const DISPOSAL_RESULTS = ['off_shelf', 'warning', 'ban', 'rejected'] as const;
export type DisposalResult = (typeof DISPOSAL_RESULTS)[number];

/** 队列状态过滤口径（契约 #54：pending/processing/done） */
export const QUEUE_STATUS_FILTERS = ['pending', 'processing', 'done'] as const;
export type QueueStatusFilter = (typeof QUEUE_STATUS_FILTERS)[number];

/** §5.3 #56 POST /admin/v1/reports/{id}/action 请求体 */
export interface DisposalActionBody {
  /** 处置结果（必填，枚举受限） */
  result: DisposalResult;
  /** 处置说明（可选，≤500 字；ban 时作为封禁原因） */
  note?: string;
  /** 封禁时长天数（result=ban 时必填，正整数；留痕用，schema 无独立字段） */
  duration_days?: number;
}

/** §5.3 #54 队列查询参数 */
export interface ReportQueueQuery {
  status?: QueueStatusFilter;
  page: number;
  pageSize: number;
}

/** 校验异常载体（由 service 层 BusinessError 抛出，此处仅返回错误信息） */
export interface ValidationFailure {
  message: string;
}

const MAX_PAGE_SIZE = 50;
const NOTE_MAX_LEN = 500;

/** 纯数字字符串 → bigint 安全解析；非法返回 null */
export function parseIdParam(raw: string): bigint | null {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

/** #56 请求体校验：result 枚举受限；note≤500；ban 时 duration_days 必填正整数 */
export function validateDisposalActionBody(
  raw: unknown,
): { ok: true; body: DisposalActionBody } | { ok: false; error: ValidationFailure } {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: { message: '请求体不能为空' } };
  }
  const b = raw as Record<string, unknown>;

  if (
    typeof b.result !== 'string' ||
    !(DISPOSAL_RESULTS as readonly string[]).includes(b.result)
  ) {
    return { ok: false, error: { message: 'result 非法，仅支持 off_shelf/warning/ban/rejected' } };
  }
  const result = b.result as DisposalResult;

  let note: string | undefined;
  if (b.note !== undefined) {
    if (typeof b.note !== 'string' || b.note.length > NOTE_MAX_LEN) {
      return { ok: false, error: { message: `note 须为不超过 ${NOTE_MAX_LEN} 字的字符串` } };
    }
    note = b.note;
  }

  let durationDays: number | undefined;
  if (b.duration_days !== undefined) {
    if (
      typeof b.duration_days !== 'number' ||
      !Number.isInteger(b.duration_days) ||
      b.duration_days <= 0
    ) {
      return { ok: false, error: { message: 'duration_days 须为正整数' } };
    }
    durationDays = b.duration_days;
  }
  // 契约 §5.3 #56：ban 时 duration_days 必填
  if (result === 'ban' && durationDays === undefined) {
    return { ok: false, error: { message: 'result=ban 时 duration_days 必填' } };
  }

  return { ok: true, body: { result, note, duration_days: durationDays } };
}

/** #54 队列查询参数校验：status 枚举受限；page/pageSize 默认 1/20，上限 50 */
export function validateQueueQuery(
  raw: unknown,
): { ok: true; query: ReportQueueQuery } | { ok: false; error: ValidationFailure } {
  const q = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;

  let status: QueueStatusFilter | undefined;
  if (q.status !== undefined) {
    if (
      typeof q.status !== 'string' ||
      !(QUEUE_STATUS_FILTERS as readonly string[]).includes(q.status)
    ) {
      return { ok: false, error: { message: 'status 仅支持 pending/processing/done' } };
    }
    status = q.status as QueueStatusFilter;
  }

  const toPositiveInt = (v: unknown): number | null => {
    if (v === undefined) return null;
    const n = typeof v === 'string' ? Number(v) : v;
    if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) return null;
    return n;
  };

  let page = 1;
  if (q.page !== undefined) {
    const p = toPositiveInt(q.page);
    if (p === null) return { ok: false, error: { message: 'page 须为正整数' } };
    page = p;
  }
  let pageSize = 20;
  if (q.pageSize !== undefined) {
    const s = toPositiveInt(q.pageSize);
    if (s === null || s > MAX_PAGE_SIZE) {
      return { ok: false, error: { message: `pageSize 须为 1~${MAX_PAGE_SIZE} 的正整数` } };
    }
    pageSize = s;
  }

  return { ok: true, query: { status, page, pageSize } };
}
