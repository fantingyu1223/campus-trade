/**
 * product.controller.ts —— 商品控制器
 *
 * @module PIM-BC-02 商品与供给
 * @api §5.2 #10 POST /products（统一响应包络 §5.1）
 * @ac F5-AC1 发布成功落库 on_sale / F5-AC2 字段完整性拦截 / F5-AC3 敏感词硬拦截 / F10a-AC1 急出额度
 */
import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ERROR_CODES } from '@contract/index';
import { JwtAuthGuard } from '@infra/auth/jwt.guard';
import { BusinessError, ProductPublishService, SellerContext } from './product-publish.service';
import type { PublishProductResult } from './dto/publish.dto';

interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

/** 认证上下文（JWT 载荷写入 req.user；id/school_id 为 string，需转 BigInt） */
interface AuthedRequest {
  user?: { id: string; school_id: string; identity_type: string };
}

@Controller('products')
@UseGuards(JwtAuthGuard)
export class ProductController {
  constructor(private readonly publishService: ProductPublishService) {}

  /** @api §5.2 #10 POST /products @ac F5-AC1/F5-AC2/F5-AC3/F10a-AC1 */
  @Post()
  async publish(
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ): Promise<ApiResponse<PublishProductResult>> {
    if (!req.user) {
      throw new BusinessError(ERROR_CODES.AUTH_TOKEN_INVALID, '未登录或登录已过期');
    }
    const seller: SellerContext = {
      id: BigInt(req.user.id),
      schoolId: BigInt(req.user.school_id),
      identityType: req.user.identity_type,
    };
    const data = await this.publishService.publish(seller, body);
    return { code: 0, message: 'ok', data };
  }
}
