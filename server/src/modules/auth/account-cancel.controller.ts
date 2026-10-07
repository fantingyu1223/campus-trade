/**
 * @module PIM-BC-01
 * @model PIM-AG-01
 * @rule CIM-R-34
 * @api F26 POST /account/cancel；GET /account/cancel/status
 * 账号注销控制器：注销申请与注销状态查询（登录态缺失 uid → 1001）。
 */
import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ERROR_CODES } from '@contract/index';
import { JwtAuthGuard } from '@infra/auth/jwt.guard';
import { AccountCancelService } from './account-cancel.service';
import { BusinessError } from './auth.service';
import {
  AccountCancelRequest,
  AccountCancelResponse,
  AccountCancelStatusResponse,
} from './dto/account-cancel.dto';

interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

/** 从请求登录态取 uid，缺失 → 1001 */
const requireUid = (req: { user?: { uid?: string } }): string => {
  const uid = req.user?.uid;
  if (!uid) {
    throw new BusinessError(ERROR_CODES.AUTH_TOKEN_INVALID, '登录态缺失或无效');
  }
  return uid;
};

@Controller('account/cancel')
@UseGuards(JwtAuthGuard)
export class AccountCancelController {
  constructor(private readonly accountCancel: AccountCancelService) {}

  /** @api F26-AC1 POST /account/cancel */
  @Post('')
  async cancel(
    @Req() req: { user?: { uid?: string } },
    @Body() body: AccountCancelRequest,
  ): Promise<ApiResponse<AccountCancelResponse>> {
    return { code: 0, message: 'ok', data: await this.accountCancel.cancel(requireUid(req), body) };
  }

  /** @api F26 GET /account/cancel/status */
  @Get('status')
  async status(
    @Req() req: { user?: { uid?: string } },
  ): Promise<ApiResponse<AccountCancelStatusResponse>> {
    return { code: 0, message: 'ok', data: await this.accountCancel.getStatus(requireUid(req)) };
  }
}
