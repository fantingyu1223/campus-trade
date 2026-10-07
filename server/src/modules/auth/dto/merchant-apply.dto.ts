/**
 * @module PIM-BC-01
 * @model PIM-AG-10
 * @api §5.2 merchant #7-9
 * @ac F32-AC1
 * 商家入驻申请 DTO：提交请求/响应、申请状态查询响应、冷却期查询响应。
 * 对齐 §4.5 merchant_application 表；id 以 string 输出（BigInt 序列化为字符串）。
 *
 * 口径说明（任务 T-305 暂定口径 PIM-C-4）：
 *  - 冷却期：驳回后 30 天（自 reviewed_at 审核完成时刻起算），与 PRD F32 正文「7 天冷却」
 *    不一致，按任务口径实现，待 CEO/架构师裁决后统一（详见交付说明）。
 *  - SLA：sla_deadline = submitted_at + 2 天（MVP 简化口径，未跳过周末/法定节假日）。
 */

/** 申请状态查询的可选状态：none 表示从未提交过入驻申请 */
export type MerchantApplyStatusView = 'none' | 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface MerchantApplyRequest {
  shop_name: string;
  contact_phone: string;
  shop_address?: string;
  /** 营业执照图（必填资质） */
  license_image_url: string;
  /** 门店证明图（可选资质） */
  shop_proof_image_url?: string;
}

export interface MerchantApplyResponse {
  id: string;
  status: 'pending';
  submitted_at: string;
  sla_deadline: string;
}

export interface MerchantApplyStatusResponse {
  status: MerchantApplyStatusView;
  reject_reason_code: string | null;
  reject_reason_detail: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  /** 派生字段：rejected 且有 reviewed_at 时 = reviewed_at + 30 天，否则 null */
  cooldown_until: string | null;
}

export interface MerchantCooldownResponse {
  /** 冷却期内返回截止时刻（ISO），无冷却/已过期返回 null */
  cooldown_until: string | null;
}
