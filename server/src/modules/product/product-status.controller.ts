/**
 * product-status.controller.ts —— 商品状态管理控制器（统一响应包络 §5.1）
 *
 * @module PIM-BC-02 商品与供给
 * @statemachine PIM-SM-02 商品状态机
 * @rule CIM-R-13 标记已售须指定会话买家
 * @api §5.2 #12 POST /products/{id}/offline、#13 POST /products/{id}/sold、#16 GET /products/mine
 *      补充接口（本批次声明）：POST /products/{id}/relist、GET /products/{id}/buyer-candidates（U13 配套）
 * @ac F7-AC1/F7-AC2/F7-AC3
 *
 * 纪律：路由顺序固定——'mine' 字面量路由必须先声明于 ':id' 参数路由之前（Nest 按声明顺序匹配）。
 * 业务错误原样上抛，由全局过滤器统一包装。
 */
import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ERROR_CODES } from '@contract/index';
import { JwtAuthGuard } from '@infra/auth/jwt.guard';
import { BusinessError } from './product-publish.service';
import { MineQuery, ProductStatusService } from './product-status.service';
import type {
  BuyerCandidateItem,
  MarkSoldResult,
  MineListResult,
  MineTabsResult,
  OfflineResult,
  RelistResult,
} from './dto/status.dto';

interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

/** 认证上下文（JWT 载荷写入 req.user；id 为 string，需转 BigInt） */
interface AuthedRequest {
  user?: { id: string; school_id: string; identity_type: string };
}

/** 标记已售请求体（#13；buyer_id 缺失/非法由服务层 9001 拦截，CIM-R-13） */
interface MarkSoldBody {
  buyer_id?: string;
}

@Controller('products')
@UseGuards(JwtAuthGuard)
export class ProductStatusController {
  constructor(private readonly statusService: ProductStatusService) {}

  /** @api §5.2 #12 POST /products/:id/offline @ac F7-AC1 */
  @Post(':id/offline')
  async offline(@Param('id') id: string, @Req() req: AuthedRequest): Promise<ApiResponse<OfflineResult>> {
    const data = await this.statusService.offline(this.userId(req), id);
    return { code: 0, message: 'ok', data };
  }

  /** 补充接口 POST /products/:id/relist @statemachine PIM-SM-02 off_sale → on_sale @ac F7-AC1 */
  @Post(':id/relist')
  async relist(@Param('id') id: string, @Req() req: AuthedRequest): Promise<ApiResponse<RelistResult>> {
    const data = await this.statusService.relist(this.userId(req), id);
    return { code: 0, message: 'ok', data };
  }

  /** @api §5.2 #13 POST /products/:id/sold @rule CIM-R-13 @ac F7-AC2 */
  @Post(':id/sold')
  async markSold(
    @Param('id') id: string,
    @Body() body: MarkSoldBody,
    @Req() req: AuthedRequest,
  ): Promise<ApiResponse<MarkSoldResult>> {
    const data = await this.statusService.markSold(this.userId(req), id, body?.buyer_id);
    return { code: 0, message: 'ok', data };
  }

  /**
   * @api §5.2 #16 GET /products/mine @ac F7-AC3
   * 有 status → 分页单组；无 status → 分栏三组（在售=on_sale+trading）。
   */
  @Get('mine')
  async mine(
    @Req() req: AuthedRequest,
    @Query() query: MineQuery,
  ): Promise<ApiResponse<MineListResult | MineTabsResult>> {
    const sellerId = this.userId(req);
    const data = query?.status !== undefined
      ? await this.statusService.listMine(sellerId, query)
      : await this.statusService.listMineTabs(sellerId);
    return { code: 0, message: 'ok', data };
  }

  /** 补充接口 GET /products/:id/buyer-candidates（U13 配套，@rule CIM-R-13 选买家入口） */
  @Get(':id/buyer-candidates')
  async buyerCandidates(
    @Param('id') id: string,
    @Req() req: AuthedRequest,
  ): Promise<ApiResponse<BuyerCandidateItem[]>> {
    const data = await this.statusService.listBuyerCandidates(this.userId(req), id);
    return { code: 0, message: 'ok', data };
  }

  /** 鉴权上下文：req.user 缺失 → 1001（不透传 service） */
  private userId(req: AuthedRequest): bigint {
    if (!req.user) {
      throw new BusinessError(ERROR_CODES.AUTH_TOKEN_INVALID, '未登录或登录已过期');
    }
    return BigInt(req.user.id);
  }
}
