/**
 * admin-support.module.ts —— 后台支撑配置模块装配（高校名单配置 §5.3 #68-73）
 *
 * @module PIM-BC-06 触达支撑（后台配置侧）
 * @api §5.3 school #68-73
 * @ac F36-AC2
 *
 * 路由口径：控制器自带 'admin/v1' 前缀（契约 §5.3），不经全局 api/v1 前缀
 * （main.ts 以 setGlobalPrefix exclude 豁免）。
 * school-admin.validator.ts 为纯函数校验器（非 Injectable），无需注册 provider。
 */
import { Module } from '@nestjs/common';
import { PrismaService } from '@infra/prisma.service';
import { AdminJwtGuard } from '@infra/auth/admin-jwt.guard';
import { AdminLogService } from '@infra/admin-log/admin-log.interceptor';
import { AdminLogRepository } from '@infra/admin-log/admin-log.repository';
import { SchoolAdminController } from './school-admin.controller';
import { SchoolAdminService } from './school-admin.service';
import { SchoolAdminRepository } from './school-admin.repository';

@Module({
  controllers: [SchoolAdminController],
  providers: [
    PrismaService,
    AdminJwtGuard,
    AdminLogService,
    AdminLogRepository,
    SchoolAdminService,
    SchoolAdminRepository,
  ],
  exports: [SchoolAdminService],
})
export class AdminSupportModule {}
