/**
 * services/api/appeal.ts —— appeal 申诉分组接口封装（F30/F31，用户侧）。
 * @api §5.2 appeal 分组（#42 POST /appeals 提交申诉 / #43 GET /appeals/mine 我的申诉列表）
 * 复用 auth.ts 导出的通用 request；统一响应包络由 request 解析。
 * @module PIM-BC-05 评价与治理
 *
 * 48h 介入时限（F30-AC1）：运营 48 小时内介入裁决，详见 §4.22 appeal 表 sla_deadline。
 * 契约偏离说明：#42 表仅列 punish_id/reason/evidence[]；为支撑 U21 申诉类型选择
 * （卖家失联/错标已售/货不对板/误封复核），本封装扩展 appeal_type/sub_reason/order_id
 * 三个字段透传（AppealType 对齐 types/contract.ts），待后端契约确认后收敛。
 */
import { request } from './auth';
import { AppealType, AppealStatus, AppealResult } from '../../types/contract';

// ---------- 类型定义（对齐 §5.2 #42-43 + §4.22 appeal 表） ----------
/** U21 申诉子类型（F30 交易纠纷 / F31 处罚复核，UI picker 枚举） */
export type AppealSubReason = 'seller_lost' | 'wrong_sold' | 'not_as_described' | 'punish_review';

/** 提交申诉请求（#42 + 扩展字段，见头注释偏离说明） */
export interface SubmitAppealPayload {
  /** 申诉大类：dispute 交易纠纷 / punishment 处罚申诉（contract AppealType） */
  appeal_type: AppealType;
  /** 子类型（U21 picker：卖家失联/错标已售/货不对板/误封复核） */
  sub_reason: AppealSubReason;
  /** 对应处罚记录 ID（F31 误封复核必填，#42 字段） */
  punish_id?: number;
  /** 关联订单 ID（F30 交易纠纷时携带） */
  order_id?: number;
  /** 申诉理由（≤500 字，#42 字段 reason） */
  reason: string;
  /** 凭证：聊天记录/付款凭证/约定信息（≤9 张） */
  evidence?: string[];
}

/** 提交申诉响应（#42） */
export interface SubmitAppealResult {
  appeal_id: number;
  status: AppealStatus.PENDING;
}

/** 我的申诉列表项（#43） */
export interface MyAppealItem {
  appeal_id: number;
  status: AppealStatus;
  result?: AppealResult;
  created_at: string;
}

export interface MyAppealListResult {
  list: MyAppealItem[];
  has_more: boolean;
}

// ---------- #42 POST /appeals 提交申诉（无对应处罚记录返回 5004） ----------
export function submitAppeal(payload: SubmitAppealPayload): Promise<SubmitAppealResult> {
  return request<SubmitAppealResult>({
    url: '/appeals',
    method: 'POST',
    data: payload as unknown as Record<string, unknown>,
  });
}

// ---------- #43 GET /appeals/mine 我的申诉列表 ----------
export function listMyAppeals(page = 1, pageSize = 20): Promise<MyAppealListResult> {
  return request<MyAppealListResult>({
    url: '/appeals/mine',
    method: 'GET',
    data: { page, pageSize },
  });
}
