/**
 * @module PIM-BC-01
 * @model PIM-AG-10
 * @api §5.2 merchant #7 POST /merchant/apply；#8 GET /merchant/apply/status；#9 GET /merchant/apply/cooldown
 * @ac F32-AC1
 * 商家入驻申请控制器（F32 提交侧）：提交 / 状态查询 / 冷却期查询（均需 JWT 登录态）。
 *
 * 契约偏离声明：§5.2 merchant 表中 #9 为「PUT /merchant/apply 驳回后重新提交」，
 * 本任务按任务清单 T-305 将 #9 实现为「GET /merchant/apply/cooldown 冷却期查询」；
 * 驳回后重新提交由 #7 在冷却过期后直接重提承载（创建新记录）。
 */
import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@infra/auth/jwt.guard';
import { MerchantApplyService } from './merchant-apply.service';
import {
  MerchantApplyResponse,
  MerchantApplyStatusResponse,
  MerchantCooldownResponse,
} from './dto/merchant-apply.dto';

interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

@Controller('merchant/apply')
export class MerchantApplyController {
  constructor(private readonly merchantApply: MerchantApplyService) {}

  /** @api §5.2 #7 POST /merchant/apply @ac F32-AC1 */
  @Post()
  @UseGuards(JwtAuthGuard)
  async apply(
    @Req() req: { user: { uid: string } },
    @Body() body: unknown,
  ): Promise<ApiResponse<MerchantApplyResponse>> {
    return { code: 0, message: 'ok', data: await this.merchantApply.apply(req.user.uid, body) };
  }

  /** @api §5.2 #8 GET /merchant/apply/status @ac F32-AC1 */
  @Get('status')
  @UseGuards(JwtAuthGuard)
  async status(
    @Req() req: { user: { uid: string } },
  ): Promise<ApiResponse<MerchantApplyStatusResponse>> {
    return { code: 0, message: 'ok', data: await this.merchantApply.getStatus(req.user.uid) };
  }

  /** @api §5.2 #9 GET /merchant/apply/cooldown @ac F32-AC1 */
  @Get('cooldown')
  @UseGuards(JwtAuthGuard)
  async cooldown(
    @Req() req: { user: { uid: string } },
  ): Promise<ApiResponse<MerchantCooldownResponse>> {
    return { code: 0, message: 'ok', data: await this.merchantApply.getCooldown(req.user.uid) };
  }
}
