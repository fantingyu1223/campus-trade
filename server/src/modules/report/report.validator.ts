/**
 * report.validator.ts —— 举报入参字段校验（9001 聚合式拦截）
 *
 * @module PIM-BC-05 举报
 * @api §5.2 #40 POST /reports
 * 口径：target_type 枚举受限（product/user/order/want_buy/message）；
 * category 枚举受限（fraud/prohibited/false_desc/other，兼容契约字段 type 别名）；
 * content 必填非空 ≤500 字（兼容契约字段 desc 别名）；
 * evidence_urls ≤9 张、逐项非空字符串（兼容契约字段 evidence 别名，可缺省为空数组）。
 */
// BusinessError 自 service 导入（循环安全：service → validator 仅值引用 BusinessError 类本身）
import { BusinessError } from './report.service';
import { ERROR_CODES } from '@contract/index';
import type { ReportCategory, ReportTargetType, SubmitReportInput } from './dto/report.dto';

/** @api #40 target_type 枚举白名单（T-301 口径） */
const TARGET_TYPES: readonly string[] = ['product', 'user', 'order', 'want_buy', 'message'];

/** @api #40 举报理由枚举白名单（对应 report.category，§4.21） */
const CATEGORIES: readonly string[] = ['fraud', 'prohibited', 'false_desc', 'other'];

const MAX_EVIDENCE = 9;
const MAX_CONTENT_LEN = 500;

const asBody = (raw: unknown): Record<string, unknown> => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, '缺少必填字段：请求体');
  }
  return raw as Record<string, unknown>;
};

const toTargetType = (v: unknown): ReportTargetType => {
  if (typeof v !== 'string' || !TARGET_TYPES.includes(v)) {
    throw new BusinessError(
      ERROR_CODES.PARAM_VALIDATION_FAILED,
      `target_type 非法（仅支持 ${TARGET_TYPES.join('/')}）`,
    );
  }
  return v as ReportTargetType;
};

const toBigInt = (v: unknown, field: string): bigint => {
  if (typeof v !== 'string' && typeof v !== 'number') {
    throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, `缺少必填字段：${field}`);
  }
  try {
    const n = BigInt(v);
    if (n <= BigInt(0)) throw new Error();
    return n;
  } catch {
    throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, `${field} 非法`);
  }
};

const toCategory = (body: Record<string, unknown>): ReportCategory => {
  // category 优先；契约 #40 字段 type 作为别名兼容
  const v = body.category !== undefined ? body.category : body.type;
  if (typeof v !== 'string' || !CATEGORIES.includes(v)) {
    throw new BusinessError(
      ERROR_CODES.PARAM_VALIDATION_FAILED,
      `举报理由非法（仅支持 ${CATEGORIES.join('/')}）`,
    );
  }
  return v as ReportCategory;
};

const toContent = (body: Record<string, unknown>): string => {
  // content 优先；契约 #40 字段 desc 作为别名兼容
  const v = body.content !== undefined ? body.content : body.desc;
  if (typeof v !== 'string') {
    throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, '缺少必填字段：content');
  }
  if (v.trim().length === 0) {
    throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, 'content 不能为空串');
  }
  if (v.length > MAX_CONTENT_LEN) {
    throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, `content 不能超过 ${MAX_CONTENT_LEN} 字`);
  }
  return v;
};

const toEvidenceUrls = (body: Record<string, unknown>): string[] => {
  // evidence_urls 优先；契约 #40 字段 evidence 作为别名兼容
  const v = body.evidence_urls !== undefined ? body.evidence_urls : body.evidence;
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) {
    throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, 'evidence_urls 须为数组');
  }
  if (v.length > MAX_EVIDENCE) {
    throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, `凭证图最多 ${MAX_EVIDENCE} 张`);
  }
  for (const item of v) {
    if (typeof item !== 'string' || item.trim().length === 0) {
      throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, 'evidence_urls 含非法 URL 项');
    }
  }
  return v as string[];
};

/** #40 提交举报入参校验：枚举白名单 / 凭证 ≤9 / content ≤500 非空串 / target_id 正整数 */
export function validateSubmitReport(raw: unknown): SubmitReportInput {
  const body = asBody(raw);
  return {
    targetType: toTargetType(body.target_type),
    targetId: toBigInt(body.target_id, 'target_id'),
    category: toCategory(body),
    content: toContent(body),
    evidenceUrls: toEvidenceUrls(body),
  };
}
