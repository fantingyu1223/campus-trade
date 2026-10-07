/**
 * account.controller.ts —— 账号管理 HTTP 入口（A6 账号管理页）
 *
 * @module PIM-BC-05/06
 * @api §5.3 治理分组扩展（accounts，契约未编号，对齐 admin-web/src/api/account.ts）
 *
 * 路由：GET /admin/v1/accounts、GET /accounts/:id、POST /accounts/:id/ban、
 * POST /accounts/:id/unban。读接口 auditor/admin 均可；封禁/解封仅超管 admin
 * （assertSuperAdmin，auditor → 6001，§5.3 通用约定）。
 */
import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AdminJwtGuard } from '@infra/auth/admin-jwt.guard';
import { AccountService } from './account.service';
import { validateAccountIdParam } from './account.validator';
import { assertSuperAdmin } from './word-list.validator';

interface AdminRequest {
  admin: { admin_id: string; role: string };
}

@Controller('admin/v1')
@UseGuards(AdminJwtGuard)
export class AccountController {
  constructor(private readonly account: AccountService) {}

  /** 账号检索（keyword/status/role + 分页） */
  @Get('accounts')
  async list(@Query() q: unknown) {
    return { code: 0, message: 'ok', data: await this.account.list(q) };
  }

  /** 账号详情（统计 + ban_info + 操作留痕） */
  @Get('accounts/:id')
  async detail(@Param('id') id: string) {
    return { code: 0, message: 'ok', data: await this.account.detail(validateAccountIdParam(id)) };
  }

  /** 封禁（仅 admin；duration_days=-1 永久） */
  @Post('accounts/:id/ban')
  async ban(@Req() req: AdminRequest, @Param('id') id: string, @Body() body: unknown) {
    assertSuperAdmin(req.admin.role);
    return {
      code: 0,
      message: 'ok',
      data: await this.account.ban(req.admin.admin_id, validateAccountIdParam(id), body),
    };
  }

  /** 解封（仅 admin） */
  @Post('accounts/:id/unban')
  async unban(@Req() req: AdminRequest, @Param('id') id: string) {
    assertSuperAdmin(req.admin.role);
    return {
      code: 0,
      message: 'ok',
      data: await this.account.unban(req.admin.admin_id, validateAccountIdParam(id)),
    };
  }
}
