/**
 * @module PIM-BC-01
 * @model PIM-AG-10
 * @rule CIM-R-25 入驻申请字段完整性（shop_name/contact_phone/license_image_url 必填）
 * 商家入驻申请入参校验器：违规一律 9001（PARAM_VALIDATION_FAILED）。
 * 注意：import BusinessError 自 auth.service 属循环引用，仅类型/调用时访问，安全。
 */
import { ERROR_CODES } from '@contract/error-codes';
import { BusinessError } from './auth.service';
import { MerchantApplyRequest } from './dto/merchant-apply.dto';

/** 联系电话：手机/座机/带 + - 的国际格式（宽松校验，长度 5-20 位） */
const PHONE_RE = /^[0-9+\-]{5,20}$/;

function fail(message: string): never {
  throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, message);
}

export function validateMerchantApplyDto(input: unknown): MerchantApplyRequest {
  const body = (input ?? {}) as Record<string, unknown>;

  if (typeof body.shop_name !== 'string' || body.shop_name.trim().length === 0) {
    fail('shop_name 缺失或非法（店铺名必填）');
  }
  const shopName = body.shop_name.trim();
  if (shopName.length > 128) fail('shop_name 超长（≤128）');

  if (typeof body.contact_phone !== 'string' || body.contact_phone.trim().length === 0) {
    fail('contact_phone 缺失或非法（联系电话必填）');
  }
  const contactPhone = body.contact_phone.trim();
  if (contactPhone.length > 32) fail('contact_phone 超长（≤32）');
  if (!PHONE_RE.test(contactPhone)) fail('contact_phone 格式非法');

  if (typeof body.license_image_url !== 'string' || body.license_image_url.trim().length === 0) {
    fail('license_image_url 缺失（营业执照图必填）');
  }
  const licenseImageUrl = body.license_image_url.trim();
  if (licenseImageUrl.length > 512) fail('license_image_url 超长（≤512）');

  let shopProofImageUrl: string | undefined;
  if (body.shop_proof_image_url !== undefined && body.shop_proof_image_url !== null) {
    if (typeof body.shop_proof_image_url !== 'string' || body.shop_proof_image_url.trim().length === 0) {
      fail('shop_proof_image_url 非法');
    }
    shopProofImageUrl = body.shop_proof_image_url.trim();
    if (shopProofImageUrl.length > 512) fail('shop_proof_image_url 超长（≤512）');
  }

  let shopAddress: string | undefined;
  if (body.shop_address !== undefined && body.shop_address !== null) {
    if (typeof body.shop_address !== 'string') fail('shop_address 非法');
    shopAddress = body.shop_address.trim();
    if (shopAddress.length > 255) fail('shop_address 超长（≤255）');
  }

  return {
    shop_name: shopName,
    contact_phone: contactPhone,
    shop_address: shopAddress,
    license_image_url: licenseImageUrl,
    shop_proof_image_url: shopProofImageUrl,
  };
}
