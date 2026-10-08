/**
 * product-publish.service.ts —— 商品发布应用服务（3 步发布落库 + 三重校验 + 急出打标）
 *
 * @module PIM-BC-02 商品与供给
 * @model PIM-AG-03 商品聚合
 * @statemachine PIM-SM-02 商品状态机（[*] → 上架：发布合规校验通过后直接 on_sale）
 * @api §5.2 #10 POST /products
 *
 * 规则落点：
 *  - @rule CIM-R-05 发布流程编排：字段校验 → 品类叶子 → 敏感词 → 急出额度 → 事务落库
 *  - @rule CIM-R-06 字段完整性校验 → 落点 product.validator.ts#validatePublishFields（9001/2004 透传）
 *  - @rule CIM-R-07 品类正面清单叶子校验 → 落点本类 assertLeafCategory（9001 拦截）
 *  - @rule CIM-R-08 违禁/违规词硬拦截 → 落点本类 assertNoHitWords + infra-snapshot/word-snapshot.ts（留痕后 9001）
 *  - @rule CIM-R-09 急出打标额度 → 落点 urgent-badge.service.ts#assertCanMarkUrgent（2003）
 */
import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@contract/index';
import { ProductPublishedBus } from '@infra/product-events/product-published.bus';
import { ProductRepository } from './product.repository';
import { UrgentBadgeService } from './urgent-badge.service';
import { WordSnapshot } from './infra-snapshot/word-snapshot';
import { validatePublishFields } from './product.validator';
import type { PublishProductResult } from './dto/publish.dto';

/** 业务错误：code/message/details，由全局过滤器统一包装为响应包络 */
export class BusinessError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'BusinessError';
  }
}

/** 卖家上下文（控制器由 req.user 转换而来） */
export interface SellerContext {
  id: bigint;
  schoolId: bigint;
  identityType: string;
}

@Injectable()
export class ProductPublishService {
  constructor(
    private readonly repo: ProductRepository,
    private readonly urgentBadge: UrgentBadgeService,
    private readonly wordSnapshot: WordSnapshot,
  ) {}

  /**
   * 发布商品：CIM-R-05 编排顺序固定，任一前置校验失败即中断不落库。
   * @statemachine PIM-SM-02 [*] → 上架（status=on_sale, published_at=now）
   */
  async publish(seller: SellerContext, raw: unknown): Promise<PublishProductResult> {
    // ① CIM-R-06：字段完整性校验（9001 聚合缺失 / 2004 图片问题，原样透传）
    const dto = validatePublishFields(raw);

    // ② CIM-R-07：品类正面清单叶子校验
    await this.assertLeafCategory(dto.categoryId);

    // ③ CIM-R-08：违禁/违规词硬拦截（标题+描述合并扫描，逐词留痕后抛 9001）
    await this.assertNoHitWords(seller, dto.title, dto.desc);

    // ④ CIM-R-09：急出打标额度校验（仅打标时检查；商家禁标）
    if (dto.isUrgent) {
      await this.urgentBadge.assertCanMarkUrgent(seller);
    }

    // ⑤ PIM-SM-02 [*]→上架：同一事务写入 product + product_image
    const p = await this.repo.createProductWithImages(
      {
        seller_id: seller.id,
        school_id: seller.schoolId,
        category_id: dto.categoryId,
        title: dto.title,
        description: dto.desc,
        condition_level: dto.condition,
        trade_mode: dto.tradeMode,
        meet_location: dto.meetLocation,
        available_time: dto.availableTime,
        price: dto.price,
        original_price: dto.originalPrice,
        is_urgent: dto.isUrgent,
        status: 'on_sale',
        published_at: new Date(),
      },
      dto.images,
    );

    // @event PIM-EV-11 触发源：上架事实经 infra 事件总线分发（wantbuy 撮合为下游订阅方；
    // 边界纪律禁止 product 直 import wantbuy，故走 @infra/product-events 总线）
    await ProductPublishedBus.emit({
      id: p.id.toString(),
      category_id: dto.categoryId.toString(),
      title: dto.title,
      price: dto.price,
    });

    return { product_id: p.id.toString(), status: 'on_sale' };
  }

  /**
   * @rule CIM-R-07 落点：正面清单叶子品类校验
   * 不存在 / 状态非 active / 顶级（parent_id=0）/ 有子级 → 一律 9001 拦截
   */
  private async assertLeafCategory(categoryId: bigint): Promise<void> {
    const category = await this.repo.findCategoryById(categoryId);
    if (!category || category.status !== 'active' || category.parent_id === BigInt(0)) {
      throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, '品类不在正面清单叶子节点');
    }
    const children = await this.repo.countCategoryChildren(categoryId);
    if (children > 0) {
      throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, '品类不在正面清单叶子节点');
    }
  }

  /**
   * @rule CIM-R-08 落点：敏感词硬拦截
   * 命中即逐词写 violation_intercept_log（scene=product_publish, action=blocked），随后抛 9001
   */
  private async assertNoHitWords(seller: SellerContext, title: string, desc: string): Promise<void> {
    const text = title + '\n' + desc;
    const hits = this.wordSnapshot.findHits(text);
    if (hits.length === 0) return;
    for (const word of hits) {
      await this.repo.createViolationLog({
        user_id: seller.id,
        hit_word: word,
        content_snapshot: text,
      });
    }
    throw new BusinessError(
      ERROR_CODES.PARAM_VALIDATION_FAILED,
      '内容命中违禁/违规词：' + hits.join('、'),
    );
  }
}
