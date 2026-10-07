/**
 * report-queue.controller.ts —— 举报队列/详情/处置 HTTP 入口（T-302）
 *
 * @module PIM-BC-05 信任与治理
 * @model PIM-AG-08 举报聚合
 * @api §5.3 #54-56
 *
 * 路由：GET /admin/v1/reports、GET /admin/v1/reports/:id、POST /admin/v1/reports/:id
 * 统一响应 {code:0,message:'ok',data}；BusinessError 由全局过滤器映射错误码。
 */
import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AdminJwtGuard } from '@infra/auth/admin-jwt.guard';
import { ReportDisposalService } from './report-disposal.service';

interface AdminRequest {
  admin: { admin_id: string };
}

@Controller('admin/v1')
@UseGuards(AdminJwtGuard)
export class ReportQueueController {
  constructor(private readonly disposal: ReportDisposalService) {}

  /** §5.3 #54 举报队列 */
  @Get('reports')
  async queue(@Query() q: unknown) {
    const data = await this.disposal.getQueue(q);
    return { code: 0, message: 'ok', data };
  }

  /** §5.3 #55 举报详情（匿名口径：不含 reporter_id） */
  @Get('reports/:id')
  async detail(@Param('id') id: string) {
    const data = await this.disposal.getDetail(BigInt(id));
    return { code: 0, message: 'ok', data };
  }

  /** §5.3 #56 处置提交（adminId 取自 AdminJwtGuard 注入的 req.admin.admin_id） */
  @Post('reports/:id')
  async action(@Param('id') id: string, @Body() body: unknown, @Req() req: AdminRequest) {
    const data = await this.disposal.action(req.admin.admin_id, BigInt(id), body);
    return { code: 0, message: 'ok', data };
  }
}
