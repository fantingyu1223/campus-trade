/**
 * product.validator.ts —— 发布入参聚合式字段校验
 *
 * @rule CIM-R-06 必填项逐项拦截提示（9001 聚合缺失；图片问题单独 2004）
 * @api §5.2 #10 POST /products
 */
// BusinessError 自 service 导入（循环安全：service → validator 仅值引用 BusinessError 类本身）
import { BusinessError } from './product-publish.service';
import type { ConditionLevelValue, ProductTradeModeValue } from './dto/publish.dto';

const CONDITION_VALUES: readonly string[] = ['new', 'like_new', 'good', 'fair', 'poor'];
const TRADE_MODE_VALUES: readonly string[] = ['meet', 'online', 'both'];
const PRICE_RE = /^\d{1,8}(\.\d{1,2})?$/;
const MAX_IMAGES = 9;

/** 规范化后的发布入参 */
export interface PublishInput {
  title: string;
  desc: string;
  price: string;
  categoryId: bigint;
  images: string[];
  condition: ConditionLevelValue;
  tradeMode: ProductTradeModeValue;
  meetLocation: string | null;
  availableTime: string | null;
  originalPrice: string | null;
  isUrgent: boolean;
  stock: number | null;
}

const asBody = (raw: unknown): Record<string, unknown> => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BusinessError(9001, '缺少必填字段：请求体');
  }
  return raw as Record<string, unknown>;
};

const isBlank = (v: unknown): v is undefined | null | '' =>
  v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/**
 * 聚合式校验发布字段：
 *  - 普通必填缺失/非法 → 聚合后 9001「缺少必填字段：…」
 *  - 图片问题（缺失/空数组/空 URL/超 9 张）→ 单独 2004
 */
export function validatePublishFields(raw: unknown): PublishInput {
  const body = asBody(raw);
  const missing: string[] = [];

  // 标题：1-128 字必填
  const title = body.title;
  if (isBlank(title)) missing.push('标题');
  else if (typeof title !== 'string' || title.length > 128) missing.push('标题');

  // 描述：必填
  const desc = body.desc;
  if (isBlank(desc)) missing.push('描述');

  // 价格：^\d{1,8}(\.\d{1,2})?$ 且 >0
  const price = body.price;
  if (isBlank(price)) missing.push('价格');
  else if (typeof price !== 'string' || !PRICE_RE.test(price) || Number(price) <= 0) {
    missing.push('价格');
  }

  // 品类 id：可转正整数
  const categoryIdRaw = body.category_id;
  let categoryId: bigint | null = null;
  if (isBlank(categoryIdRaw)) missing.push('品类');
  else if (!/^\d+$/.test(String(categoryIdRaw)) || BigInt(String(categoryIdRaw)) <= BigInt(0)) {
    missing.push('品类');
  } else {
    categoryId = BigInt(String(categoryIdRaw));
  }

  // 成色：必在枚举内，缺漏记入 missing
  const condition = body.condition;
  if (isBlank(condition)) missing.push('成色');
  else if (typeof condition !== 'string' || !CONDITION_VALUES.includes(condition)) {
    missing.push('成色');
  }

  // 交易方式：必在枚举内
  const tradeMode = body.trade_mode;
  if (isBlank(tradeMode)) missing.push('交易方式');
  else if (typeof tradeMode !== 'string' || !TRADE_MODE_VALUES.includes(tradeMode)) {
    missing.push('交易方式');
  }

  // 自提地点：meet / both 时必填，缺漏记入 missing
  const tradePoint = body.trade_point;
  const needsMeetPoint = tradeMode === 'meet' || tradeMode === 'both';
  if (needsMeetPoint && isBlank(tradePoint)) missing.push('自提地点');

  // 可选：original_price 若提供须为合法价格
  const originalPriceRaw = body.original_price;
  if (!isBlank(originalPriceRaw)) {
    if (
      typeof originalPriceRaw !== 'string' ||
      !PRICE_RE.test(originalPriceRaw) ||
      Number(originalPriceRaw) <= 0
    ) {
      missing.push('原价');
    }
  }

  // 可选：stock 若提供须为正整数
  const stockRaw = body.stock;
  if (stockRaw !== undefined && stockRaw !== null) {
    if (typeof stockRaw !== 'number' || !Number.isInteger(stockRaw) || stockRaw <= 0) {
      missing.push('库存');
    }
  }

  // 图片：必填数组 1-9 个非空 URL，问题单独 2004
  const imagesRaw = body.images;
  if (!Array.isArray(imagesRaw) || imagesRaw.length === 0) {
    throw new BusinessError(2004, '请上传至少 1 张实拍图');
  }
  if (imagesRaw.length > MAX_IMAGES) {
    throw new BusinessError(2004, '实拍图最多 9 张');
  }
  if (imagesRaw.some((u) => typeof u !== 'string' || u.trim() === '')) {
    throw new BusinessError(2004, '实拍图 URL 不能为空');
  }

  if (missing.length > 0) {
    throw new BusinessError(9001, '缺少必填字段：' + missing.join('、'));
  }

  return {
    title: (title as string).trim(),
    desc: desc as string,
    price: price as string,
    categoryId: categoryId as bigint,
    images: imagesRaw as string[],
    condition: condition as ConditionLevelValue,
    tradeMode: tradeMode as ProductTradeModeValue,
    meetLocation: needsMeetPoint ? (tradePoint as string) : null,
    availableTime: isBlank(body.available_time) ? null : String(body.available_time),
    originalPrice: isBlank(originalPriceRaw) ? null : (originalPriceRaw as string),
    isUrgent: body.is_urgent === true,
    stock: stockRaw === undefined || stockRaw === null ? null : (stockRaw as number),
  };
}
