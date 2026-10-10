import { Module } from '@nestjs/common';
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { ProductModule } from './modules/product/product.module';
import { WantBuyModule } from './modules/wantbuy/wantbuy.module';
import { ChatModule } from './modules/chat/chat.module';
import { OrderModule } from './modules/order/order.module';
import { ReviewModule } from './modules/review/review.module';
import { ReportModule } from './modules/report/report.module';
import { NotifyModule } from './modules/notify/notify.module';
import { GovernanceModule } from './modules/admin/governance/governance.module';
import { AdminSupportModule } from './modules/admin/support/admin-support.module';
import { HealthController } from './health.controller';
import { UploadsController } from './infra/uploads/uploads.controller';
import { JwtAuthGuard } from '@infra/auth/jwt.guard';
import { PrismaService } from '@infra/prisma.service';

// 业务模块按 docs/design §3.1 划分：auth/user/product/wantbuy/chat/order/
// review/report/notify + admin（governance/support）。
// UploadsController 为 infra 层纯技术设施（图片上传，PIM-C-3），直属根模块注册；
// JwtAuthGuard/PrismaService 为其守卫与依赖，在根模块补 provider。
@Module({
  imports: [
    AuthModule,
    UserModule,
    ProductModule,
    WantBuyModule,
    ChatModule,
    OrderModule,
    ReviewModule,
    ReportModule,
    NotifyModule,
    GovernanceModule,
    AdminSupportModule,
  ],
  controllers: [HealthController, UploadsController],
  providers: [PrismaService, JwtAuthGuard],
})
export class AppModule {}
