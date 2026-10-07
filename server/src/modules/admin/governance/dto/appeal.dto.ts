/**
 * appeal.dto.ts —— 申诉仲裁 DTO（§5.3 #65-67，PRD F30 纠纷申诉 / F31 处罚申诉）
 *
 * @module PIM-BC-05 信任与治理（后台治理子域 admin/governance）
 * @model PIM-AG-09 申诉聚合
 *
 * 对齐基准：admin-web/src/api/appeal.ts 的 DTO 定义（前端已实现，偏差最小化）。
 * 口径说明：
 * - status 对外契约口径 pending/processing/done；DB 枚举为
 *   pending/processing/resolved/expired（schema AppealStatus），
 *   done ↔ resolved|expired 的映射集中在 repository 层，本 DTO 只出现契约口径。
 * - result 严格枚举 buyer_win/seller_win/both_warning/invalid（禁止自由文本）；
 *   落库映射 DB AppealResult（support/reject/partial），映射见 appeal.repository。
 * - linked_action 复用举报处置枚举 off_shelf/warning/ban/rejected，'无' 时不传。
 */

/** 申诉类型过滤（F30 纠纷 / F31 处罚） */
export const APPEAL_TYPES = ['dispute', 'punishment'] as const;
export type AppealTypeFilter = (typeof APPEAL_TYPES)[number];

/** 队列状态过滤口径（契约：pending/processing/done） */
export const APPEAL_STATUS_FILTERS = ['pending', 'processing', 'done'] as const;
export type AppealStatusFilter = (typeof APPEAL_STATUS_FILTERS)[number];

/** 裁决结论严格枚举（§5.3 #67 / admin-web AdjudicateResult） */
export const ADJUDICATE_RESULTS = ['buyer_win', 'seller_win', 'both_warning', 'invalid'] as const;
export type AdjudicateResult = (typeof ADJUDICATE_RESULTS)[number];

/** 可选关联处置（复用举报处置枚举） */
export const LINKED_ACTIONS = ['off_shelf', 'warning', 'ban', 'rejected'] as const;
export type LinkedAction = (typeof LINKED_ACTIONS)[number];

/** §5.3 #65 GET /admin/v1/appeals 查询参数 */
export interface AppealListQuery {
  type?: AppealTypeFilter;
  status?: AppealStatusFilter;
  page: number;
  pageSize: number;
}

/** §5.3 #67 POST /admin/v1/appeals/{id}/adjudicate 请求体 */
export interface AdjudicateBody {
  /** 裁决结论（必填，严格枚举） */
  result: AdjudicateResult;
  /** 裁决备注（必填；result=invalid 驳回申诉时即为驳回理由），≤500 字 */
  note: string;
  /** 可选关联处置，'无' 时不传 */
  linked_action?: LinkedAction;
}
