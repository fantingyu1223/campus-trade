/**
 * product-query.service.ts —— 商品检索/详情查询应用服务（游客可读）
 *
 * @module PIM-BC-02 商品与供给
 * @model PIM-AG-03 商品聚合（检索读模型）
 * @rule CIM-R-28 卖家身份标识化：实名信息（student_no/license/openid/unionid/real_name）不出站
 * @api §5.2 #14 GET /products/{id} 商品详情、#15 GET /products 商品列表
 * @ac F6-AC1 列表筛选/排序/分页、F6-AC2 个人闲置/认证商家过滤、F33-AC1 实名信息不外泄
 *
 * 说明：模块自含，禁止 import user 模块；卖家公开字段经 ProductSearchRepository
 * 的 select 白名单获取，出站前由 assertNoRealNameLeak 兜底扫描。
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ERROR_CODES, UserIdentityType } from '@contract/index';
import { ProductSearchRepository } from './product-search.repository';
import { BusinessError } from './product-publish.service';
import type {
  ConditionLevel,
  ProductDetailResponse,
  ProductListItem,
  ProductListQuery,
  ProductListRawQuery,
  ProductListResult,
  ProductSellerBrief,
  ProductSort,
  RoleFilter,
} from './dto/query.dto';

/** 实名信息敏感 key 黑名单（@rule CIM-R-28：任一命中即视为外泄风险） */
const REAL_NAME_KEYS = ['student_no', 'license', 'openid', 'unionid', 'real_name'] as const;

/**
 * @rule CIM-R-28 落点（模块自含导出）：递归扫描出站载荷 key，
 * 命中实名敏感 key 即抛错拦截（宁可 500 不可泄露）。
 */
export function assertNoRealNameLeak(payload: unknown): void {
  if (payload === null || typeof payload !== 'object') return;
  if (Array.isArray(payload)) {
    for (const item of payload) assertNoRealNameLeak(item);
    return;
  }
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if ((REAL_NAME_KEYS as readonly string[]).includes(key)) {
      throw new BusinessError(ERROR_CODES.INTERNAL_ERROR, '检测到实名信息外泄风险，响应已拦截');
    }
    assertNoRealNameLeak(value);
  }
}

/** 金额格式：非负，最多两位小数（与发布价格口径一致） */
const MONEY_PATTERN = /^\d+(\.\d{1,2})?$/;

const CONDITION_VALUES: readonly string[] = ['new', 'like_new', 'good', 'fair', 'poor'];
const ROLE_FILTER_VALUES: readonly string[] = ['personal', 'merchant'];
const SORT_VALUES: readonly string[] = ['new', 'price_asc', 'price_desc'];

@Injectable()
export class ProductQueryService {
  constructor(private readonly repo: ProductSearchRepository) {}

  /**
   * @api §5.2 #15 GET /products
   * @ac F6-AC1 筛选/排序/分页；F6-AC2 个人闲置/认证商家过滤
   */
  async search(rawQuery: ProductListRawQuery): Promise<ProductListResult> {
    const q = this.normalizeQuery(rawQuery);

    // role_filter：先取商家 id 集（merchant→in / personal→notIn）
    let sellerIdFilter: Prisma.BigIntFilter | null = null;
    if (q.roleFilter) {
      const merchantIds = await this.repo.findUserIdsByIdentityType(UserIdentityType.MERCHANT);
      sellerIdFilter =
        q.roleFilter === 'merchant' ? { in: merchantIds } : { notIn: merchantIds };
    }

    // category_id：父品类自动展开为 父+子 集合（叶子品类直接精确匹配）
    let categoryFilter: bigint | Prisma.BigIntFilter | null = q.categoryId;
    if (q.categoryId !== null) {
      const childIds = await this.repo.findChildCategoryIds(q.categoryId);
      if (childIds.length > 0) categoryFilter = { in: [q.categoryId, ...childIds] };
    }

    const where = this.buildWhere(q, sellerIdFilter, categoryFilter);
    const orderBy = this.buildOrderBy(q.sort);

    const { list, total } = await this.repo.searchProducts(where, orderBy, q.page, q.pageSize);

    const productIds = list.map((p) => p.id);
    const sellerIds = [...new Set(list.map((p) => p.seller_id))];
    const [sellers, covers] = await Promise.all([
      this.repo.findSellersByIds(sellerIds),
      this.repo.findCoversByProductIds(productIds),
    ]);
    const sellerMap = new Map(sellers.map((s) => [s.id.toString(), s]));
    const coverMap = new Map(covers.map((c) => [c.product_id.toString(), c.image_url]));

    const items: ProductListItem[] = list.map((p) => ({
      id: p.id.toString(),
      title: p.title,
      price: p.price.toString(),
      cover: coverMap.get(p.id.toString()) ?? null,
      is_urgent: p.is_urgent,
      // 卖家缺失兜底 'guest'（@rule CIM-R-28：仅暴露身份标识）
      seller_role: sellerMap.get(p.seller_id.toString())?.identity_type ?? UserIdentityType.GUEST,
    }));

    return { list: items, total, page: q.page, pageSize: q.pageSize };
  }

