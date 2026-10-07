/**
 * order.module.ts —— 交易订单限界上下文模块
 *
 * @module PIM-BC-04 交易订单
 * @model PIM-AG-06 交易订单聚合
 * 集成批次补全：CancelController/CancelService（§5.2 #33-35 取消/拒收）注册。
 */
import { Module } from '@nestjs/common';
import { PrismaService } from '@infra/prisma.service';
import { JwtAuthGuard } from '@infra/auth/jwt.guard';
import { OrderController } from './order.controller';
import { OrderRepository } from './order.repository';
import { OrderService } from './order.service';
import { OrderTimeoutCron } from './order-timeout.cron';
import { PaymentRecordService } from './payment-record.service';
import { CancelController } from './cancel.controller';
import { CancelService } from './cancel.service';

@Module({
  controllers: [OrderController, CancelController],
  providers: [
    PrismaService,
    OrderRepository,
    OrderService,
    PaymentRecordService,
    CancelService,
    OrderTimeoutCron,
    JwtAuthGuard,
  ],
})
export class OrderModule {}
