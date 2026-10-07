/**
 * @model PIM-AG-01
 * 后台管理员 JWT 认证守卫（§5.3 后台接口统一鉴权）。
 * 纯技术校验：token 由 admin 登录链路签发，payload 含 admin_id 与 role。
 * 角色门槛：仅 admin / auditor 放行（其余 → 6001）。
 */
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { TokenExpiredError, verifyToken } from './jwt.guard';

const ALLOWED_ROLES = ['admin', 'auditor'] as const;

type AdminRole = (typeof ALLOWED_ROLES)[number];

export interface AdminPrincipal {
  admin_id: string;
  role: AdminRole;
}

@Injectable()
export class AdminJwtGuard implements CanActivate {
  static toJSON(): string {
    return this.name;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const authHeader: unknown = req.headers?.authorization;
    if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException({
        code: 1001,
        message: '未登录或 token 无效',
        data: null,
      });
    }
    const token = authHeader.slice('Bearer '.length);

    let payload: Record<string, unknown>;
    try {
      payload = verifyToken(token);
    } catch (e) {
      if (e instanceof TokenExpiredError) {
        throw new UnauthorizedException({
          code: 1002,
          message: 'token 已过期',
          data: null,
        });
      }
      throw new UnauthorizedException({
        code: 1001,
        message: '未登录或 token 无效',
        data: null,
      });
    }

    const adminIdRaw = payload.admin_id;
    let adminId: string;
    try {
      if (
        typeof adminIdRaw !== 'string' &&
        typeof adminIdRaw !== 'number' &&
        typeof adminIdRaw !== 'bigint'
      ) {
        throw new Error('missing admin_id');
      }
      adminId = String(BigInt(adminIdRaw));
    } catch {
      throw new UnauthorizedException({
        code: 1001,
        message: '未登录或 token 无效',
        data: null,
      });
    }

    const role = payload.role;
    if (
      typeof role !== 'string' ||
      !(ALLOWED_ROLES as readonly string[]).includes(role)
    ) {
      throw new ForbiddenException({
        code: 6001,
        message: '管理员无权限',
        data: null,
      });
    }

    req.admin = { admin_id: adminId, role: role as AdminRole } satisfies AdminPrincipal;
    return true;
  }
}
