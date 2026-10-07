/**
 * governance.module.ts —— 后台治理模块装配（举报处置 / 黄牛预警 / 商家审核 / 禁入驻三件套）
 *
 * @module PIM-BC-05 信任与治理（后台侧）
 * @api §5.3 #54-56（举报队列/详情/处置）、黄牛预警复核（T-304）、商家入驻审核（T-306）
 *
 * 路由口径：控制器自带 'admin/v1' 前缀（契约 §5.3），不经全局 api/v1 前缀
 * （main.ts 以 setGlobalPrefix exclude 豁免）。
 *
 * cron 自含调度：各 cron 的 start() 内部自行检查 env 开关（*_CRON_ENABLED==='1'），
 * 模块 onModuleInit 统一触发、onModuleDestroy 统一停止，缺省不启动（避免测试悬挂）。
 */
import { Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@infra/prisma.service';
import { AdminJwtGuard } from '@infra/auth/admin-jwt.guard';
import { AdminLogService } from '@infra/admin-log/admin-log.interceptor';
import { AdminLogRepository } from '@infra/admin-log/admin-log.repository';
import { NotifySenderService } from '@infra/notify-sender/notify-sender.service';
import { NotificationRepository } from '@infra/notify-sender/notification.repository';
import { ReportQueueController } from './report-queue.controller';
import { ReportDisposalService } from './report-disposal.service';
import { ReportRepository } from './report.repository';
import { ReportSlaCron } from './report-sla.cron';
import { RiskReviewController } from './risk-review.controller';
import { RiskReviewService } from './risk-review.service';
import { RiskScanCron } from './risk-scan.cron';
import { RiskWarningRepository } from './risk-warning.repository';
import { MerchantReviewController } from './merchant-review.controller';
import { MerchantReviewService } from './merchant-review.service';
import { MerchantReviewRepository } from './merchant-review.repository';
import { MerchantSlaCron } from './merchant-sla.cron';
import { MerchantBanService } from './merchant-ban.service';
import { MerchantBanRepository } from './merchant-ban.repository';

@Module({
  controllers: [ReportQueueController, RiskReviewController, MerchantReviewController],
  providers: [
    PrismaService,
    AdminJwtGuard,
    AdminLogService,
    AdminLogRepository,
    NotifySenderService,
    NotificationRepository,
    // 举报处置
    ReportRepository,
    ReportDisposalService,
    ReportSlaCron,
    // 黄牛预警
    RiskWarningRepository,
    RiskReviewService,
    RiskScanCron,
    // 商家入驻审核
    MerchantReviewRepository,
    MerchantReviewService,
    MerchantSlaCron,
    // 禁入驻三件套（供治理侧处置联动）
    MerchantBanService,
    MerchantBanRepository,
  ],
  exports: [MerchantBanService, ReportDisposalService, RiskReviewService, MerchantReviewService],
})
export class GovernanceModule implements OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly reportSlaCron: ReportSlaCron,
    private readonly riskScanCron: RiskScanCron,
    private readonly merchantSlaCron: MerchantSlaCron,
  ) {}

  /** 统一启动治理 cron（各 cron 内部自查 env 开关，缺省不启动） */
  onModuleInit(): void {
    this.reportSlaCron.start();
    this.riskScanCron.start();
    this.merchantSlaCron.start();
  }

  onModuleDestroy(): void {
    this.reportSlaCron.stop();
    this.riskScanCron.stop();
    this.merchantSlaCron.stop();
  }
}
