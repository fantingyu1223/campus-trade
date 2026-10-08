/**
 * user/user.repository.ts —— user 模块数据访问（模块自含，§3.1）。
 *
 * @module PIM-BC-01 身份与准入
 * @table user → PIM-AG-02 用户档案聚合（公开档案字段组）
 * @table school / product → 同 schema 只读投影（不 import 其他模块，经 PrismaService 直查，允许）
 *
 * 纪律：本模块对 product/school 表仅读不写；写入责任归 product/config 模块（PSM-02）。
 */
import { Injectable } from '@nestjs/common';
import type { ProductStatus } from '@prisma/client';
import { PrismaService } from '@infra/prisma.service';

/** user 表记录（Prisma User 形态） */
export interface UserRow {
  id: bigint;
  nickname: string;
  avatar_url: string;
  bio: string;
  /** 匿名展示开关（N6 匿名保护读侧脱敏依据） */
  is_anonymous: boolean;
  identity_type: string;
  school_id: bigint | null;
  status: string;
  created_at: Date;
}

/** product 表记录（主页列表所需字段） */
export interface ProductRow {
  id: bigint;
  title: string;
  price: { toString(): string };
  status: string;
  published_at: Date | null;
  sold_at: Date | null;
}

@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 按主键查 user（公开档案数据源） */
  async findPublicUserById(id: bigint): Promise<UserRow | null> {
    const row = await this.prisma.user.findUnique({ where: { id } });
    return (row as UserRow | null) ?? null;
  }

  /** 按主键查学校名；学校不存在返回 null */
  async findSchoolNameById(id: bigint): Promise<string | null> {
    const row = await this.prisma.school.findUnique({ where: { id } });
    return row ? (row as { name: string }).name : null;
  }

  /** 按卖家+状态查商品列表（在售按发布时间、已售按售出时间倒序），限量返回 */
  async findProductsBySeller(sellerId: bigint, status: ProductStatus, take: number): Promise<ProductRow[]> {
    const rows = await this.prisma.product.findMany({
      where: { seller_id: sellerId, status },
      orderBy: { published_at: 'desc' },
      take,
    });
    return rows as unknown as ProductRow[];
  }

  /** 按卖家+状态计数 */
  async countProductsBySeller(sellerId: bigint, status: ProductStatus): Promise<number> {
    return this.prisma.product.count({ where: { seller_id: sellerId, status } });
  }

  /**
   * 资料编辑落库（@api PATCH /users/me）：仅更新白名单四字段中实际提供的项，
   * 返回更新后的 user 行（本人档案响应数据源）。
   */
  async updateProfileById(
    id: bigint,
    fields: { nickname?: string; bio?: string; avatarUrl?: string; isAnonymous?: boolean },
  ): Promise<UserRow> {
    const row = await this.prisma.user.update({
      where: { id },
      data: {
        ...(fields.nickname !== undefined ? { nickname: fields.nickname } : {}),
        ...(fields.bio !== undefined ? { bio: fields.bio } : {}),
        ...(fields.avatarUrl !== undefined ? { avatar_url: fields.avatarUrl } : {}),
        ...(fields.isAnonymous !== undefined ? { is_anonymous: fields.isAnonymous } : {}),
      },
    });
    return row as unknown as UserRow;
  }
}
