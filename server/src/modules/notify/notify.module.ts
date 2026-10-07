/**
 * notify/notify.module.ts —— notify 模块装配（模块自含，§3.1）。
 *
 * @module PIM-BC-06 触达支撑
 * PrismaService 为 infra 层共享连接设施，NotificationRepository 为
 * infra/notify-sender 下沉仓储（PIM-C-3 暂定口径），JwtAuthGuard 为认证守卫，
 * 三者在此注册为本模块 provider。
 */
import { Module } from '@nestjs/common';
import { PrismaService } from '@infra/prisma.service';
import { JwtAuthGuard } from '@infra/auth/jwt.guard';
import { NotificationRepository } from '@infra/notify-sender/notification.repository';
import { NotifyController } from './notify.controller';
import { NotifyQueryService } from './notify-query.service';

@Module({
  controllers: [NotifyController],
  providers: [PrismaService, NotificationRepository, JwtAuthGuard, NotifyQueryService],
  exports: [NotifyQueryService],
})
export class NotifyModule {}
