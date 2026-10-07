/**
 * @table user → PIM-AG-01
 * 认证仓储：封装 user 表访问，供 auth.service 使用。
 * 查询结果以 UserRow 视图返回（as unknown as UserRow）。
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infra/prisma.service';

export interface UserRow {
  id: bigint;
  openid: string;
  unionid: string | null;
  nickname: string | null;
  avatar_url: string | null;
  bio: string | null;
  identity_type: string;
  school_id: bigint | null;
  status: string;
}

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByOpenid(openid: string): Promise<UserRow | null> {
    const row = await this.prisma.user.findUnique({ where: { openid } });
    return row as unknown as UserRow | null;
  }

  async findById(id: string): Promise<UserRow | null> {
    const row = await this.prisma.user.findUnique({
      where: { id: BigInt(id) },
    });
    return row as unknown as UserRow | null;
  }

  async createUser(
    openid: string,
    unionid?: string | null,
  ): Promise<UserRow> {
    const row = await this.prisma.user.create({
      data: {
        openid,
        unionid: unionid ?? null,
        identity_type: 'guest',
        status: 'normal',
        last_login_at: new Date(),
      },
    });
    return row as unknown as UserRow;
  }

  async updateLastLogin(id: bigint, at: Date): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { last_login_at: at },
    });
  }
}
