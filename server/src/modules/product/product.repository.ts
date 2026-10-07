/**
 * product.repository.ts —— 商品模块自含数据访问
 *
 * @table product/product_image/category/word_list → PIM-AG-03 商品聚合
 * @module PIM-BC-02 商品与供给
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infra/prisma.service';

/** 违规拦截留痕入参（scene/action/target_id 由本仓储固定补全） */
export interface ViolationLogEntry {
  user_id: bigint;
  hit_word: string;
  content_snapshot: string;
}

@Injectable()
export class ProductRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 按主键查品类 */
  findCategoryById(id: bigint) {
    return this.prisma.category.findUnique({ where: { id } });
  }

  /** 按 parent_id 计数子级（叶子判定，CIM-R-07） */
  countCategoryChildren(id: bigint) {
    return this.prisma.category.count({ where: { parent_id: id } });
  }

  /** 生效中急出件数：is_urgent=true 且状态在 on_sale/trading（裁决 7，CIM-R-09） */
  countActiveUrgentBySeller(sellerId: bigint) {
    return this.prisma.product.count({
      where: { seller_id: sellerId, is_urgent: true, status: { in: ['on_sale', 'trading'] } },
    });
  }

  /** 同一事务内写入 product 与 product_image（sort_order 0..n，≤9 张） */
  createProductWithImages(data: Prisma.ProductUncheckedCreateInput, images: string[]) {
    return this.prisma.$transaction(async (tx) => {
      const p = await tx.product.create({ data });
      await tx.productImage.createMany({
        data: images.map((url, i) => ({ product_id: p.id, image_url: url, sort_order: i })),
      });
      return p;
    });
  }

  /** CIM-R-08 拦截留痕：scene=product_publish、action=blocked、target_id=null 固定 */
  createViolationLog(entry: ViolationLogEntry) {
    return this.prisma.violationInterceptLog.create({
      data: {
        scene: 'product_publish',
        action: 'blocked',
        user_id: entry.user_id,
        target_id: null,
        hit_word: entry.hit_word,
        content_snapshot: entry.content_snapshot,
      },
    });
  }

  // ==================== T-107 商品状态管理（追加段，不改动既有方法） ====================

  /** 按主键查商品（状态守卫前置读取） */
  findProductById(id: bigint) {
    return this.prisma.product.findUnique({ where: { id } });
  }

  /**
   * @statemachine PIM-SM-02 on_sale → off_sale：下架迁移，写入 off_sale_at 留痕（F6）
   */
  transitionToOffSale(id: bigint, at: Date) {
    return this.prisma.product.update({
      where: { id },
      data: { status: 'off_sale', off_sale_at: at },
    });
  }

  /** @statemachine PIM-SM-02 off_sale → on_sale：重新上架迁移（sold 终态由服务层守卫拦截） */
  transitionToOnSale(id: bigint) {
    return this.prisma.product.update({
      where: { id },
      data: { status: 'on_sale' },
    });
  }

  /**
   * @rule CIM-R-13 标记已售：on_sale → sold 终态，须记录成交买家与售出时间
   * @statemachine PIM-SM-02 on_sale → sold（不可逆）
   */
  transitionToSold(id: bigint, buyerId: bigint, at: Date) {
    return this.prisma.product.update({
      where: { id },
      data: { status: 'sold', sold_buyer_id: buyerId, sold_at: at },
    });
  }

  /**
   * 跨 schema 只读消费 chat 表：因标记已售须从会话买家选择（CIM-R-13），
   * 会话按 last_message_at desc 排序（最近联系优先）。
   * @table conversation 只读
   */
  findConversationsByProductForSeller(productId: bigint, sellerId: bigint) {
    return this.prisma.conversation.findMany({
      where: { product_id: productId, seller_id: sellerId },
      orderBy: { last_message_at: 'desc' },
    });
  }

  /**
   * 买家公开档案批量查询：select id/nickname 白名单（防实名泄漏，@rule CIM-R-28 口径）
   * @table user 只读
   */
  findBuyersPublicByIds(ids: bigint[]) {
    return this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, nickname: true },
    });
  }

  /** 我的商品分页查询（#16）：status 可选过滤，published_at desc，返回 {list,total} */
  async findMineBySeller(sellerId: bigint, status: string | undefined, page: number, pageSize: number) {
    const where: Prisma.ProductWhereInput = {
      seller_id: sellerId,
      ...(status ? { status: status as Prisma.EnumProductStatusFilter['equals'] } : {}),
    };
    const [list, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: { published_at: 'desc' as const },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.product.count({ where }),
    ]);
    return { list, total };
  }

  /** 我的商品全量（分栏三组用，published_at desc） */
  findAllMineBySeller(sellerId: bigint) {
    return this.prisma.product.findMany({
      where: { seller_id: sellerId },
      orderBy: { published_at: 'desc' },
    });
  }
}
