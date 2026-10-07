/**
 * risk-review.controller.ts —— 黄牛预警复核后台接口（T-304）
 * @module PIM-BC-05
 * @rule CIM-R-36
 */
import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AdminJwtGuard } from '@infra/auth/admin-jwt.guard';
import { RiskReviewService } from './risk-review.service';
import { ReviewRequest } from './dto/risk.dto';

@Controller('admin/v1')
@UseGuards(AdminJwtGuard)
export class RiskReviewController {
  constructor(private readonly service: RiskReviewService) {}

  @Get('risk-warnings')
  async list(@Query() q: Record<string, unknown>) {
    const data = await this.service.list(q);
    return { code: 0, message: 'ok', data };
  }

  @Post('risk-warnings/:id/review')
  async review(@Param('id') id: string, @Body() body: ReviewRequest, @Req() req: any) {
    const adminId = String(req.admin.admin_id);
    const data = await this.service.review(adminId, id, body);
    return { code: 0, message: 'ok', data };
  }
}
