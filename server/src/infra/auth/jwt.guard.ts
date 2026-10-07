/**
 * @model PIM-AG-01
 * 纯技术设施：JWT 签发/校验（node:crypto HS256）与认证守卫。
 * 不包含业务规则，仅负责 token 技术校验与用户状态装载。
 */
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma.service';

export class TokenInvalidError extends Error {
  constructor(message = 'token invalid') {
    super(message);
    this.name = 'TokenInvalidError';
  }
}

export class TokenExpiredError extends Error {
  constructor(message = 'token expired') {
    super(message);
    this.name = 'TokenExpiredError';
  }
}

function jwtSecret(): string {
  return process.env.JWT_SECRET ?? 'campus-trade-dev-secret';
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function sign(data: string): string {
  return base64url(createHmac('sha256', jwtSecret()).update(data).digest());
}

export function signToken(
  payload: Record<string, unknown>,
  ttlSec: number,
): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const iat = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat, exp: iat + ttlSec };
  const headPart = base64url(JSON.stringify(header));
  const bodyPart = base64url(JSON.stringify(body));
  const signingInput = `${headPart}.${bodyPart}`;
  return `${signingInput}.${sign(signingInput)}`;
}

export function verifyToken(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new TokenInvalidError('token must have 3 segments');
  }
  const signingInput = `${parts[0]}.${parts[1]}`;
  const expected = sign(signingInput);
  const a = Buffer.from(expected);
  const b = Buffer.from(parts[2]);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new TokenInvalidError('signature mismatch');
  }
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
  } catch {
    throw new TokenInvalidError('payload parse failed');
  }
  const exp = payload.exp;
  if (typeof exp !== 'number' || exp < Math.floor(Date.now() / 1000)) {
    throw new TokenExpiredError();
  }
  return payload;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

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

    let uid: bigint;
    try {
      uid = BigInt(payload.uid as string | number | bigint);
    } catch {
      throw new UnauthorizedException({
        code: 1001,
        message: '未登录或 token 无效',
        data: null,
      });
    }

    const user = await this.prisma.user.findUnique({ where: { id: uid } });
    if (!user) {
      throw new UnauthorizedException({
        code: 1001,
        message: '未登录或 token 无效',
        data: null,
      });
    }
    if ((user as { status?: string }).status !== 'normal') {
      throw new UnauthorizedException({
        code: 1005,
        message: '用户已被禁用',
        data: null,
      });
    }

    req.user = {
      uid: payload.uid,
      id: String(user.id),
      role: payload.role,
      school_id: payload.school_id ?? null,
      identity_type: (user as { identity_type?: string }).identity_type ?? 'student',
      status: (user as { status?: string }).status,
    };
    return true;
  }
}
