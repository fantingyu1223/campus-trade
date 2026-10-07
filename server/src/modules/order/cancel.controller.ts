/**
 * cancel.controller.ts —— 订单取消/拒收控制器
 *
 * @module PIM-BC-04 交易订单
 * @api §5.2 #33 POST /orders/{id}/cancel、#34 POST /orders/{id}/cancel/respond、
 *      #35 POST /orders/{id}/reject-onsite（统一响应包络 §5.1）
 * @ac F35-AC1/F35-AC2/F35-AC4
 */
import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ERROR_CODES } from '@contract/index';
import { JwtAuthGuard } from '@infra/auth/jwt.guard';
import { BusinessError, BuyerContext } from './order.service';
import { CancelService } from './cancel.service';
import type {
  CancelRespondResult,
  CancelResult,
  RejectOnsiteResult,
} from './dto/cancel.dto';

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
const requireUser = (req: AuthedRequest): BuyerContext => {
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
export class CancelController {
  constructor(private readonly cancelService: CancelService) {}

  /** @api §5.2 #33 POST /orders/{id}/cancel（发起取消，24h 响应窗口） */
  @Post(':id/cancel')
  async cancel(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ): Promise<ApiResponse<CancelResult>> {
    const actor = requireUser(req);
    const data = await this.cancelService.requestCancel(parseOrderId(id), actor, body);
    return { code: 0, message: 'ok', data };
  }

  /** @api §5.2 #34 POST /orders/{id}/cancel/respond（响应取消 agree/reject） */
  @Post(':id/cancel/respond')
  async respondCancel(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ): Promise<ApiResponse<CancelRespondResult>> {
    const actor = requireUser(req);
    const data = await this.cancelService.respondCancel(parseOrderId(id), actor, body);
    return { code: 0, message: 'ok', data };
  }

  /** @api §5.2 #35 POST /orders/{id}/reject-onsite（现场拒收，时间+说明必填留痕） */
  @Post(':id/reject-onsite')
  async rejectOnsite(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ): Promise<ApiResponse<RejectOnsiteResult>> {
    const actor = requireUser(req);
    const data = await this.cancelService.rejectOnsite(parseOrderId(id), actor, body);
    return { code: 0, message: 'ok', data };
  }
}
