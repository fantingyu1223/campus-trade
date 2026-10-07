/**
 * health.controller.ts —— 健康检查（无守卫，供负载探测/部署验收）
 *
 * 路由口径：GET /health 直接挂在根路径，不经全局 api/v1 前缀
 * （main.ts 以 setGlobalPrefix exclude 豁免）。
 */
import { Controller, Get } from '@nestjs/common';

@Controller()
export class HealthController {
  @Get('health')
  health(): { status: 'ok'; uptime: number; version: string } {
    return { status: 'ok', uptime: process.uptime(), version: '0.1.0' };
  }
}
