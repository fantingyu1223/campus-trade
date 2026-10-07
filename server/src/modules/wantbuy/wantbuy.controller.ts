/**
 * wantbuy.controller.ts —— 求购控制器（统一响应包络 §5.1）
 *
 * @module PIM-BC-02 商品与供给（求购子域）
 * @model PIM-AG-04 求购聚合
 * @api §5.2 #20 POST /want-buys、#24 GET /want-buys、#21 POST /want-buys/:id/renew、
 *      #22 POST /want-buys/:id/close、#23 POST /want-buys/:id/bought
 * @ac F9-AC1 发布成功且仅 active 进入撮合面 / F9-AC2 30 天有效期 + 续期重置 /
 *     F9-AC3 关闭/已买到立即停撮合且不再出现于列表
 *
 * 纪律：scope=all 游客可读（透传 null 上下文）；scope=mine 须登录（服务层 1001）；
 * 写操作未登录 1001 且不透传 service；业务错误原样上抛，由全局过滤器统一包装。
 */
import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ERROR_CODES } from '@contract/index';
import { JwtAuthGuard } from '@infra/auth/jwt.guard';
import { BusinessError, WantBuyService } from './wantbuy.service';
import type { UserContext } from './wantbuy.service';
import type {
  BoughtWantBuyResult,
  CloseWantBuyResult,
  PublishWantBuyResult,
  RenewWantBuyResult,
  WantBuyListRawQuery,
  WantBuyListResult,
} from './dto/wantbuy.dto';

interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

/** 认证上下文（JWT 载荷写入 req.user；id/school_id 为 string，需转 BigInt） */
interface AuthedRequest {
  user?: { id: string; school_id: string; identity_type: string };
}

@Controller('want-buys')
export class WantBuyController {
  constructor(private readonly wantBuyService: WantBuyService) {}

  /** @api §5.2 #20 POST /want-buys @ac F9-AC1 */
  @Post()
  @UseGuards(JwtAuthGuard)
  async publish(@Body() body: unknown, @Req() req: AuthedRequest): Promise<ApiResponse<PublishWantBuyResult>> {
    const data = await this.wantBuyService.publish(this.requireUser(req), body);
    return { code: 0, message: 'ok', data };
  }

  /** @api §5.2 #24 GET /want-buys @ac F9-AC1/F9-AC3：scope=all 游客可读，scope=mine 须登录 */
  @Get()
  async list(@Query() query: WantBuyListRawQuery, @Req() req: AuthedRequest): Promise<ApiResponse<WantBuyListResult>> {
    const data = await this.wantBuyService.list(this.optionalUser(req), query ?? {});
    return { code: 0, message: 'ok', data };
  }

  /** @api §5.2 #21 POST /want-buys/:id/renew @ac F9-AC2 */
  @Post(':id/renew')
  @UseGuards(JwtAuthGuard)
  async renew(@Param('id') id: string, @Req() req: AuthedRequest): Promise<ApiResponse<RenewWantBuyResult>> {
    const data = await this.wantBuyService.renew(this.requireUser(req), id);
    return { code: 0, message: 'ok', data };
  }

  /** @api §5.2 #22 POST /want-buys/:id/close @ac F9-AC3 */
  @Post(':id/close')
  @UseGuards(JwtAuthGuard)
  async close(@Param('id') id: string, @Req() req: AuthedRequest): Promise<ApiResponse<CloseWantBuyResult>> {
    const data = await this.wantBuyService.close(this.requireUser(req), id);
    return { code: 0, message: 'ok', data };
  }

  /** @api §5.2 #23 POST /want-buys/:id/bought @ac F9-AC3 */
  @Post(':id/bought')
  @UseGuards(JwtAuthGuard)
  async bought(@Param('id') id: string, @Req() req: AuthedRequest): Promise<ApiResponse<BoughtWantBuyResult>> {
    const data = await this.wantBuyService.markBought(this.requireUser(req), id);
    return { code: 0, message: 'ok', data };
  }

  /** 鉴权上下文：req.user 缺失 → 1001（不透传 service） */
  private requireUser(req: AuthedRequest): UserContext {
    const user = this.optionalUser(req);
    if (!user) {
      throw new BusinessError(ERROR_CODES.AUTH_TOKEN_INVALID, '未登录或登录已过期');
    }
    return user;
  }

  /** 可选上下文：未登录返回 null（游客 scope=all 可读） */
  private optionalUser(req: AuthedRequest): UserContext | null {
    if (!req?.user || !/^\d+$/.test(req.user.id)) {
      return null;
    }
    return { id: BigInt(req.user.id), schoolId: BigInt(req.user.school_id) };
  }
}
