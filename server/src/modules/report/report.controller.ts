/**
 * report.controller.ts —— 举报控制器
 *
 * @module PIM-BC-05 举报
 * @rule CIM-R-20 举报人匿名保护（响应绝不含 reporter 身份字段）
 * @api §5.2 #40 POST /reports（统一响应包络 §5.1）+ @ac F18-AC1
 */
import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ERROR_CODES } from '@contract/index';
import { JwtAuthGuard } from '@infra/auth/jwt.guard';
import { BusinessError, ReportService } from './report.service';
import type { SubmitReportResult } from './dto/report.dto';

interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

/** 认证上下文（JWT 载荷写入 req.user；uid 为 string，需转 BigInt） */
interface AuthedRequest {
  user?: { uid?: string; id?: string };
}

/** 登录守卫：uid??id 缺失 → 1001 */
const requireReporter = (req: AuthedRequest): bigint => {
  const uid = req.user?.uid ?? req.user?.id;
  if (!uid) {
    throw new BusinessError(ERROR_CODES.AUTH_TOKEN_INVALID, '未登录或登录已过期');
  }
  return BigInt(uid);
};

@Controller()
@UseGuards(JwtAuthGuard)
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  /** @api §5.2 #40 POST /reports（需登录；响应仅受理回执，匿名保护） */
  @Post('reports')
  async submit(@Body() body: unknown, @Req() req: AuthedRequest): Promise<ApiResponse<SubmitReportResult>> {
    const reporterId = requireReporter(req);
    const data = await this.reportService.submitReport(reporterId, body);
    return { code: 0, message: 'ok', data };
  }
}
