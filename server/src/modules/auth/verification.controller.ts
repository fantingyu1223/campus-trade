/**
 * @module PIM-BC-01
 * @api §5.2 #3 POST /auth/verify；§5.2 #4 GET /auth/verify/status
 * @ac F1-AC1/F1-AC2/F1-AC3
 * 身份认证控制器：认证提交与状态查询（均需 JWT 登录态）。
 */
import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@infra/auth/jwt.guard';
import { VerificationService } from './verification.service';
import { VerifyStatusResponse, VerifySubmitResponse } from './dto/verify.dto';

interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

@Controller('auth/verify')
export class VerificationController {
  constructor(private readonly verification: VerificationService) {}

  /** @api §5.2 #3 POST /auth/verify @ac F1-AC1/AC2/AC3 */
  @Post()
  @UseGuards(JwtAuthGuard)
  async submit(
    @Req() req: { user: { uid: string } },
    @Body() body: unknown,
  ): Promise<ApiResponse<VerifySubmitResponse>> {
    return { code: 0, message: 'ok', data: await this.verification.submit(req.user.uid, body) };
  }

  /** @api §5.2 #4 GET /auth/verify/status @ac F1 */
  @Get('status')
  @UseGuards(JwtAuthGuard)
  async status(
    @Req() req: { user: { uid: string } },
  ): Promise<ApiResponse<VerifyStatusResponse>> {
    return { code: 0, message: 'ok', data: await this.verification.getStatus(req.user.uid) };
  }
}
