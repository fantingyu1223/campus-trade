/**
 * @module PIM-BC-01
 * @rule CIM-R-23 商家违禁品加重处置（三件套）+ 申请侧黑名单前置校验
 * 三件套：① 该商家全部商品强制下架（off_sale）② 撤销商家资质（identity_type → guest）
 * ③ 写入 merchant_ban_list 禁入驻名单（status='active'）。
 *
 * 事务不变量（MVP 口径）：Prisma 无跨表事务回滚，三步按顺序执行；
 * 任一步失败则整体抛出失败，已成功的前置步骤不在本服务内自动补偿，
 * 需由运营人工回滚（补偿口径待后续任务裁决）。严禁乱序：必须先下架再撤销身份，
 * 避免撤销身份后无法定位其商品。
 */
import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@contract/error-codes';
import { MerchantBanRepository } from './merchant-ban.repository';
import {
  MerchantBanDto,
  MerchantBanResponseDto,
} from './dto/merchant-ban.dto';

export class BusinessError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'BusinessError';
  }
}

@Injectable()
export class MerchantBanService {
  constructor(private readonly repo: MerchantBanRepository) {}

  /**
   * @rule CIM-R-23 三件套处置
   * reason 必填（9001）→ 商品全量下架 → 撤销商家身份（非 merchant 跳过）
   * → 写入 active 黑名单。返回 { banned: true, off_shelf_count }。
   */
  async executeBan(
    adminId: string,
    input: MerchantBanDto,
  ): Promise<MerchantBanResponseDto> {
    if (!input.reason || !input.reason.trim()) {
      throw new BusinessError(
        ERROR_CODES.PARAM_VALIDATION_FAILED,
        '处置原因 reason 必填',
      );
    }

    // 三件套第 1 步：该商家全部商品强制下架
    const products = await this.repo.findProductsBySeller(input.user_id);
    const ids = products.map((p) => p.id);
    let offShelfCount = 0;
    if (ids.length > 0) {
      const res = await this.repo.offShelfByIds(ids);
      offShelfCount = res.count;
    }

    // 三件套第 2 步：撤销商家资质回退身份（若非 merchant 则跳过）
    const user = await this.repo.findUserIdentityType(input.user_id);
    if (user && user.identity_type === 'merchant') {
      await this.repo.revokeMerchant(input.user_id);
    }

    // 三件套第 3 步：写入禁入驻名单（active），供申请侧前置校验拦截
    await this.repo.createBanEntry({
      user_id: BigInt(input.user_id),
      license_no: input.license_no ?? null,
      phone: input.phone ?? null,
      reason: input.reason,
      banned_by: BigInt(adminId),
      status: 'active',
    });

    return { banned: true, off_shelf_count: offShelfCount };
  }
}
