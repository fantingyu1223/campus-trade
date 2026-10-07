/**
 * admin-auth.service.ts —— 后台管理员登录业务逻辑（§5.3 #51）
 *
 * @module PIM-BC-05
 * @rule 运营角色相关规则（Modeling/cim/业务流程与规则.md、traceability.md：
 *       后台账号与 C 端用户完全隔离；RBAC 两角色 auditor 审核员 / admin 超管）
 * @api §5.3 #51
 *
 * 技术方案 §2.6 认证方案：管理后台 = 账号密码（bcrypt）+ JWT（access 2 小时）
 * + RBAC 两角色。令牌由 infra/auth 的 signToken 签发（HS256），payload 含
 * admin_id 与 role，与 AdminJwtGuard 校验口径互通（scripts/sign-admin-token.py
 * 签发的开发 token 同样可过 guard，二者共用同一 secret 与 payload 结构）。
 *
 * 错误码口径（契约 #51）：凭证错误 → 1001（不区分账号不存在/密码错误，防枚举）；
 * 账号停用 → 1003。
 */
import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { ERROR_CODES } from '@contract/error-codes';
import { signToken } from '@infra/auth/jwt.guard';
import { AdminAuthRepository } from './admin-auth.repository';
import { validateAdminLoginBody } from './admin-auth.validator';

/** 业务异常载体：code 为契约错误码，全局 BusinessErrorFilter 映射统一包络 */
export class BusinessError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'BusinessError';
  }
}

/** access token TTL：2 小时（技术方案 §2.6） */
export const ACCESS_TOKEN_TTL_SEC = 2 * 60 * 60;
/** refresh token TTL：7 天（#52 刷新端点后续批次实现，本批仅按契约返回字段） */
export const REFRESH_TOKEN_TTL_SEC = 7 * 24 * 60 * 60;

@Injectable()
export class AdminAuthService {
  constructor(private readonly repo: AdminAuthRepository) {}

  /**
   * §5.3 #51 后台登录：校验凭证 → 回写 last_login_at → 签发 JWT。
   * 返回 {access_token, refresh_token, token_type, expires_in, operator{id, role, name}}。
   */
  async login(rawBody: unknown, now = new Date()) {
    const { username, password } = validateAdminLoginBody(rawBody);

    const admin = await this.repo.findByUsername(username);
    if (!admin) {
      throw new BusinessError(ERROR_CODES.AUTH_TOKEN_INVALID, '账号或密码错误');
    }
    if (admin.status !== 'active') {
      // 契约 #51 指定错误码 1003（账号停用）
      throw new BusinessError(ERROR_CODES.PERMISSION_DENIED, '账号已停用');
    }

    // bcrypt 校验；占位/非法哈希视为校验失败（不泄露细节）
    let passwordOk = false;
    try {
      passwordOk = await bcrypt.compare(password, admin.password_hash);
    } catch {
      passwordOk = false;
    }
    if (!passwordOk) {
      throw new BusinessError(ERROR_CODES.AUTH_TOKEN_INVALID, '账号或密码错误');
    }

    await this.repo.touchLastLogin(admin.id, now);

    const payload = { admin_id: String(admin.id), role: admin.role };
    return {
      access_token: signToken(payload, ACCESS_TOKEN_TTL_SEC),
      refresh_token: signToken({ ...payload, token_type: 'refresh' }, REFRESH_TOKEN_TTL_SEC),
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SEC,
      operator: { id: String(admin.id), role: admin.role, name: admin.username },
    };
  }
}
