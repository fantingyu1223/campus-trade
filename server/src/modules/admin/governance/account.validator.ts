/**
 * account.validator.ts —— 账号管理入参校验器
 *
 * @module PIM-BC-05/06
 * 规则：status/role 枚举受限、keyword≤64、分页 page≥1、pageSize 1~50（9001）；
 * ban：reason 必填非空≤255（9001），duration_days 为 -1（永久）或正整数（9001）。
 * 写操作角色门槛复用 word-list.validator 的 assertSuperAdmin（§5.3 通用约定：
 * 账号封禁等写操作仅 admin）。
 * 注意：import BusinessError 自 account.service 属循环引用，仅运行时调用访问，安全。
 */
import { ERROR_CODES } from '@contract/error-codes';
import { BusinessError } from './account.service';
import {
  ACCOUNT_ROLES,
  ACCOUNT_STATUSES,
  type AccountListQuery,
  type AccountRoleFilter,
  type AccountStatusFilter,
  type BanBody,
} from './dto/account.dto';

const MAX_PAGE_SIZE = 50;
const MAX_KEYWORD_LEN = 64;
const MAX_REASON_LEN = 255;
const MAX_SOURCE_LEN = 64;

function fail(message: string): never {
  throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, message);
}

function parsePositiveInt(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const raw = typeof value === 'number' ? value : typeof value === 'string' ? value.trim() : NaN;
  const n = typeof raw === 'number' ? raw : /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < 1) fail(`${field} 非法（须为正整数）`);
  return n;
}

/** 路径参数 id：仅接受纯数字串 */
export function validateAccountIdParam(idParam: unknown): bigint {
  if (typeof idParam !== 'string' || !/^\d+$/.test(idParam.trim())) {
    fail('id 非法（须为数字）');
  }
  return BigInt(idParam.trim());
}

/** 列表查询：keyword/status/role 归一化 + 分页 */
export function validateAccountListQuery(input: unknown): AccountListQuery {
  const query = (typeof input === 'object' && input !== null ? input : {}) as Record<
    string,
    unknown
  >;

  let keyword: string | undefined;
  if (query.keyword !== undefined && query.keyword !== null) {
    if (typeof query.keyword !== 'string') fail('keyword 非法');
    keyword = query.keyword.trim();
    if (keyword.length > MAX_KEYWORD_LEN) fail('keyword 超长');
    if (keyword.length === 0) keyword = undefined;
  }

  let status: AccountStatusFilter | undefined;
  if (query.status !== undefined && query.status !== null && query.status !== '') {
    if (
      typeof query.status !== 'string' ||
      !(ACCOUNT_STATUSES as readonly string[]).includes(query.status)
    ) {
      fail('status 仅支持 normal/banned/deactivating');
    }
    status = query.status as AccountStatusFilter;
  }

  let role: AccountRoleFilter | undefined;
  if (query.role !== undefined && query.role !== null && query.role !== '') {
    if (
      typeof query.role !== 'string' ||
      !(ACCOUNT_ROLES as readonly string[]).includes(query.role)
    ) {
      fail('role 仅支持 guest/student/staff/merchant');
    }
    role = query.role as AccountRoleFilter;
  }

  const page = parsePositiveInt(query.page, 'page') ?? 1;
  const pageSize = parsePositiveInt(query.pageSize, 'pageSize') ?? 20;
  if (pageSize > MAX_PAGE_SIZE) fail(`pageSize 超上限（最大 ${MAX_PAGE_SIZE}）`);

  return { keyword, status, role, page, pageSize };
}

/** ban 请求体：reason 必填非空≤255；duration_days 为 -1（永久）或正整数；source 可选 */
export function validateBanBody(input: unknown): BanBody {
  const body = (typeof input === 'object' && input !== null ? input : {}) as Record<
    string,
    unknown
  >;

  if (typeof body.reason !== 'string' || body.reason.trim().length === 0) {
    fail('reason（封禁原因）必填');
  }
  if (body.reason.length > MAX_REASON_LEN) fail(`reason 超长（最大 ${MAX_REASON_LEN}）`);

  if (
    typeof body.duration_days !== 'number' ||
    !Number.isInteger(body.duration_days) ||
    (body.duration_days !== -1 && body.duration_days <= 0)
  ) {
    fail('duration_days 须为正整数或 -1（永久）');
  }

  let source: string | undefined;
  if (body.source !== undefined && body.source !== null) {
    if (typeof body.source !== 'string' || body.source.length > MAX_SOURCE_LEN) {
      fail(`source 须为不超过 ${MAX_SOURCE_LEN} 字的字符串`);
    }
    source = body.source.trim() || undefined;
  }

  return { duration_days: body.duration_days, reason: body.reason.trim(), source };
}
