/**
 * report.service.ts —— 举报提交核心服务（T-301）
 *
 * @module PIM-BC-05 举报
 * @model PIM-AG-08 举报聚合
 * @rule CIM-R-20 举报人匿名保护：reporter_id 落库但响应与后续读侧绝不含举报人身份字段
 * @rule EV-13 防刷：同举报人同对象（target_type+target_id）24h 内限 1 次（命中 9002）
 * @table report → PIM-AG-08
 * @api §5.2 #40 POST /reports + @ac F18-AC1（提交进入运营队列，受理回执 report_id+status）
 *
 * SLA 口径（§4.21，为 T-302 处置队列铺垫）：
 *   fraud→urgent(4h) / prohibited→high(24h) / false_desc、other→normal(48h)；
 *   sla_deadline = now + 对应小时数，随单落库。
 */
import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@contract/index';
import { ReportRepository } from './report.repository';
import { validateSubmitReport } from './report.validator';
import type { ReportTargetType, SlaLevel, SubmitReportResult } from './dto/report.dto';

/** 业务错误（模块自含；统一异常过滤器据此映射 code/message 包络） */
export class BusinessError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'BusinessError';
  }
}

/** @rule EV-13：防刷窗口 24h 毫秒数 */
const ANTI_SPAM_WINDOW_MS = 24 * 3600 * 1000;

/** SLA 分级 → 时限小时数（§4.21：urgent 4h / high 24h / normal 48h） */
const SLA_HOURS: Record<SlaLevel, number> = { urgent: 4, high: 24, normal: 48 };

/** category → sla_level 映射（fraud→urgent、prohibited→high、其他→normal） */
const CATEGORY_SLA: Record<string, SlaLevel> = {
  fraud: 'urgent',
  prohibited: 'high',
  false_desc: 'normal',
  other: 'normal',
};

@Injectable()
export class ReportService {
  constructor(private readonly repo: ReportRepository) {}

  /** 目标存在性校验：按 target_type 分表查询，查无 → 9001 */
  private async ensureTargetExists(targetType: ReportTargetType, targetId: bigint): Promise<void> {
    const found = await (() => {
      switch (targetType) {
        case 'product':
          return this.repo.findProductById(targetId);
        case 'user':
          return this.repo.findUserById(targetId);
        case 'order':
          return this.repo.findOrderById(targetId);
        case 'want_buy':
          return this.repo.findWantBuyById(targetId);
        case 'message':
          return this.repo.findMessageById(targetId);
      }
    })();
    if (!found) {
      throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, '举报对象不存在');
    }
  }

  /**
   * @api §5.2 #40 提交举报
   * 链路口径：validator（9001 前置）→ 目标存在性（9001）→ 24h 防刷（9002）
   * → SLA 分级与 deadline 派生 → 落库（status=pending，reporter_id 仅平台侧留存）。
   * @rule CIM-R-20：响应仅 { report_id, status }，绝不含 reporter 身份字段。
   */
  async submitReport(reporterId: bigint, raw: unknown, now = new Date()): Promise<SubmitReportResult> {
    const input = validateSubmitReport(raw);

    await this.ensureTargetExists(input.targetType, input.targetId);

    // EV-13：同举报人同对象 24h 内限 1 次
    const recent = await this.repo.findRecentReport(
      reporterId,
      input.targetType,
      input.targetId,
      new Date(now.getTime() - ANTI_SPAM_WINDOW_MS),
    );
    if (recent) {
      throw new BusinessError(ERROR_CODES.RATE_LIMITED, '24 小时内已举报过该对象，请勿重复提交');
    }

    const slaLevel = CATEGORY_SLA[input.category];
    const slaDeadline = new Date(now.getTime() + SLA_HOURS[slaLevel] * 3600 * 1000);

    const report = await this.repo.createReport({
      reporterId,
      targetType: input.targetType,
      targetId: input.targetId,
      category: input.category,
      content: input.content,
      evidenceUrls: input.evidenceUrls,
      slaLevel,
      slaDeadline,
    });

    // CIM-R-20 匿名保护：仅返回受理回执，剥离 reporter_id 及一切举报人身份字段
    return { report_id: report.id.toString(), status: 'pending' };
  }
}
