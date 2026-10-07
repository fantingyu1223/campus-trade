/**
 * admin-auth.repository.ts —— 后台管理员账号数据访问（§5.3 #51）
 *
 * @module PIM-BC-05
 * @table admin_user → 无聚合 BC-06（运营支撑；后台账号，与 C 端 user 完全隔离）
 *
 * 本层只做数据存取，不含认证规则；密码校验（bcrypt）与令牌签发生在 service。
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infra/prisma.service';

/** admin_user 表行（本模块消费字段集） */
export interface AdminUserRow {
  id: bigint;
  username: string;
  password_hash: string;
  role: string;
  status: string;
  last_login_at: Date | null;
}

@Injectable()
export class AdminAuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** @api §5.3 #51 按用户名取管理员（唯一键 uk_username） */
  async findByUsername(username: string): Promise<AdminUserRow | null> {
    return (await this.prisma.adminUser.findFirst({
      where: { username },
    })) as AdminUserRow | null;
  }

  /** 登录成功回写最近登录时间 */
  async touchLastLogin(id: bigint, at: Date): Promise<void> {
    await this.prisma.adminUser.update({
      where: { id },
      data: { last_login_at: at },
    });
  }
}
