/**
 * chat/chat.module.ts —— 沟通与协商限界上下文模块（模块自含，§3.1）
 *
 * @module PIM-BC-03 沟通与协商
 * PrismaService 为 infra 层共享连接设施，JwtAuthGuard/VerifiedGuard 为
 * 认证与实名守卫，与仓储/服务一并注册为本模块 provider。
 * 集成批次补全：IntentController/IntentService（§5.2 #28-29 交易意向卡片）注册。
 */
import { Module } from '@nestjs/common';
import { PrismaService } from '@infra/prisma.service';
import { JwtAuthGuard } from '@infra/auth/jwt.guard';
import { VerifiedGuard } from '@infra/auth/verified.guard';
import { ChatController } from './chat.controller';
import { ChatRepository } from './chat.repository';
import { ConversationService } from './conversation.service';
import { MessageService } from './message.service';
import { RiskWordService } from './risk-word.service';
import { IntentController } from './intent.controller';
import { IntentService } from './intent.service';

@Module({
  controllers: [ChatController, IntentController],
  providers: [
    PrismaService,
    ChatRepository,
    ConversationService,
    MessageService,
    RiskWordService,
    IntentService,
    JwtAuthGuard,
    VerifiedGuard,
  ],
})
export class ChatModule {}
