/**
 * utils/session.ts —— 登录态（token）读写与检查工具。
 * token 由 POST /auth/wx-login 签发（docs/design §2.6：JWT access 7 天 + refresh 30 天）。
 * @module PIM-BC-01 用户与认证
 */

const TOKEN_KEY = 'auth_token';
const REFRESH_TOKEN_KEY = 'auth_refresh_token';
const USER_KEY = 'auth_user';

export interface SessionUser {
  id: number;
  nickname?: string;
  avatar?: string;
  /** 个人简介（/auth/me 返回） */
  bio?: string;
  /** 匿名展示开关（N6；/auth/me 返回） */
  is_anonymous?: boolean;
  role: string;
  verified: boolean;
  school_id?: number;
  credit_score?: number;
}

/** 读取 access token，未登录返回空串 */
export function getToken(): string {
  return wx.getStorageSync(TOKEN_KEY) || '';
}

/** 读取 refresh token */
export function getRefreshToken(): string {
  return wx.getStorageSync(REFRESH_TOKEN_KEY) || '';
}

/** 写入登录态（token + 用户快照） */
export function saveSession(token: string, refreshToken: string, user: SessionUser): void {
  wx.setStorageSync(TOKEN_KEY, token);
  wx.setStorageSync(REFRESH_TOKEN_KEY, refreshToken);
  wx.setStorageSync(USER_KEY, user);
}

/** 读取用户快照 */
export function getUser(): SessionUser | null {
  return wx.getStorageSync(USER_KEY) || null;
}

/** 更新用户快照（如认证通过后回写 verified） */
export function saveUser(user: SessionUser): void {
  wx.setStorageSync(USER_KEY, user);
}

/** 是否已登录（仅判断 token 存在，有效性由服务端 1001/1002 判定） */
export function isLoggedIn(): boolean {
  return !!getToken();
}

/** 清除登录态（登出 / token 失效时调用） */
export function clearSession(): void {
  wx.removeStorageSync(TOKEN_KEY);
  wx.removeStorageSync(REFRESH_TOKEN_KEY);
  wx.removeStorageSync(USER_KEY);
}

/**
 * 微信登录：wx.login 取 code → POST /auth/wx-login 换 token。
 * 返回用户快照；失败时 reject（调用方负责 toast）。
 */
export function login(): Promise<SessionUser> {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (res) => {
        if (!res.code) {
          reject(new Error('wx.login 未返回 code'));
          return;
        }
        // 延迟 require 避免与 services/api/auth 循环依赖
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { wxLogin } = require('../services/api/auth');
        wxLogin(res.code)
          .then((data: { token: string; refresh_token: string; user: SessionUser }) => {
            saveSession(data.token, data.refresh_token, data.user);
            resolve(data.user);
          })
          .catch(reject);
      },
      fail: (err) => reject(err),
    });
  });
}

/**
 * 登录态守卫：已登录直接通过；未登录跳转 U2 登录页并 reject。
 * 用于发布、发起会话、交易等受限操作前置拦截（F1-AC2 / N1）。
 */
export function ensureLogin(): Promise<SessionUser> {
  const user = getUser();
  if (isLoggedIn() && user) {
    return Promise.resolve(user);
  }
  wx.navigateTo({ url: '/pages/login/login' });
  return Promise.reject(new Error('未登录'));
}
