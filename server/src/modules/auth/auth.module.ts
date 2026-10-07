/**
 * @module PIM-BC-01
 * 认证模块装配：控制器、领域服务、仓储、基础设施（JWT/微信客户端/Prisma）。
 * 集成批次补全：verification/school/merchant-apply/account-cancel 四组注册。
 * validator 文件均为纯函数校验器（非 Injectable），无需注册 provider。
 */
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthRepository } from './auth.repository';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';
import { VerificationRepository } from './verification.repository';
import { SchoolController } from './school.controller';
import { SchoolService } from './school.service';
import { SchoolRepository } from './school.repository';
import { MerchantApplyController } from './merchant-apply.controller';
import { MerchantApplyService } from './merchant-apply.service';
import { MerchantApplyRepository } from './merchant-apply.repository';
import { AccountCancelController } from './account-cancel.controller';
import { AccountCancelService } from './account-cancel.service';
import { JwtAuthGuard } from '@infra/auth/jwt.guard';
import { WxCode2SessionClient } from '@infra/auth/wx-code2session.client';
import { PrismaService } from '@infra/prisma.service';

@Module({
  controllers: [
    AuthController,
    VerificationController,
    SchoolController,
    MerchantApplyController,
    AccountCancelController,
  ],
  providers: [
    AuthService,
    AuthRepository,
    VerificationService,
    VerificationRepository,
    SchoolService,
    SchoolRepository,
    MerchantApplyService,
    MerchantApplyRepository,
    AccountCancelService,
    WxCode2SessionClient,
    JwtAuthGuard,
    PrismaService,
  ],
  exports: [AuthService],
})
export class AuthModule {}
