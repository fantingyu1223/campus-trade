/**
 * @module PIM-BC-01
 * @table merchant_application → PIM-AG-10
 * @table user → PIM-AG-01（仅读 identity_type 判定是否已是商家）
 * 商家入驻申请仓储：封装 merchant_application / user 表访问。
 * 查询结果以 Row 视图返回（as unknown as Row）。
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infra/prisma.service';

export interface UserIdentityRow {
  id: bigint;
  identity_type: string;
}

export interface MerchantApplicationRow {
  id: bigint;
  user_id: bigint;
  shop_name: string;
  license_image_url: string;
  shop_proof_image_url: string | null;
  contact_phone: string;
  shop_address: string | null;
  status: string;
  reject_reason_code: string | null;
  reject_reason_detail: string | null;
  submitted_at: Date;
  sla_deadline: Date;
  reviewed_at: Date | null;
  reviewer_id: bigint | null;
  cooldown_until: Date | null;
}

export interface MerchantApplyCreateData {
  user_id: bigint;
  shop_name: string;
  license_image_url: string;
  shop_proof_image_url: string | null;
  contact_phone: string;
  shop_address: string | null;
  submitted_at: Date;
  sla_deadline: Date;
}

/** 禁入驻名单行（merchant_ban_list，auth schema） */
export interface MerchantBanRow {
  id: bigint;
  user_id: bigint | null;
  phone: string | null;
  license_no: string | null;
  reason: string;
  status: string;
}

@Injectable()
export class MerchantApplyRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 查用户身份类型（已是商家拦截用） */
  async findUserIdentity(userId: string): Promise<UserIdentityRow | null> {
    const row = await this.prisma.user.findUnique({
      where: { id: BigInt(userId) },
      select: { id: true, identity_type: true },
    });
    return row as unknown as UserIdentityRow | null;
  }

  /** 用户最近一次提交的入驻申请（状态查询/重复提交/冷却校验用，idx_user_status） */
  async findLatestByUser(userId: string): Promise<MerchantApplicationRow | null> {
    const row = await this.prisma.merchantApplication.findFirst({
      where: { user_id: BigInt(userId) },
      orderBy: { submitted_at: 'desc' },
    });
    return row as unknown as MerchantApplicationRow | null;
  }

  /**
   * 命中有效禁入驻名单（@rule CIM-R-23 黑名单前置校验）。
   * merchant_ban_list 属 auth schema（聚合 PIM-AG-10），本模块自含直查，
   * 不跨模块 import（治理侧 MerchantBanService 负责写入，此处只读消费）。
   */
  async findActiveBanByUser(userId: string): Promise<MerchantBanRow | null> {
    const row = await this.prisma.merchantBanList.findFirst({
      where: { user_id: BigInt(userId), status: 'active' },
    });
    return row as unknown as MerchantBanRow | null;
  }

  /** 按联系电话命中有效禁入驻名单 */
  async findActiveBanByPhone(phone: string): Promise<MerchantBanRow | null> {
    const row = await this.prisma.merchantBanList.findFirst({
      where: { phone, status: 'active' },
    });
    return row as unknown as MerchantBanRow | null;
  }

  async create(data: MerchantApplyCreateData): Promise<MerchantApplicationRow> {
    const row = await this.prisma.merchantApplication.create({
      data: { ...data, status: 'pending' },
    });
    return row as unknown as MerchantApplicationRow;
  }
}
