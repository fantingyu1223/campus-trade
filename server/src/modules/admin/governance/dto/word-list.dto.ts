/**
 * word-list.dto.ts —— 词表配置 DTO（§5.3 #82-86 的 type=word_list 具体化，PRD F22/F13）
 *
 * @module PIM-BC-06 词表管理（后台治理子域 admin/governance）
 * @table word_list → §4.24
 *
 * 对齐基准：admin-web/src/api/word-list.ts DTO（前端已实现，偏差最小化）。
 * 口径说明（映射集中在 repository/service 层，本 DTO 只出现契约口径）：
 * - 契约 level=block（直接拦截）/review（转人工复核）↔ DB RiskLevel
 *   high（拦截）/mid（留痕或打码）；DB low（仅提示）输出亦归 review（有损，留痕 detail 保原值）。
 * - 契约 status=enabled/disabled ↔ DB EnableStatus active/disabled。
 */

/** 词类型（与 Prisma WordListType 一致：risk 风险词 / violation 违规词 / prohibited 违禁品词） */
export const WORD_TYPES = ['risk', 'violation', 'prohibited'] as const;
export type WordType = (typeof WORD_TYPES)[number];

/** 命中级别（契约口径）：block 直接拦截 / review 转人工复核 */
export const WORD_LEVELS = ['block', 'review'] as const;
export type WordLevel = (typeof WORD_LEVELS)[number];

/** 词条状态（契约口径） */
export const WORD_STATUSES = ['enabled', 'disabled'] as const;
export type WordStatus = (typeof WORD_STATUSES)[number];

/** 列表查询参数 */
export interface WordListQuery {
  type?: WordType;
  page: number;
  pageSize: number;
}

/** 新增/修改词条请求体 */
export interface WordPayload {
  word: string;
  type: WordType;
  level: WordLevel;
  /** 变更事由（可选，留痕用；空白时系统生成默认事由） */
  note?: string;
}
