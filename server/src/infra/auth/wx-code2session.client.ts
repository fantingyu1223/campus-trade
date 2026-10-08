/**
 * @model PIM-AG-01
 * 纯技术设施：微信 jscode2session 客户端。
 * WX_MOCK==='true' 时走本地 mock，不发起真实网络请求。
 */
import { Injectable } from '@nestjs/common';

export class WxCode2SessionError extends Error {
  constructor(
    public readonly errcode: number,
    message: string,
  ) {
    super(message);
    this.name = 'WxCode2SessionError';
  }
}

export interface WxCode2SessionResult {
  openid: string;
  unionid: string | null;
  session_key: string;
}

@Injectable()
export class WxCode2SessionClient {
  async code2session(code: string): Promise<WxCode2SessionResult> {
    if (process.env.WX_MOCK === 'true') {
      // mock 口径：真实 wx.login 返回的是一次性随机 code（长串），若直接当 openid
      // 会导致每次登录都注册新账号、用户数据全部"丢失"；故长 code 一律映射为
      // 稳定 mock openid（单账号开发联调），短字面量 code（如 qa-seller-* 等
      // API 测试/脚本显式传入）保留独立账号以支持多用户场景。
      const openid = code.length > 24 ? 'mock_openid_default' : code;
      return {
        openid,
        unionid: null,
        session_key: 'mock-session-key',
      };
    }

    const appid = process.env.WX_APPID;
    const secret = process.env.WX_SECRET;
    if (!appid || !secret) {
      throw new WxCode2SessionError(
        -1,
        'WX_APPID/WX_SECRET 未配置，无法调用微信 code2session',
      );
    }

    const url =
      'https://api.weixin.qq.com/sns/jscode2session' +
      `?appid=${encodeURIComponent(appid)}` +
      `&secret=${encodeURIComponent(secret)}` +
      `&js_code=${encodeURIComponent(code)}` +
      '&grant_type=authorization_code';

    const resp = await fetch(url);
    const body = (await resp.json()) as {
      errcode?: number;
      errmsg?: string;
      openid?: string;
      unionid?: string;
      session_key?: string;
    };

    if (body.errcode && body.errcode !== 0) {
      throw new WxCode2SessionError(
        body.errcode,
        body.errmsg ?? `wx errcode=${body.errcode}`,
      );
    }
    if (!body.openid) {
      throw new WxCode2SessionError(-1, '微信响应缺少 openid');
    }
    return {
      openid: body.openid,
      unionid: body.unionid ?? null,
      session_key: body.session_key ?? '',
    };
  }
}
