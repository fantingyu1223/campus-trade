/**
 * product.module.ts —— 商品与供给限界上下文模块
 *
 * @module PIM-BC-02 商品与供给
 * @model PIM-AG-03 商品聚合
 * 集成批次补全：ProductQueryController/ProductStatusController（检索/状态管理）注册。
 *
 * 控制器顺序纪律：三个控制器共用 'products' 前缀，ProductStatusController 必须先于
 * ProductQueryController 注册——后者 @Get(':id') 会吞掉 GET /products/mine 字面量路由。
 */
import { Module } from '@nestjs/common';
import { PrismaService } from '@infra/prisma.service';
import { JwtAuthGuard } from '@infra/auth/jwt.guard';
import { ProductController } from './product.controller';
import { ProductRepository } from './product.repository';
import { ProductPublishService } from './product-publish.service';
import { UrgentBadgeService } from './urgent-badge.service';
import { WordSnapshot } from './infra-snapshot/word-snapshot';
import { ProductQueryController } from './product-query.controller';
import { ProductQueryService } from './product-query.service';
import { ProductSearchRepository } from './product-search.repository';
import { ProductStatusController } from './product-status.controller';
import { ProductStatusService } from './product-status.service';

@Module({
  // 顺序固定：status（GET mine 字面量）→ query（GET :id 通配），见头注纪律
  controllers: [ProductController, ProductStatusController, ProductQueryController],
  providers: [
    PrismaService,
    ProductRepository,
    ProductPublishService,
    UrgentBadgeService,
    WordSnapshot,
    ProductSearchRepository,
    ProductQueryService,
    ProductStatusService,
    JwtAuthGuard,
  ],
})
export class ProductModule {}
