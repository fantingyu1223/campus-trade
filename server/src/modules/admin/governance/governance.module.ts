/**
 * governance.module.ts —— 后台治理模块装配（举报处置 / 黄牛预警 / 商家审核 / 禁入驻三件套）
 *
 * @module PIM-BC-05 信任与治理（后台侧）
 * @api §5.3 #51（后台登录）、#54-56（举报队列/详情/处置）、#65-67（申诉仲裁）、黄牛预警复核（T-304）、商家入驻审核（T-306）
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
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminAuthRepository } from './admin-auth.repository';
import { AppealController } from './appeal.controller';
import { AppealService } from './appeal.service';
import { AppealRepository } from './appeal.repository';
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
import { WordInterceptorService } from '@infra/word-interceptor/word-interceptor.service';
import { InterceptLogRepository } from '@infra/word-interceptor/intercept-log.repository';
import { WordListController } from './word-list.controller';
import { WordListService } from './word-list.service';
import { WordListRepository } from './word-list.repository';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { AccountRepository } from './account.repository';

@Module({
  controllers: [ReportQueueController, RiskReviewController, MerchantReviewController, AdminAuthController, AppealController, WordListController, AccountController],
  providers: [
    PrismaService,
    AdminJwtGuard,
    AdminLogService,
    AdminLogRepository,
    NotifySenderService,
    NotificationRepository,
    // 词表快照拦截器（词表变更后 refresh 生效，§4.24 缓存+变更失效）
    WordInterceptorService,
    InterceptLogRepository,
    // 后台认证（§5.3 #51 登录）
    AdminAuthRepository,
    AdminAuthService,
    // 申诉仲裁（§5.3 #65-67）
    AppealRepository,
    AppealService,
    // 词表配置（§5.3 #82-86 具体化）
    WordListRepository,
    WordListService,
    // 账号管理（A6，F20/F21 处置封禁）
    AccountRepository,
    AccountService,
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