  /**
   * @api §5.2 #14 GET /products/{id}
   * @ac F33-AC1 详情出站前实名泄漏兜底扫描（assertNoRealNameLeak）
   */
  async detail(id: string): Promise<ProductDetailResponse> {
    if (!/^\d+$/.test(id)) {
      throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, '商品 id 非法');
    }
    const product = await this.repo.findDetailById(BigInt(id));
    if (!product) {
      throw new BusinessError(ERROR_CODES.PRODUCT_NOT_FOUND, '商品不存在');
    }

    const [images, sellers] = await Promise.all([
      this.repo.findImagesByProductId(product.id),
      this.repo.findSellersByIds([product.seller_id]),
    ]);
    const sellerRow = sellers[0];
    const seller: ProductSellerBrief = {
      id: product.seller_id.toString(),
      // N6 匿名保护（仿 @rule CIM-R-28 身份标识化口径）：is_anonymous=true 时昵称展示为「匿名用户」
      nickname: sellerRow?.is_anonymous ? '匿名用户' : (sellerRow?.nickname ?? ''),
      identity_type: sellerRow?.identity_type ?? UserIdentityType.GUEST,
      is_merchant: sellerRow?.identity_type === UserIdentityType.MERCHANT,
    };

    const payload: ProductDetailResponse = {
      id: product.id.toString(),
      title: product.title,
      desc: product.description,
      price: product.price.toString(),
      original_price: product.original_price === null ? null : product.original_price.toString(),
      condition: product.condition_level,
      trade_mode: product.trade_mode,
      meet_location: product.meet_location,
      available_time: product.available_time,
      status: product.status,
      is_urgent: product.is_urgent,
      category_id: product.category_id.toString(),
      view_count: product.view_count,
      favorite_count: product.favorite_count,
      published_at: product.published_at === null ? null : product.published_at.toISOString(),
      images: images.map((img) => img.image_url), // repository 已按 sort_order 升序（0=首图）
      seller,
    };

