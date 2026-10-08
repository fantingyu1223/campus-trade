/**
 * @model PIM-AG-01
 * @api §5.2 #3/#4
 * 身份认证模块 DTO：认证提交请求/响应与认证状态查询响应。
 * 对齐 API 契约；id/school_id 以 string 输出（BigInt 序列化为字符串）。
 */
import { VerifyType } from '@contract/enums';

/** 认证状态查询的可选状态：none 表示从未提交过认证 */
export type VerificationStatusView = 'none' | 'pending' | 'approved' | 'rejected';

export interface VerifySubmitRequest {
  school_id: string;
  verify_type: VerifyType;
  student_no?: string;
  campus_email?: string;
  real_name?: string;
  /** 是否教职工身份（F1：教职工沿用学生规则，落库 staff_flag） */
  staff_flag?: boolean;
  major?: string;
  enrollment_year?: number;
}

export interface VerifySubmitResponse {
  id: string;
  /** pending=待审核（生产流程）；approved=WX_MOCK 联调自动通过 */
  status: 'pending' | 'approved';
  submitted_at: string;
}

export interface VerifyStatusResponse {
  status: VerificationStatusView;
  verify_type: VerifyType | null;
  school_id: string | null;
  reject_reason: string | null;
  submitted_at: string | null;
}
