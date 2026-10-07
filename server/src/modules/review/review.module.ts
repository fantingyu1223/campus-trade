/**
 * review.module.ts —— 交易评价限界上下文模块
 *
 * @module PIM-BC-05 交易评价
 */
import { Module } from '@nestjs/common';
import { PrismaService } from '@infra/prisma.service';
import { JwtAuthGuard } from '@infra/auth/jwt.guard';
import { ReviewController } from './review.controller';
import { ReviewRepository } from './review.repository';
import { ReviewService } from './review.service';
import { ReviewDefaultCron } from './review-default.cron';

@Module({
  controllers: [ReviewController],
  providers: [PrismaService, ReviewRepository, ReviewService, ReviewDefaultCron, JwtAuthGuard],
})
export class ReviewModule {}
