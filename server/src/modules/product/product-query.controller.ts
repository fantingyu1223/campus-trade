/**
 * product-query.controller.ts —— 商品检索/详情控制器（游客可读，无 guard）
 *
 * @module PIM-BC-02 商品与供给
 * @api §5.2 #14 GET /products/{id} 商品详情、#15 GET /products 商品列表（统一响应包络 §5.1）
 */
import { Controller, Get, Param, Query } from '@nestjs/common';
import { ProductQueryService } from './product-query.service';
import type {
  ProductDetailResponse,
  ProductListRawQuery,
  ProductListResult,
} from './dto/query.dto';

interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

@Controller('products')
export class ProductQueryController {
  constructor(private readonly queryService: ProductQueryService) {}

  /** @api §5.2 #15 GET /products（游客可读；筛选/排序/分页参数由 service 校验归一化） */
  @Get()
  async search(@Query() q: ProductListRawQuery): Promise<ApiResponse<ProductListResult>> {
    const data = await this.queryService.search(q);
    return { code: 0, message: 'ok', data };
  }

  /** @api §5.2 #14 GET /products/{id}（游客可读；实名不出站由 service 兜底） */
  @Get(':id')
  async detail(@Param('id') id: string): Promise<ApiResponse<ProductDetailResponse>> {
    const data = await this.queryService.detail(id);
    return { code: 0, message: 'ok', data };
  }
}
