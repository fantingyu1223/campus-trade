/**
 * @module PIM-BC-01
 * @model PIM-AG-01
 * @rule CIM-R-02
 * 高校名单入参校验器：学校列表查询参数归一化 + 加入申请提交校验。
 * 注意：import BusinessError 自 auth.service 属循环引用，仅类型/调用时访问，安全。
 */
import { ERROR_CODES } from '@contract/error-codes';
import { BusinessError } from './auth.service';
import { SchoolJoinRequest, SchoolListQuery } from './dto/school.dto';

const MAX_EVIDENCE_COUNT = 9;
const MAX_URL_LEN = 512;
const MAX_REASON_LEN = 500;
const MAX_STUDENT_NO_LEN = 64;
const MAX_PAGE_SIZE = 50;
const MAX_KEYWORD_LEN = 64;

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

/** §5.2 #5 查询参数归一化：page 默认 1、pageSize 默认 20 上限 50（§5.1） */
export function validateSchoolListQuery(input: unknown): SchoolListQuery {
  const query = (input ?? {}) as Record<string, unknown>;

  const page = parsePositiveInt(query.page, 'page') ?? 1;
  const pageSize = parsePositiveInt(query.pageSize, 'pageSize') ?? 20;
  if (pageSize > MAX_PAGE_SIZE) fail(`pageSize 超上限（最大 ${MAX_PAGE_SIZE}）`);

  let keyword: string | undefined;
  if (query.keyword !== undefined && query.keyword !== null) {
    if (typeof query.keyword !== 'string') fail('keyword 非法');
    keyword = query.keyword.trim();
    if (keyword.length > MAX_KEYWORD_LEN) fail('keyword 超长');
    if (keyword.length === 0) keyword = undefined;
  }

  return keyword === undefined ? { page, pageSize } : { keyword, page, pageSize };
}

/** §5.2 #6 加入申请入参校验：school_id 必填，evidence/reason/student_no 可选 */
export function validateSchoolJoinDto(input: unknown): SchoolJoinRequest {
  const body = (input ?? {}) as Record<string, unknown>;

  const schoolId = body.school_id;
  if (typeof schoolId !== 'string' || !/^\d+$/.test(schoolId.trim())) {
    fail('school_id（学校标识）缺失或非法');
  }

  let evidence: string[] | undefined;
  if (body.evidence !== undefined) {
    if (!Array.isArray(body.evidence)) fail('evidence 须为数组');
    if (body.evidence.length > MAX_EVIDENCE_COUNT) {
      fail(`evidence 最多 ${MAX_EVIDENCE_COUNT} 张`);
    }
    for (const item of body.evidence) {
      if (typeof item !== 'string' || item.trim().length === 0) {
        fail('evidence 元素须为非空字符串（材料图 URL）');
      }
      if (item.length > MAX_URL_LEN) fail('evidence URL 超长');
    }
    evidence = (body.evidence as string[]).map((s) => s.trim());
  }

  let reason: string | undefined;
  if (body.reason !== undefined) {
    if (typeof body.reason !== 'string') fail('reason 非法');
    reason = body.reason.trim();
    if (reason.length > MAX_REASON_LEN) fail('reason 超长');
  }

  let studentNo: string | undefined;
  if (body.student_no !== undefined) {
    if (typeof body.student_no !== 'string') fail('student_no 非法');
    studentNo = body.student_no.trim();
    if (studentNo.length > MAX_STUDENT_NO_LEN) fail('student_no 超长');
  }

  return {
    school_id: schoolId.trim(),
    evidence,
    reason,
    student_no: studentNo,
  };
}
