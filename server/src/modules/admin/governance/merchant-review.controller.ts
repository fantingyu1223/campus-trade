/**
 * merchant-review.controller.ts —— 商家入驻审核后台接口（T-306）
 * @module PIM-AG-10
 */
import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AdminJwtGuard } from '@infra/auth/admin-jwt.guard';
import { MerchantReviewService } from './merchant-review.service';
import { ApproveBody, RejectBody } from './dto/merchant-review.dto';

@Controller('admin/v1')
@UseGuards(AdminJwtGuard)
export class MerchantReviewController {
  constructor(private readonly service: MerchantReviewService) {}

  @Get('merchant-reviews')
  async list(@Query() q: Record<string, unknown>) {
    const data = await this.service.list(q);
    return { code: 0, message: 'ok', data };
  }

  @Get('merchant-reviews/:id')
  async detail(@Param('id') id: string, @Req() req: any) {
    const adminId = String(req.admin.admin_id);
    const data = await this.service.detail(adminId, id);
    return { code: 0, message: 'ok', data };
  }

  @Post('merchant-reviews/:id/approve')
  async approve(@Param('id') id: string, @Body() body: ApproveBody, @Req() req: any) {
    const adminId = String(req.admin.admin_id);
    const data = await this.service.approve(adminId, id, body);
    return { code: 0, message: 'ok', data };
  }

  @Post('merchant-reviews/:id/reject')
  async reject(@Param('id') id: string, @Body() body: RejectBody, @Req() req: any) {
    const adminId = String(req.admin.admin_id);
    const data = await this.service.reject(adminId, id, body);
    return { code: 0, message: 'ok', data };
  }
}
