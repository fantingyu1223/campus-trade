/**
 * services/api/account.ts —— account 账号分组接口封装（F26 账号注销）。
 * @api §5.2 #50 POST /users/me/deactivate 注销申请
 * 复用 auth.ts 导出的通用 request；统一响应包络由 request 解析。
 * @module PIM-BC-01 用户与认证
 *
 * 规则口径（F26 / §4 user 表）：
 * - 注销须二次确认（confirm=true），注销后不可恢复、名下商品自动下架；
 * - 存在在途交易（已付款未确认/申诉中）或未结申诉时被拦截，返回 4002，须先完结在途事项；
 * - 注销申请后进入冷静期，effective_at 生效（F27 延后上限 30 天口径一致）。
 */
import { request } from './auth';

// ---------- 类型定义（对齐 §5.2 #50） ----------
/** 注销申请请求（#50） */
export interface CancelAccountPayload {
  /** 注销原因（可选） */
  reason?: string;
  /** 二次确认标记（前端须完成「输入注销二字」确认后置 true） */
  confirm: boolean;
}

/** 注销申请响应（#50） */
export interface CancelAccountResult {
  status: 'pending';
  /** 冷静期后生效时间（ISO8601） */
  effective_at: string;
}

// ---------- #50 POST /users/me/deactivate 注销申请（存在在途交易返回 4002） ----------
export function cancelAccount(payload: CancelAccountPayload): Promise<CancelAccountResult> {
  return request<CancelAccountResult>({
    url: '/users/me/deactivate',
    method: 'POST',
    data: payload as unknown as Record<string, unknown>,
  });
}
