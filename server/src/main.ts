import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { RequestMethod } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { BusinessErrorFilter } from './infra/http/business-error.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // BusinessError 全局包络（code/message/data），HttpException 按原生语义透传
  app.useGlobalFilters(new BusinessErrorFilter());
  // 本地开发便利：放开 CORS（admin-web dev 直连场景；生产由网关收口）
  app.enableCors();
  // COS 未开通前的图片本地占位：/static/* → server/public/*（决策见 docs/meeting）
  app.useStaticAssets(join(__dirname, '..', 'public'), { prefix: '/static/' });
  // 全局前缀口径：业务控制器 path 不含前缀（auth/orders/products 等），统一加 api/v1；
  // admin 控制器自带 'admin/v1' 前缀（契约 §5.3）与 /health 探测端点豁免全局前缀，
  // 避免叠加成 /api/v1/admin/v1/*。
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'health', method: RequestMethod.ALL },
      // 注意：本项目 path-to-regexp 为 3.x，通配写法是 (.*)（非 *path），
      // 且 (.*) 不匹配零段路径，控制器基路径 'admin/v1' 须单独豁免
      { path: 'admin/v1', method: RequestMethod.ALL },
      { path: 'admin/v1/(.*)', method: RequestMethod.ALL },
    ],
  });
  await app.listen(Number(process.env.PORT ?? 3000));
}

void bootstrap();
