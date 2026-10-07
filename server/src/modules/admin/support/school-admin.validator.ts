/**
 * @module PIM-BC-06
 * @rule CIM-R-02
 * @api §5.3 school #68-73
 * 后台高校名单入参校验器：请求体/路径参数/查询参数归一化，违规一律 9001。
 * 注意：import BusinessError 自 school-admin.service 属循环引用，仅运行时调用访问，安全。
 */
import { ERROR_CODES } from '@contract/error-codes';
import { BusinessError } from './school-admin.service';
import {
  HandleJoinRequest,
  JoinRequestListQuery,
  SchoolCreateRequest,
  SchoolListQuery,
  SchoolUpdateRequest,
} from './dto/school-admin.dto';

const MAX_NAME_LEN = 128;
const MAX_SHORT_NAME_LEN = 64;
const MAX_EMAIL_SUFFIX_LEN = 128;
const MAX_CITY_LEN = 64;
const MAX_REMARK_LEN = 500;
const MAX_NOTE_LEN = 500;
const MAX_PAGE_SIZE = 50;
const MAX_KEYWORD_LEN = 64;

function fail(message: string): never {
  throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, message);
}

function optionalString(
  value: unknown,
  field: string,
  maxLen: number,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') fail(`${field} 非法`);
  const trimmed = value.trim();
  if (trimmed.length > maxLen) fail(`${field} 超长（最大 ${maxLen}）`);
  return trimmed;
}

function parsePositiveInt(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const raw =
    typeof value === 'number' ? value : typeof value === 'string' ? value.trim() : NaN;
  const n = typeof raw === 'number' ? raw : /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < 1) fail(`${field} 非法（须为正整数）`);
  return n;
}

function parsePage(input: Record<string, unknown>): {
  page: number;
  pageSize: number;
} {
  const page = parsePositiveInt(input.page, 'page') ?? 1;
  const pageSize = parsePositiveInt(input.pageSize, 'pageSize') ?? 20;
  if (pageSize > MAX_PAGE_SIZE) fail(`pageSize 超上限（最大 ${MAX_PAGE_SIZE}）`);
  return { page, pageSize };
}

/** #69 新增学校：name 必填≤128；email_suffix 若给须以 @ 开头≤128 */
export function validateSchoolCreateDto(input: unknown): SchoolCreateRequest {
  const body = (input ?? {}) as Record<string, unknown>;

  const name = optionalString(body.name, 'name', MAX_NAME_LEN);
  if (name === undefined || name.length === 0) fail('name（学校全称）必填');

  const emailSuffix = optionalString(
    body.email_suffix,
    'email_suffix',
    MAX_EMAIL_SUFFIX_LEN,
  );
  if (emailSuffix !== undefined && !emailSuffix.startsWith('@')) {
    fail('email_suffix 须以 @ 开头（如 @xxx.edu.cn）');
  }

  return {
    name,
    short_name: optionalString(body.short_name, 'short_name', MAX_SHORT_NAME_LEN),
    email_suffix: emailSuffix,
    city: optionalString(body.city, 'city', MAX_CITY_LEN),
    remark: optionalString(body.remark, 'remark', MAX_REMARK_LEN),
  };
}

/** #70 修改学校：全可选但至少一项 */
export function validateSchoolUpdateDto(input: unknown): SchoolUpdateRequest {
  const body = (input ?? {}) as Record<string, unknown>;

  const name = optionalString(body.name, 'name', MAX_NAME_LEN);
  if (body.name !== undefined && (name === undefined || name.length === 0)) {
    fail('name 不可为空串');
  }
  const emailSuffix = optionalString(
    body.email_suffix,
    'email_suffix',
    MAX_EMAIL_SUFFIX_LEN,
  );
  if (emailSuffix !== undefined && !emailSuffix.startsWith('@')) {
    fail('email_suffix 须以 @ 开头（如 @xxx.edu.cn）');
  }

  const dto: SchoolUpdateRequest = {
    name,
    short_name: optionalString(body.short_name, 'short_name', MAX_SHORT_NAME_LEN),
    email_suffix: emailSuffix,
    city: optionalString(body.city, 'city', MAX_CITY_LEN),
    remark: optionalString(body.remark, 'remark', MAX_REMARK_LEN),
  };
  const hasAny = Object.values(dto).some((v) => v !== undefined);
  if (!hasAny) fail('至少提供一项待修改字段');
  return dto;
}

/** #73 申请处理：action 必填且 approve/reject；reject 时 note 必填；note≤500 */
export function validateHandleJoinDto(input: unknown): HandleJoinRequest {
  const body = (input ?? {}) as Record<string, unknown>;

  const action = body.action;
  if (action !== 'approve' && action !== 'reject') {
    fail('action 必填且仅支持 approve/reject');
  }
  const note = optionalString(body.note, 'note', MAX_NOTE_LEN);
  if (action === 'reject' && (note === undefined || note.length === 0)) {
    fail('驳回时 note（驳回原因）必填');
  }
  return { action, note };
}

/** 路径参数 id：仅接受纯数字串 */
export function validateIdParam(idParam: unknown): string {
  if (typeof idParam !== 'string' || !/^\d+$/.test(idParam.trim())) {
    fail('id 非法（须为数字）');
  }
  return idParam.trim();
}

/** #68 名单查询：status∈active|disabled；page 默认 1、pageSize 默认 20 上限 50 */
export function validateSchoolListQuery(input: unknown): SchoolListQuery {
  const query = (input ?? {}) as Record<string, unknown>;
  const { page, pageSize } = parsePage(query);

  let status: SchoolListQuery['status'];
  if (query.status !== undefined && query.status !== null && query.status !== '') {
    if (query.status !== 'active' && query.status !== 'disabled') {
      fail('status 仅支持 active/disabled');
    }
    status = query.status;
  }

  let keyword: string | undefined;
  if (query.keyword !== undefined && query.keyword !== null) {
    if (typeof query.keyword !== 'string') fail('keyword 非法');
    keyword = query.keyword.trim();
    if (keyword.length > MAX_KEYWORD_LEN) fail('keyword 超长');
    if (keyword.length === 0) keyword = undefined;
  }

  return { keyword, status, page, pageSize };
}

/** #72 申请查询：status∈pending|approved|rejected；page 默认 1、pageSize 默认 20 上限 50 */
export function validateJoinRequestListQuery(
  input: unknown,
): JoinRequestListQuery {
  const query = (input ?? {}) as Record<string, unknown>;
  const { page, pageSize } = parsePage(query);

  let status: JoinRequestListQuery['status'];
  if (query.status !== undefined && query.status !== null && query.status !== '') {
    if (
      query.status !== 'pending' &&
      query.status !== 'approved' &&
      query.status !== 'rejected'
    ) {
      fail('status 仅支持 pending/approved/rejected');
    }
    status = query.status;
  }

  return { status, page, pageSize };
}
