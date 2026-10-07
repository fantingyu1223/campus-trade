/**
 * appeal.validator.ts —— 申诉仲裁入参校验器（§5.3 #65-67）
 *
 * @module PIM-BC-05
 * 规则：type/status 枚举受限（9001）；分页 page≥1、pageSize 1~50（9001）；
 * 裁决 result/linked_action 枚举受限（4002，契约 #67 指定），note 必填≤500（9001）。
 * 注意：import BusinessError 自 appeal.service 属循环引用，仅运行时调用访问，安全
 * （与 support/school-admin.validator 同款既定模式）。
 */
import { ERROR_CODES } from '@contract/error-codes';
import { BusinessError } from './appeal.service';
import {
  ADJUDICATE_RESULTS,
  APPEAL_STATUS_FILTERS,
  APPEAL_TYPES,
  LINKED_ACTIONS,
  type AdjudicateBody,
  type AdjudicateResult,
  type AppealListQuery,
  type AppealStatusFilter,
  type AppealTypeFilter,
  type LinkedAction,
} from './dto/appeal.dto';

const MAX_PAGE_SIZE = 50;
const MAX_NOTE_LEN = 500;

function fail(code: number, message: string): never {
  throw new BusinessError(code, message);
}

function parsePositiveInt(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const raw = typeof value === 'number' ? value : typeof value === 'string' ? value.trim() : NaN;
  const n = typeof raw === 'number' ? raw : /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < 1) {
    fail(ERROR_CODES.PARAM_VALIDATION_FAILED, `${field} 非法（须为正整数）`);
  }
  return n;
}

/** #65 队列查询：type∈dispute|punishment；status∈pending|processing|done；分页默认 1/20 */
export function validateAppealListQuery(input: unknown): AppealListQuery {
  const query = (typeof input === 'object' && input !== null ? input : {}) as Record<
    string,
    unknown
  >;

  let type: AppealTypeFilter | undefined;
  if (query.type !== undefined && query.type !== null && query.type !== '') {
    if (
      typeof query.type !== 'string' ||
      !(APPEAL_TYPES as readonly string[]).includes(query.type)
    ) {
      fail(ERROR_CODES.PARAM_VALIDATION_FAILED, 'type 仅支持 dispute/punishment');
    }
    type = query.type as AppealTypeFilter;
  }

  let status: AppealStatusFilter | undefined;
  if (query.status !== undefined && query.status !== null && query.status !== '') {
    if (
      typeof query.status !== 'string' ||
      !(APPEAL_STATUS_FILTERS as readonly string[]).includes(query.status)
    ) {
      fail(ERROR_CODES.PARAM_VALIDATION_FAILED, 'status 仅支持 pending/processing/done');
    }
    status = query.status as AppealStatusFilter;
  }

  const page = parsePositiveInt(query.page, 'page') ?? 1;
  const pageSize = parsePositiveInt(query.pageSize, 'pageSize') ?? 20;
  if (pageSize > MAX_PAGE_SIZE) {
    fail(ERROR_CODES.PARAM_VALIDATION_FAILED, `pageSize 超上限（最大 ${MAX_PAGE_SIZE}）`);
  }

  return { type, status, page, pageSize };
}

/** 路径参数 id：仅接受纯数字串 */
export function validateAppealIdParam(idParam: unknown): bigint {
  if (typeof idParam !== 'string' || !/^\d+$/.test(idParam.trim())) {
    fail(ERROR_CODES.PARAM_VALIDATION_FAILED, 'id 非法（须为数字）');
  }
  return BigInt(idParam.trim());
}

/**
 * #67 裁决请求体：result 严格枚举（4002）；note 必填非空≤500（9001）；
 * linked_action 可选，枚举受限（4002）。
 */
export function validateAdjudicateBody(input: unknown): AdjudicateBody {
  const body = (typeof input === 'object' && input !== null ? input : {}) as Record<
    string,
    unknown
  >;

  if (
    typeof body.result !== 'string' ||
    !(ADJUDICATE_RESULTS as readonly string[]).includes(body.result)
  ) {
    // 契约 #67：result 非法 → 4002
    fail(ERROR_CODES.ORDER_STATUS_CONFLICT, 'result 非法，仅支持 buyer_win/seller_win/both_warning/invalid');
  }
  const result = body.result as AdjudicateResult;

  if (typeof body.note !== 'string' || body.note.trim().length === 0) {
    fail(ERROR_CODES.PARAM_VALIDATION_FAILED, 'note（裁决备注/驳回理由）必填');
  }
  if (body.note.length > MAX_NOTE_LEN) {
    fail(ERROR_CODES.PARAM_VALIDATION_FAILED, `note 超长（最大 ${MAX_NOTE_LEN}）`);
  }

  let linkedAction: LinkedAction | undefined;
  if (body.linked_action !== undefined && body.linked_action !== null && body.linked_action !== '') {
    if (
      typeof body.linked_action !== 'string' ||
      !(LINKED_ACTIONS as readonly string[]).includes(body.linked_action)
    ) {
      fail(ERROR_CODES.ORDER_STATUS_CONFLICT, 'linked_action 仅支持 off_shelf/warning/ban/rejected');
    }
    linkedAction = body.linked_action as LinkedAction;
  }

  return { result, note: body.note, linked_action: linkedAction };
}
