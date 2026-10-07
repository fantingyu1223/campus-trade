/**
 * @rule CIM-R-01
 * 已认证守卫（infra 层）：未认证用户（identity_type=guest）发布/发起会话等受限操作拦截。
 * 在 JwtAuthGuard 之后使用；按 uid 实时读取 user.identity_type（token 内 role 可能滞后）。
 * guest 或用户不存在 → 403 code 1004；student/staff/merchant 放行。
 */
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class VerifiedGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  static toJSON(): string {
    return this.name;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const uid: unknown = req.user?.uid;
    if (uid === undefined || uid === null) {
      throw new UnauthorizedException({
        code: 1001,
        message: '未登录或 token 无效',
        data: null,
      });
    }

    const user = await this.prisma.user.findUnique({
      where: { id: BigInt(uid as string | number | bigint) },
      select: { identity_type: true },
    });
    const identity = (user as { identity_type?: string } | null)?.identity_type;
    if (!identity || identity === 'guest') {
      throw new ForbiddenException({
        code: 1004,
        message: '未通过校园实名认证，暂无法执行该操作',
        data: null,
      });
    }
    return true;
  }
}
