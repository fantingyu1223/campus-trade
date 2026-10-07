/**
 * risk-review.service.ts —— 黄牛预警复核（列表 + 确认/忽略）（T-304）
 * @module PIM-BC-05
 * @rule CIM-R-36
 */
import { Injectable } from '@nestjs/common';
import { RiskWarningRepository, RiskRuleCode } from './risk-warning.repository';
import { ReviewRequest, ReviewResponse, maskUserId } from './dto/risk.dto';

export class BusinessError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'BusinessError';
  }
}

const RULE_CODES: RiskRuleCode[] = ['daily_ge5', 'cross_ge3_cat', 'suspected_merchant'];

function toPositiveInt(v: unknown, dft: number): number {
  const n = Number(v ?? dft);
  return Number.isInteger(n) && n > 0 ? n : -1;
}

@Injectable()
export class RiskReviewService {
  constructor(private readonly repo: RiskWarningRepository) {}

  async list(rawQuery: Record<string, unknown>) {
    const status = (rawQuery.status as string) ?? 'pending';
    if (status !== 'pending' && status !== 'handled') {
      throw new BusinessError(9001, 'status 仅支持 pending/handled');
    }
    const ruleCode = rawQuery.rule_code as string | undefined;
    if (ruleCode !== undefined && !RULE_CODES.includes(ruleCode as RiskRuleCode)) {
      throw new BusinessError(9001, 'rule_code 非法');
    }
    const page = toPositiveInt(rawQuery.page, 1);
    const pageSize = toPositiveInt(rawQuery.pageSize, 20);
    if (page < 1 || pageSize < 1 || pageSize > 50) {
      throw new BusinessError(9001, '分页参数非法');
    }

    const { list, total } = await this.repo.findWarnings({
      status,
      ruleCode: ruleCode as RiskRuleCode | undefined,
      page,
      pageSize,
    });
    return {
      total,
      page,
      pageSize,
      list: list.map((w) => ({ ...w, user_masked: maskUserId(w.user_id) })),
    };
  }

  async review(adminId: string, id: string, body: ReviewRequest): Promise<ReviewResponse> {
    if (!/^\d+$/.test(String(id))) throw new BusinessError(9001, 'id 非法');
    const conclusion = body?.conclusion;
    if (conclusion !== 'confirm' && conclusion !== 'ignore') {
      throw new BusinessError(9001, 'conclusion 仅支持 confirm/ignore');
    }
    const actionDetail = body?.action_detail;
    if (actionDetail !== undefined && actionDetail !== 'warning' && actionDetail !== 'ban') {
      throw new BusinessError(9001, 'action_detail 仅支持 warning/ban');
    }

    const warning = await this.repo.findById(BigInt(id));
    if (!warning || warning.status !== 'pending') {
      throw new BusinessError(4002, '预警不存在或已处理');
    }

    const baseNote = body.handle_note ?? body.note ?? null;
    let handleNote: string | null;
    if (actionDetail) {
      handleNote = `转处置（${actionDetail}) ` + (baseNote ?? '');
    } else if (conclusion === 'confirm' && !baseNote) {
      handleNote = '确认风险，转商家入驻核查线索';
    } else {
      handleNote = baseNote;
    }

    const updateData = {
      status: conclusion === 'confirm' ? 'confirmed' : 'false_alarm',
      handled_by: BigInt(adminId),
      handled_at: new Date(),
      handle_note: handleNote,
    };
    await this.repo.markReviewed(warning.id, updateData);

    return { warning: { id: String(warning.id), status: 'handled', conclusion } };
  }
}
