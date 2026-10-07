/**
 * urgent-badge.service.ts —— 急出打标额度校验
 *
 * @rule CIM-R-09 同账号同时生效急出上限 3 件；商家不享受急出加权
 * @module PIM-BC-02 商品与供给
 */
import { Injectable } from '@nestjs/common';
import { BusinessError } from './product-publish.service';
import { ProductRepository } from './product.repository';

/** 同账号同时生效急出上限 */
export const URGENT_LIMIT = 3;

@Injectable()
export class UrgentBadgeService {
  constructor(private readonly repo: ProductRepository) {}

  /** 打标前置校验：商家禁标；学生/教职工超限（on_sale/trading 口径，裁决 7）拦截 */
  async assertCanMarkUrgent(seller: { id: bigint; identityType: string }): Promise<void> {
    if (seller.identityType === 'merchant') {
      throw new BusinessError(2003, '商家商品不支持急出打标');
    }
    const count = await this.repo.countActiveUrgentBySeller(seller.id);
    if (count >= URGENT_LIMIT) {
      throw new BusinessError(2003, '急出标签同时生效上限 3 件');
    }
  }
}
