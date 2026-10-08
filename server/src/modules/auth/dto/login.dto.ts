/**
 * @model PIM-AG-01
 * 认证模块 DTO：微信登录请求/响应与当前用户信息响应。
 * 对齐 API 契约；id/school_id 以 string 输出（BigInt 序列化为字符串）。
 */

export interface WxLoginRequest {
  code: string;
}

export interface WxLoginResponse {
  token: string;
  refresh_token: string;
  user: {
    id: string;
    role: string;
    verified: boolean;
    school_id: string | null;
  };
}

export interface AuthMeResponse {
  id: string;
  nickname: string;
  avatar: string;
  /** 个人简介（user.bio） */
  bio: string;
  /** 匿名展示开关（N6：开启后公开档案与商品卖家信息展示为「匿名用户」） */
  is_anonymous: boolean;
  role: string;
  verified: boolean;
  school_id: string | null;
  credit_score: number | null;
}
