/**
 * risk.dto.ts —— 黄牛预警复核 DTO 与脱敏工具（T-304）
 * @module PIM-BC-05
 * @rule CIM-R-36
 */

export interface RiskWarningListQuery {
  status?: string; // pending | handled（默认 pending）
  rule_code?: string; // daily_ge5 | cross_ge3_cat | suspected_merchant
  page?: string | number;
  pageSize?: string | number;
}

export interface ReviewRequest {
  conclusion?: string; // confirm | ignore
  action_detail?: string; // warning | ban（可选，转处置）
  handle_note?: string;
  note?: string;
}

export interface ReviewResponse {
  warning: {
    id: string;
    status: 'handled';
    conclusion: string;
  };
}

/** 用户 ID 脱敏：'***' + 尾 4 位 */
export function maskUserId(id: bigint | string): string {
  return '***' + String(id).slice(-4);
}
