/**
 * @model PIM-AG-01
 * @api F26 POST /account/cancel；GET /account/cancel/status
 * 账号注销模块 DTO：注销申请请求/响应、在途拦截清单、注销状态查询响应。
 * 对齐 API 契约风格；id 以 string 输出（BigInt 序列化为字符串）。
 */

/** 注销申请请求：confirm 二次确认必填（F26-AC1「发起注销并确认」） */
export interface AccountCancelRequest {
  confirm: boolean;
  /** 注销原因（可选，留痕用） */
  reason?: string;
}

/** 在途订单清单项（9001 拦截时随 error.data 返回，提示须先完结） */
export interface AccountCancelPendingOrder {
  order_id: string;
  order_no: string;
  status: string;
}

/** 未结申诉清单项（9001 拦截时随 error.data 返回） */
export interface AccountCancelPendingAppeal {
  appeal_id: string;
  appeal_type: string;
  status: string;
}

/** 在途拦截（9001）error.data 载荷：在途事项清单 */
export interface AccountCancelBlockData {
  pending_orders: AccountCancelPendingOrder[];
  pending_appeals: AccountCancelPendingAppeal[];
}

/** 注销申请响应 */
export interface AccountCancelResponse {
  status: 'cancelled';
  cancelled_at: string | null;
}

/** 注销状态查询响应 */
export interface AccountCancelStatusResponse {
  status: string;
  cancelled_at: string | null;
  logout_requested_at: string | null;
}
