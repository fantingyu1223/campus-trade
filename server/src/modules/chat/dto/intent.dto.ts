/**
 * intent.dto.ts —— 交易意向卡片出入参类型（纯声明，无逻辑）
 *
 * @module PIM-BC-03 沟通与协商
 * @model PIM-AG-05 交易意向卡片聚合（TradeIntentCard）
 * @table trade_intent → PIM-AG-05
 * @api §5.2 #28 POST /conversations/:id/intents + #29 POST /intents/:id/respond
 * @ac F14-AC1 双方确认后卡片置「双方已确认」；任一方未确认前为待确认
 */

/** 意向卡片状态（trade_intent.status，@model PIM-AG-05） */
export type TradeIntentStatusValue = 'pending' | 'confirmed' | 'cancelled';

/** 响应动作（契约 §5.2 #29：accept 确认 / reject 拒绝） */
export type IntentRespondAction = 'accept' | 'reject';

/** 发起意向卡片结果（@api §5.2 #28：intent_id + status=pending） */
export interface CreateIntentResult {
  intent_id: string;
  status: TradeIntentStatusValue;
}

/**
 * 响应意向卡片结果（@api §5.2 #29：status + order_id）。
 * order_id 由 order 模块契约接口生成；本批次以契约占位注释声明、不实际调用，
 * 故此处恒为 null（跨模块纪律：chat 不直调 order，见 intent.service.ts 注释）。
 */
export interface RespondIntentResult {
  status: TradeIntentStatusValue;
  order_id: string | null;
}
