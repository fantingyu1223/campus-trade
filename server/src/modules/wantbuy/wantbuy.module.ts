/**
 * wantbuy.module.ts —— 求购模块装配
 *
 * @module PIM-BC-02 商品与供给（求购子域）
 * @model PIM-AG-04 求购聚合
 * @api §5.2 #20-24
 * @ac F9-AC1/F9-AC2/F9-AC3
 * 集成批次补全：WantBuyMatchService（撮合）/WantBuyExpireCron（到期失效）注册；
 * 两者依赖 NotifySenderService + NotificationRepository（infra 下沉，PIM-C-3 口径）。
 */
import { Module } from '@nestjs/common';
import { PrismaService } from '@infra/prisma.service';
import { JwtAuthGuard } from '@infra/auth/jwt.guard';
import { NotifySenderService } from '@infra/notify-sender/notify-sender.service';
import { NotificationRepository } from '@infra/notify-sender/notification.repository';
import { WantBuyController } from './wantbuy.controller';
import { WantBuyRepository } from './wantbuy.repository';
import { WantBuyService } from './wantbuy.service';
import { WantBuyMatchService } from './wantbuy-match.service';
import { WantBuyExpireCron } from './wantbuy-expire.cron';

@Module({
  controllers: [WantBuyController],
  providers: [
    PrismaService,
    WantBuyRepository,
    WantBuyService,
    WantBuyMatchService,
    WantBuyExpireCron,
    NotifySenderService,
    NotificationRepository,
    JwtAuthGuard,
  ],
  exports: [WantBuyMatchService],
})
export class WantBuyModule {}
