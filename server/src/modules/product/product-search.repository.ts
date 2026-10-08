/**
 * product-search.repository.ts —— 商品检索读模型数据访问（模块自含）
 *
 * @table product/category → PIM-AG-03 商品聚合（检索读模型）
 * @module PIM-BC-02 商品与供给
 *
 * 说明：keyword 检索走 title/description contains（FULLTEXT idx_ft_title_desc
 * 的 LIKE 降级，见 §4.8）；seller 身份标识只读 user 的 id/identity_type/nickname
 * 公开字段组，实名字段（student_no/license/openid 等）不出 select。
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infra/prisma.service';

@Injectable()
export class ProductSearchRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 列表检索：findMany + count 同 where 分页（skip/take），返回 { list, total } */
  async searchProducts(
    where: Prisma.ProductWhereInput,
    orderBy: Prisma.ProductOrderByWithRelationInput,
    page: number,
    pageSize: number,
  ) {
    const [list, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.product.count({ where }),
    ]);
    return { list, total };
  }

  /** 按 id 批量查卖家公开字段组（id/identity_type/nickname；实名字段不出 select） */
  findSellersByIds(ids: bigint[]) {
    return this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, identity_type: true, nickname: true },
    });
  }

  /** 按身份类型查用户 id 集合（role_filter 个人闲置/认证商家过滤用） */
  async findUserIdsByIdentityType(identityType: string): Promise<bigint[]> {
    const rows = await this.prisma.user.findMany({
      where: { identity_type: identityType as Prisma.EnumIdentityTypeFilter['equals'] },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  /** 批量查首图（sort_order=0 即封面） */
  findCoversByProductIds(ids: bigint[]) {
    return this.prisma.productImage.findMany({
      where: { product_id: { in: ids }, sort_order: 0 },
    });
  }

  /** 详情：按主键查商品 */
  findDetailById(id: bigint) {
    return this.prisma.product.findUnique({ where: { id } });
  }

  /** 查子品类 id 集合（category_id 筛选父品类时展开为 父+子，CIM 正面清单两级结构） */
  async findChildCategoryIds(parentId: bigint): Promise<bigint[]> {
    const rows = await this.prisma.category.findMany({
      where: { parent_id: parentId, status: 'active' },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  /** 详情：全部图片按 sort_order 升序（0=首图） */
  findImagesByProductId(id: bigint) {
    return this.prisma.productImage.findMany({
      where: { product_id: id },
      orderBy: { sort_order: 'asc' },
    });
  }
}
