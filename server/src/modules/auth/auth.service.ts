/**
 * @module PIM-BC-01
 * @model PIM-AG-01
 * 认证领域服务：微信登录（code2session + 用户创建/更新 + 双 token 签发）与当前用户信息查询。
 */
import { Injectable } from '@nestjs/common';
import { AuthRepository, UserRow } from './auth.repository';
import { WxCode2SessionClient } from '@infra/auth/wx-code2session.client';
import { signToken } from '@infra/auth/jwt.guard';
import { validateWxLoginDto } from './auth.validator';
import { AuthMeResponse, WxLoginResponse } from './dto/login.dto';

export class BusinessError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    /** 可选错误明细（如 9001 在途拦截清单），向后兼容旧调用方 */
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = 'BusinessError';
  }
}

const ACCESS_TTL_SEC = 7 * 24 * 3600;
const REFRESH_TTL_SEC = 30 * 24 * 3600;

@Injectable()
export class AuthService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly wxClient: WxCode2SessionClient,
  ) {}

  /**
   * @api §5.2 #1 POST /auth/wx-login
   * @ac F1
   * 校验入参（9001 透传）→ 微信 code2session（异常 → 1001）
   * → 查/建用户并更新最后登录 → 签发 access/refresh 双 token。
   */
  async wxLogin(input: unknown): Promise<WxLoginResponse> {
    const dto = validateWxLoginDto(input);

    let session: { openid: string; unionid: string | null };
    try {
      session = await this.wxClient.code2session(dto.code);
    } catch {
      throw new BusinessError(1001, '微信登录凭证无效');
    }

    let user = await this.repo.findByOpenid(session.openid);
    if (!user) {
      user = await this.repo.createUser(session.openid, session.unionid);
    } else {
      // @model PIM-AG-01 已注销终态不变量：不可逆、不可再登录——
      // cancelled 账号一律拦截（1005），不签发 token、不更新 last_login_at
      if (user.status === 'cancelled') {
        throw new BusinessError(1005, '账号已注销，不可再登录');
      }
      await this.repo.updateLastLogin(user.id, new Date());
    }

    // WX_MOCK 开发联调：未挂靠学校的用户自动挂靠首个启用学校，
    // 使发布/搜索等以 school_id 为数据隔离边界的链路可本地跑通（正式流程由认证/加入申请写入）
    if (process.env.WX_MOCK === 'true' && !user.school_id) {
      const schoolId = await this.repo.findFirstActiveSchoolId();
      if (schoolId) user = await this.repo.assignSchool(user.id, schoolId);
    }

    const schoolId = user.school_id ? user.school_id.toString() : null;
    const token = signToken(
      { uid: user.id.toString(), role: user.identity_type, school_id: schoolId },
      ACCESS_TTL_SEC,
    );
    const refreshToken = signToken(
      { uid: user.id.toString(), type: 'refresh' },
      REFRESH_TTL_SEC,
    );

    return {
      token,
      refresh_token: refreshToken,
      user: {
        id: user.id.toString(),
        role: user.identity_type,
        verified: user.identity_type !== 'guest',
        school_id: schoolId,
      },
    };
  }

  /**
   * @api §5.2 #2 GET /auth/me
   * @ac F1
   * 按 uid 查询当前用户信息；不存在 → 1001「用户不存在」。
   */
  async me(uid: string): Promise<AuthMeResponse> {
    const user = await this.repo.findById(uid);
    if (!user) {
      throw new BusinessError(1001, '用户不存在');
    }
    return this.toMeResponse(user);
  }

  private toMeResponse(user: UserRow): AuthMeResponse {
    return {
      id: user.id.toString(),
      nickname: user.nickname ?? '',
      avatar: user.avatar_url ?? '',
      role: user.identity_type,
      verified: user.identity_type !== 'guest',
      school_id: user.school_id ? user.school_id.toString() : null,
      credit_score: null,
    };
  }
}