    assertNoRealNameLeak(payload);
    return payload;
  }

  // ---------- 参数校验归一化（非法一律 9001） ----------

  private normalizeQuery(raw: ProductListRawQuery): ProductListQuery {
    const fail = (field: string): never => {
      throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, `查询参数非法：${field}`);
    };

    // category_id：须为数字
    let categoryId: bigint | null = null;
    if (raw.category_id !== undefined && raw.category_id !== '') {
      if (!/^\d+$/.test(raw.category_id)) fail('category_id');
      categoryId = BigInt(raw.category_id);
    }

    // min/max_price：金额格式且 min ≤ max
    let minPrice: string | null = null;
    let maxPrice: string | null = null;
    if (raw.min_price !== undefined && raw.min_price !== '') {
      if (!MONEY_PATTERN.test(raw.min_price)) fail('min_price');
      minPrice = raw.min_price;
    }
    if (raw.max_price !== undefined && raw.max_price !== '') {
      if (!MONEY_PATTERN.test(raw.max_price)) fail('max_price');
      maxPrice = raw.max_price;
    }
    if (minPrice !== null && maxPrice !== null && Number(minPrice) > Number(maxPrice)) {
      fail('min_price>max_price');
    }

    // condition：成色枚举
    let condition: ConditionLevel | null = null;
    if (raw.condition !== undefined && raw.condition !== '') {
      if (!CONDITION_VALUES.includes(raw.condition)) fail('condition');
      condition = raw.condition as ConditionLevel;
    }

    // role_filter：个人闲置 / 认证商家
    let roleFilter: RoleFilter | null = null;
    if (raw.role_filter !== undefined && raw.role_filter !== '') {
      if (!ROLE_FILTER_VALUES.includes(raw.role_filter)) fail('role_filter');
      roleFilter = raw.role_filter as RoleFilter;
    }

    // sort：默认 new
    let sort: ProductSort = 'new';
    if (raw.sort !== undefined && raw.sort !== '') {
      if (!SORT_VALUES.includes(raw.sort)) fail('sort');
      sort = raw.sort as ProductSort;
    }

    // page：≥1 整数，默认 1
    let page = 1;
    if (raw.page !== undefined && raw.page !== '') {
      if (!/^\d+$/.test(raw.page) || Number(raw.page) < 1) fail('page');
      page = Number(raw.page);
    }

    // pageSize：1-50，默认 20
    let pageSize = 20;
    if (raw.pageSize !== undefined && raw.pageSize !== '') {
      if (!/^\d+$/.test(raw.pageSize) || Number(raw.pageSize) < 1 || Number(raw.pageSize) > 50) {
        fail('pageSize');
      }
      pageSize = Number(raw.pageSize);
    }

    return {
      keyword: raw.keyword?.trim() ? raw.keyword.trim() : null,
      categoryId,
      minPrice,
      maxPrice,
      condition,
      roleFilter,
      excludeSold: this.parseBool(raw.exclude_sold, true, 'exclude_sold'),
      sort,
      urgentOnly: this.parseBool(raw.urgent_only, false, 'urgent_only'),
      page,
      pageSize,
    };
  }

  /** 布尔解析：true/false/1/0，非法 9001 */
  private parseBool(raw: string | undefined, defaultValue: boolean, field: string): boolean {
    if (raw === undefined || raw === '') return defaultValue;
    if (raw === 'true' || raw === '1') return true;
    if (raw === 'false' || raw === '0') return false;
    throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, `查询参数非法：${field}`);
  }

  // ---------- where / orderBy 组装 ----------

  private buildWhere(
    q: ProductListQuery,
    sellerIdFilter: Prisma.BigIntFilter | null,
    categoryFilter: bigint | Prisma.BigIntFilter | null,
  ): Prisma.ProductWhereInput {
    const where: Prisma.ProductWhereInput = {};

    // exclude_sold 默认 true：排除已售
    if (q.excludeSold) {
      where.status = { not: 'sold' };
    }
    // keyword：title/description OR contains（FULLTEXT idx_ft_title_desc 的 LIKE 降级，§4.8）
    if (q.keyword) {
      where.OR = [{ title: { contains: q.keyword } }, { description: { contains: q.keyword } }];
    }
    if (categoryFilter !== null) {
      where.category_id = categoryFilter as Prisma.BigIntFilter | bigint;
    }
    if (q.minPrice !== null || q.maxPrice !== null) {
      where.price = {};
      if (q.minPrice !== null) where.price.gte = q.minPrice;
      if (q.maxPrice !== null) where.price.lte = q.maxPrice;
    }
    if (q.condition !== null) {
      where.condition_level = q.condition;
    }
    if (q.urgentOnly) {
      where.is_urgent = true;
    }
    if (sellerIdFilter !== null) {
      where.seller_id = sellerIdFilter;
    }
    return where;
  }

  private buildOrderBy(sort: ProductSort): Prisma.ProductOrderByWithRelationInput {
    switch (sort) {
      case 'price_asc':
        return { price: 'asc' };
      case 'price_desc':
        return { price: 'desc' };
      default:
        return { published_at: 'desc' };
    }
  }
}
