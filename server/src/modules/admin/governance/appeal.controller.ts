/**
 * appeal.controller.ts —— 申诉仲裁 HTTP 入口（§5.3 #65-67）
 *
 * @module PIM-BC-05 信任与治理
 * @model PIM-AG-09 申诉聚合
 * @api §5.3 #65-67
 *
 * 路由：GET /admin/v1/appeals、GET /admin/v1/appeals/:id、
 * POST /admin/v1/appeals/:id/adjudicate（AdminJwtGuard 鉴权，auditor/admin 均可）。
 * 统一响应 {code:0,message:'ok',data}；BusinessError 由全局过滤器映射错误码。
 */
import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AdminJwtGuard } from '@infra/auth/admin-jwt.guard';
import { AppealService } from './appeal.service';
import { validateAppealIdParam } from './appeal.validator';

interface AdminRequest {
  admin: { admin_id: string };
}

@Controller('admin/v1')
@UseGuards(AdminJwtGuard)
export class AppealController {
  constructor(private readonly appeal: AppealService) {}

  /** §5.3 #65 申诉队列（48h 介入时限升序，type/status 过滤） */
  @Get('appeals')
  async queue(@Query() q: unknown) {
    const data = await this.appeal.getQueue(q);
    return { code: 0, message: 'ok', data };
  }

  /** §5.3 #66 申诉详情（理由/证据/关联上下文/聊天摘要占位） */
  @Get('appeals/:id')
  async detail(@Param('id') id: string) {
    const data = await this.appeal.getDetail(validateAppealIdParam(id));
    return { code: 0, message: 'ok', data };
  }

  /** §5.3 #67 裁决提交（adminId 取自 AdminJwtGuard 注入的 req.admin.admin_id） */
  @Post('appeals/:id/adjudicate')
  async adjudicate(@Param('id') id: string, @Body() body: unknown, @Req() req: AdminRequest) {
    const data = await this.appeal.adjudicate(req.admin.admin_id, validateAppealIdParam(id), body);
    return { code: 0, message: 'ok', data };
  }
}
