/**
 * word-list.validator.ts —— 词表配置入参校验器（§5.3 #82-86 具体化）
 *
 * @module PIM-BC-06
 * 规则：word 必填≤128；type/level 枚举受限；分页 page≥1、pageSize 1~50；
 * 违规一律 9001。写操作角色门槛 assertSuperAdmin（auditor → 6001，§5.3 通用约定：
 * 词表配置等写操作仅 admin）。
 * 注意：import BusinessError 自 word-list.service 属循环引用，仅运行时调用访问，安全
 * （与 support/school-admin.validator 同款既定模式）。
 */
import { ERROR_CODES } from '@contract/error-codes';
import { BusinessError } from './word-list.service';
import {
  WORD_LEVELS,
  WORD_TYPES,
  type WordLevel,
  type WordListQuery,
  type WordPayload,
  type WordType,
} from './dto/word-list.dto';

const MAX_PAGE_SIZE = 50;
const MAX_WORD_LEN = 128;
const MAX_NOTE_LEN = 255;

function fail(message: string): never {
  throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, message);
}

/** §5.3 通用约定：词表配置/账号处置等写操作仅超管 admin；auditor 越权 → 6001 */
export function assertSuperAdmin(role: unknown): void {
  if (role !== 'admin') {
    throw new BusinessError(ERROR_CODES.ADMIN_PERMISSION_DENIED, '仅超管（admin）可执行该操作');
  }
}

function parsePositiveInt(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const raw = typeof value === 'number' ? value : typeof value === 'string' ? value.trim() : NaN;
  const n = typeof raw === 'number' ? raw : /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < 1) fail(`${field} 非法（须为正整数）`);
  return n;
}

/** 路径参数 id：仅接受纯数字串 */
export function validateWordIdParam(idParam: unknown): bigint {
  if (typeof idParam !== 'string' || !/^\d+$/.test(idParam.trim())) {
    fail('id 非法（须为数字）');
  }
  return BigInt(idParam.trim());
}

/** 列表查询：type 枚举受限；page 默认 1、pageSize 默认 20 上限 50 */
export function validateWordListQuery(input: unknown): WordListQuery {
  const query = (typeof input === 'object' && input !== null ? input : {}) as Record<
    string,
    unknown
  >;

  let type: WordType | undefined;
  if (query.type !== undefined && query.type !== null && query.type !== '') {
    if (typeof query.type !== 'string' || !(WORD_TYPES as readonly string[]).includes(query.type)) {
      fail('type 仅支持 risk/violation/prohibited');
    }
    type = query.type as WordType;
  }

  const page = parsePositiveInt(query.page, 'page') ?? 1;
  const pageSize = parsePositiveInt(query.pageSize, 'pageSize') ?? 20;
  if (pageSize > MAX_PAGE_SIZE) fail(`pageSize 超上限（最大 ${MAX_PAGE_SIZE}）`);

  return { type, page, pageSize };
}

/** 新增/修改词条：word 必填非空≤128；type/level 枚举受限；note 可选≤255 */
export function validateWordPayload(input: unknown): WordPayload {
  const body = (typeof input === 'object' && input !== null ? input : {}) as Record<
    string,
    unknown
  >;

  if (typeof body.word !== 'string' || body.word.trim().length === 0) {
    fail('word（词条）必填');
  }
  if (body.word.trim().length > MAX_WORD_LEN) fail(`word 超长（最大 ${MAX_WORD_LEN}）`);

  if (typeof body.type !== 'string' || !(WORD_TYPES as readonly string[]).includes(body.type)) {
    fail('type 仅支持 risk/violation/prohibited');
  }
  if (
    typeof body.level !== 'string' ||
    !(WORD_LEVELS as readonly string[]).includes(body.level)
  ) {
    fail('level 仅支持 block/review');
  }

  let note: string | undefined;
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== 'string' || body.note.length > MAX_NOTE_LEN) {
      fail(`note 须为不超过 ${MAX_NOTE_LEN} 字的字符串`);
    }
    note = body.note;
  }

  return {
    word: body.word.trim(),
    type: body.type as WordType,
    level: body.level as WordLevel,
    note,
  };
}
