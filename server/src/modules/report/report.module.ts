/**
 * report.module.ts —— 举报限界上下文模块
 *
 * @module PIM-BC-05 举报
 * @model PIM-AG-08 举报聚合
 */
import { Module } from '@nestjs/common';
import { PrismaService } from '@infra/prisma.service';
import { JwtAuthGuard } from '@infra/auth/jwt.guard';
import { ReportController } from './report.controller';
import { ReportRepository } from './report.repository';
import { ReportService } from './report.service';

@Module({
  controllers: [ReportController],
  providers: [PrismaService, ReportRepository, ReportService, JwtAuthGuard],
})
export class ReportModule {}
