/**
 * admin-auth.controller.ts —— 后台管理员认证 HTTP 入口（§5.3 #51）
 *
 * @module PIM-BC-05
 * @api §5.3 #51
 *
 * 路由：POST /admin/v1/auth/login（登录前置，不挂 AdminJwtGuard）。
 * 统一响应 {code:0,message:'ok',data}；BusinessError 由全局过滤器映射错误码。
 */
import { Body, Controller, Post } from '@nestjs/common';
import { AdminAuthService } from './admin-auth.service';

@Controller('admin/v1')
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  /** §5.3 #51 后台登录（账号+密码 → JWT） */
  @Post('auth/login')
  async login(@Body() body: unknown) {
    const data = await this.auth.login(body);
    return { code: 0, message: 'ok', data };
  }
}
