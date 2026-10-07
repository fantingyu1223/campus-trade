/**
 * order.controller.ts —— 订单控制器
 *
 * @module PIM-BC-04 交易订单
 * @api §5.2 #30 POST /orders、#31 GET /orders/{id}、#32 POST /orders/{id}/confirm-receive（统一响应包络 §5.1）
 * @ac F34-AC1/F34-AC2/F34-AC3
 */
import { Body, Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ERROR_CODES } from '@contract/index';
import { JwtAuthGuard } from '@infra/auth/jwt.guard';
import { BusinessError, BuyerContext, OrderService } from './order.service';
import type { ConfirmReceiveResult, CreateOrderResult, OrderDetailResult } from './dto/order.dto';

interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

/** 认证上下文（JWT 载荷写入 req.user；uid 为 string，需转 BigInt） */
interface AuthedRequest {
  user?: { uid?: string; id?: string };
}

/** 登录守卫：uid 缺失 → 1001 */
const requireBuyer = (req: AuthedRequest): BuyerContext => {
  const uid = req.user?.uid ?? req.user?.id;
  if (!uid) {
    throw new BusinessError(ERROR_CODES.AUTH_TOKEN_INVALID, '未登录或登录已过期');
  }
  return { id: BigInt(uid) };
};

/** 路径参数订单 ID：非法 → 9001 */
const parseOrderId = (raw: string): bigint => {
  try {
    const id = BigInt(raw);
    if (id <= BigInt(0)) throw new Error();
    return id;
  } catch {
    throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, 'id 非法');
  }
};

@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  /** @api §5.2 #30 POST /orders（幂等：Idempotency-Key 头 + buyer+product 活跃单去重） */
  @Post()
  async create(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: AuthedRequest,
  ): Promise<ApiResponse<CreateOrderResult>> {
    const buyer = requireBuyer(req);
    const data = await this.orderService.create(buyer, body, idempotencyKey);
    return { code: 0, message: 'ok', data };
  }

  /** @api §5.2 #31 GET /orders/{id}（五态 + 倒计时 + timeline） */
  @Get(':id')
  async detail(
    @Param('id') id: string,
    @Req() req: AuthedRequest,
  ): Promise<ApiResponse<OrderDetailResult>> {
    requireBuyer(req);
    const data = await this.orderService.detail(parseOrderId(id));
    return { code: 0, message: 'ok', data };
  }

  /** @api §5.2 #32 POST /orders/{id}/confirm-receive（pending_confirm → completed） */
  @Post(':id/confirm-receive')
  async confirmReceive(
    @Param('id') id: string,
    @Req() req: AuthedRequest,
  ): Promise<ApiResponse<ConfirmReceiveResult>> {
    const buyer = requireBuyer(req);
    const data = await this.orderService.confirmReceive(parseOrderId(id), buyer);
    return { code: 0, message: 'ok', data };
  }
}
