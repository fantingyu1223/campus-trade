/**
 * @module PIM-BC-01
 * @api §5.2 #1 POST /auth/wx-login；§5.2 #2 GET /auth/me
 * @ac F1
 * 认证控制器：微信登录（无守卫）与当前用户信息（JWT 守卫）。
 */
import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '@infra/auth/jwt.guard';
import { AuthMeResponse, WxLoginResponse } from './dto/login.dto';

interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** @api §5.2 #1 POST /auth/wx-login @ac F1 */
  @Post('wx-login')
  async wxLogin(@Body() body: unknown): Promise<ApiResponse<WxLoginResponse>> {
    return { code: 0, message: 'ok', data: await this.auth.wxLogin(body) };
  }

  /** @api §5.2 #2 GET /auth/me @ac F1 */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@Req() req: { user: { uid: string } }): Promise<ApiResponse<AuthMeResponse>> {
    return { code: 0, message: 'ok', data: await this.auth.me(req.user.uid) };
  }
}
