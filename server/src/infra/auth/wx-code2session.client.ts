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
      return {
        openid: code,
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
