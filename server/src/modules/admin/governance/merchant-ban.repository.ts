/**
 * @module PIM-BC-01
 * @table product / user / merchant_ban_list
 * 商家违禁品加重处置（三件套）仓储：封装 product 下架、user 身份回退、merchant_ban_list 写入/查询。
 * 查询结果以 Row 视图返回（as unknown as Row）。
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infra/prisma.service';

export interface ProductRow {
  id: bigint;
  seller_id: bigint;
  status: string;
}

export interface UserIdentityTypeRow {
  id: bigint;
  identity_type: string;
}

export interface MerchantBanCreateData {
  user_id: bigint;
  license_no: string | null;
  phone: string | null;
  reason: string;
  banned_by: bigint;
  status: string;
}

export interface MerchantBanRow {
  id: bigint;
  user_id: bigint | null;
  license_no: string | null;
  phone: string | null;
  reason: string;
  banned_by: bigint;
  status: string;
  created_at: Date;
}

@Injectable()
export class MerchantBanRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 商家名下全部商品（三件套第 1 步：全量下架） */
  async findProductsBySeller(sellerId: string): Promise<ProductRow[]> {
    const rows = await this.prisma.product.findMany({
      where: { seller_id: BigInt(sellerId) },
    });
    return rows as unknown as ProductRow[];
  }

  /** 按 id 批量下架商品，返回受影响行数 */
  async offShelfByIds(ids: bigint[]): Promise<{ count: number }> {
    const res = await this.prisma.product.updateMany({
      where: { id: { in: ids } },
      data: { status: 'off_sale' },
    });
    return { count: res.count };
  }

  /** 查用户身份类型（判定是否需撤销商家资质） */
  async findUserIdentityType(userId: string): Promise<UserIdentityTypeRow | null> {
    const row = await this.prisma.user.findUnique({
      where: { id: BigInt(userId) },
      select: { id: true, identity_type: true },
    });
    return row as unknown as UserIdentityTypeRow | null;
  }

  /** 撤销商家资质回退身份：merchant → guest */
  async revokeMerchant(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: BigInt(userId) },
      data: { identity_type: 'guest' },
    });
  }

  /** 写入禁入驻名单条目（status='active'） */
  async createBanEntry(data: MerchantBanCreateData): Promise<MerchantBanRow> {
    const row = await this.prisma.merchantBanList.create({
      data: data as Prisma.MerchantBanListUncheckedCreateInput,
    });
    return row as unknown as MerchantBanRow;
  }

  /** @rule CIM-R-23 申请侧前置校验：按 user_id 命中 active 黑名单 */
  async findActiveBanByUser(userId: string): Promise<MerchantBanRow | null> {
    const row = await this.prisma.merchantBanList.findFirst({
      where: { user_id: BigInt(userId), status: 'active' },
    });
    return row as unknown as MerchantBanRow | null;
  }

  /** @rule CIM-R-23 申请侧前置校验：按 phone 命中 active 黑名单 */
  async findActiveBanByPhone(phone: string): Promise<MerchantBanRow | null> {
    const row = await this.prisma.merchantBanList.findFirst({
      where: { phone, status: 'active' },
    });
    return row as unknown as MerchantBanRow | null;
  }
}
