/**
 * 商家违禁品加重处置（三件套）DTO。
 * executeBan 入参 / 出参视图。
 */

/** 处置入参：user_id 必填；license_no / phone 用于扩大黑名单覆盖面（可空） */
export interface MerchantBanDto {
  user_id: string;
  license_no?: string;
  phone?: string;
  /** 处置原因（必填，缺失 → 9001） */
  reason: string;
}

/** 处置结果：banned 固定 true；off_shelf_count 为本次下架商品数 */
export interface MerchantBanResponseDto {
  banned: boolean;
  off_shelf_count: number;
}
