/**
 * services/api/auth.ts —— auth 认证分组接口封装。
 * @api §5.2 auth 认证分组（#1 wx-login / #2 me / #3 verify / #4 verify/status）
 * baseURL 为占位（后端未就绪），统一响应包络 ApiResponse{code,message,data}。
 * 另导出通用 request() 供同目录其他分组复用。
 */
import { ApiResponse } from '../../types/contract';
import { getToken, clearSession, SessionUser } from '../../utils/session';
import { API_BASE } from '../../config';

/** 统一配置入口：见 miniprogram/config.ts（环境切换只改那一处） */
export const BASE_URL = API_BASE;

interface RequestOptions {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  data?: Record<string, unknown>;
  /** 默认携带 token（§5.1：未认证接口不要求 token，但携带时返回个性化字段） */
  auth?: boolean;
}

/** 通用请求封装：统一包络解析、token 注入、401(1001/1002) 登出 */
export function request<T>(options: RequestOptions): Promise<T> {
  const { url, method = 'GET', data = {}, auth = true } = options;
  const header: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getToken();
    if (token) header.Authorization = `Bearer ${token}`;
  }
  // wx.request 会把 undefined 序列化成字符串 "undefined" 发给服务端，
  // 导致后端参数校验误报（如 min_price 非法），统一剥离 undefined 键
  const cleanData: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined && v !== '') cleanData[k] = v;
  }
  return new Promise<T>((resolve, reject) => {
    wx.request({
      url: BASE_URL + url,
      // miniprogram-api-typings 的 method 联合未含 PATCH（运行时支持），此处收窄断言
      method: method as WechatMiniprogram.RequestOption['method'],
      data: cleanData,
      header,
      success: (res) => {
        const body = res.data as ApiResponse<T>;
        if (!body || typeof body.code !== 'number') {
          reject(new Error(`服务异常（${res.statusCode}），请稍后重试`));
          return;
        }
        if (body.code === 0) {
          resolve(body.data as T);
          return;
        }
        // token 无效/过期：清除本地登录态并引导重新登录
        if (body.code === 1001 || body.code === 1002) {
          clearSession();
          wx.navigateTo({ url: '/pages/login/login' });
        }
        const err = new Error(body.message || `请求失败(${body.code})`) as Error & { code?: number };
        err.code = body.code;
        reject(err);
      },
      fail: (err) => reject(new Error(err.errMsg || '网络异常，请稍后重试')),
    });
  });
}

// ---------- #1 POST /auth/wx-login 微信登录（F1） ----------
export interface WxLoginResult {
  token: string;
  refresh_token: string;
  user: SessionUser;
}

export function wxLogin(code: string): Promise<WxLoginResult> {
  return request<WxLoginResult>({
    url: '/auth/wx-login',
    method: 'POST',
    data: { code },
    auth: false,
  });
}

// ---------- #2 GET /auth/me 获取当前用户 ----------
export function getMe(): Promise<SessionUser> {
  return request<SessionUser>({ url: '/auth/me' });
}

// ---------- #3 POST /auth/verify 提交实名认证（F1/F36，两通道+教职工标记） ----------
/** 对齐服务端 verification.validator：school_id 为字符串，verify_type 两通道，staff_flag 标记教职工 */
export interface VerifySubmitPayload {
  school_id: string;
  verify_type: 'student_no' | 'campus_email';
  student_no?: string;
  campus_email?: string;
  real_name?: string;
  staff_flag?: boolean;
}

export interface VerifySubmitResult {
  id: string;
  /** pending=待审核（生产流程）；approved=WX_MOCK 联调自动通过 */
  status: 'pending' | 'approved';
}

export function submitVerify(payload: VerifySubmitPayload): Promise<VerifySubmitResult> {
  return request<VerifySubmitResult>({ url: '/auth/verify', method: 'POST', data: payload as unknown as Record<string, unknown> });
}

// ---------- #4 GET /auth/verify/status 认证状态查询 ----------
export interface VerifyStatusResult {
  status: 'none' | 'pending' | 'approved' | 'rejected';
  reject_reason?: string;
}

export function getVerifyStatus(): Promise<VerifyStatusResult> {
  return request<VerifyStatusResult>({ url: '/auth/verify/status' });
}
