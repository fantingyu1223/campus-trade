/**
 * report-disposal.service.ts —— 举报队列/详情/处置业务逻辑（T-302）
 *
 * @module PIM-BC-05 信任与治理
 * @model PIM-AG-08 举报聚合
 * @rule CIM-R-21/22/23
 * @api §5.3 #54-56
 *
 * 口径：
 * - 读侧绝不外泄 reporter_id（匿名口径 @rule CIM-R-20）；
 * - 对外 status 用契约口径 'done'（DB 枚举 'resolved'，映射在 repository）。
 */
import { Injectable } from '@nestjs/common';
import { NotificationType } from '@contract/index';
import { NotifySenderService } from '@infra/notify-sender/notify-sender.service';
import { ReportRepository, toContractStatus, type ReportRow } from './report.repository';
import {
  DISPOSAL_RESULTS,
  QUEUE_STATUS_FILTERS,
  type DisposalResult,
  type QueueStatusFilter,
} from './dto/disposal.dto';

/** 业务异常载体：code 为契约错误码（9001 参数非法 / 4002 处置冲突） */
export class BusinessError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'BusinessError';
  }
}

const MAX_PAGE_SIZE = 50;

/** SLA 派生字段 */
function withSla(row: ReportRow, now: Date) {
  const deadlineMs = row.sla_deadline.getTime();
  return {
    sla_remaining_sec: Math.max(0, Math.floor((deadlineMs - now.getTime()) / 1000)),
    sla_overdue: deadlineMs <= now.getTime(),
  };
}

@Injectable()
export class ReportDisposalService {
  constructor(
    private readonly repo: ReportRepository,
    private readonly notify: NotifySenderService,
  ) {}

  /** §5.3 #54 举报队列：page/pageSize 校验 + status 过滤 + SLA 派生字段 */
  async getQueue(rawQuery: unknown, now = new Date()) {
    const q = (typeof rawQuery === 'object' && rawQuery !== null ? rawQuery : {}) as Record<
      string,
      unknown
    >;

    let status: QueueStatusFilter | undefined;
    if (q.status !== undefined) {
      if (
        typeof q.status !== 'string' ||
        !(QUEUE_STATUS_FILTERS as readonly string[]).includes(q.status)
      ) {
        throw new BusinessError(9001, 'status 仅支持 pending/processing/done');
      }
      status = q.status as QueueStatusFilter;
    }

    const toPositiveInt = (v: unknown): number | null => {
      if (v === undefined) return null;
      const n = typeof v === 'string' ? Number(v) : v;
      if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) return null;
      return n;
    };

    let page = 1;
    if (q.page !== undefined) {
      const p = toPositiveInt(q.page);
      if (p === null) throw new BusinessError(9001, 'page 须为正整数');
      page = p;
    }
    let pageSize = 20;
    if (q.pageSize !== undefined) {
      const s = toPositiveInt(q.pageSize);
      if (s === null || s > MAX_PAGE_SIZE) {
        throw new BusinessError(9001, `pageSize 须为 1~${MAX_PAGE_SIZE} 的正整数`);
      }
      pageSize = s;
    }

    const { list, total } = await this.repo.findQueue({ status, page, pageSize });
    return {
      page,
      pageSize,
      total,
      list: list.map((row) => ({
        ...this.serializeRow(row),
        ...withSla(row, now),
      })),
    };
  }

  /**
   * §5.3 #55 举报详情：禁止包含 reporter_id 字段（匿名口径 @rule CIM-R-20）；
   * 附 SLA 派生字段与 timeline（created / handled 两节点）。
   */
  async getDetail(id: bigint, now = new Date()) {
    const row = await this.repo.findById(id);
    if (!row) throw new BusinessError(4002, '举报不存在');

    const timeline: Array<{ event: string; at: string }> = [
      { event: 'created', at: row.created_at.toISOString() },
    ];
    if (row.handled_at) {
      timeline.push({ event: 'handled', at: row.handled_at.toISOString() });
    }

    return {
      ...this.serializeRow(row),
      ...withSla(row, now),
      timeline,
    };
  }

  /**
   * §5.3 #56 处置提交：状态机校验 → 回写 report → 按 result 联动 → 通知。
   * @rule CIM-R-22 处置动作联动；@rule CIM-R-23 处置结果通知。
   */
  async action(adminId: string, id: bigint, rawBody: unknown, now = new Date()) {
    const b = (typeof rawBody === 'object' && rawBody !== null ? rawBody : {}) as Record<
      string,
      unknown
    >;

    if (
      typeof b.result !== 'string' ||
      !(DISPOSAL_RESULTS as readonly string[]).includes(b.result)
    ) {
      throw new BusinessError(4002, 'result 非法，仅支持 off_shelf/warning/ban/rejected');
    }
    const result = b.result as DisposalResult;

    if (
      result === 'ban' &&
      (typeof b.duration_days !== 'number' ||
        !Number.isInteger(b.duration_days) ||
        b.duration_days <= 0)
    ) {
      throw new BusinessError(9001, 'result=ban 时 duration_days 必为正整数');
    }

    const report = await this.repo.findById(id);
    if (!report) throw new BusinessError(4002, '举报不存在');
    if (report.status !== 'pending' && report.status !== 'processing') {
      throw new BusinessError(4002, '该举报已处置，不可重复操作');
    }

    await this.repo.updateForDisposal(id, {
      result,
      handledBy: BigInt(adminId),
      handledAt: now,
      handleNote: typeof b.note === 'string' ? b.note : null,
    });

    // 按 result 联动（@rule CIM-R-22）
    if (result === 'off_shelf' && report.target_type === 'product') {
      await this.repo.offShelfProduct(report.target_id);
    } else if (result === 'ban') {
      await this.repo.banUser(
        report.target_id,
        typeof b.note === 'string' ? b.note : '违规封禁',
        now,
      );
    }
    // warning / rejected：无联动动作

    // 通知举报人（payload 不含举报人身份，@rule CIM-R-20/23）
    await this.notify.send({
      user_id: report.reporter_id,
      type: NotificationType.REPORT_RESULT,
      title: '你的举报已处理',
      payload: { report_id: String(report.id), result },
    });

    // 联动对象的二次通知
    if (result === 'off_shelf' && report.target_type === 'product') {
      const product = await this.repo.findProductById(report.target_id);
      if (product) {
        await this.notify.send({
          user_id: product.seller_id,
          type: NotificationType.REPORT_RESULT,
          title: '你的商品已被下架',
          payload: { report_id: String(report.id), result },
        });
      }
    } else if (result === 'ban') {
      await this.notify.send({
        user_id: report.target_id,
        type: NotificationType.REPORT_RESULT,
        title: '你的账号已被封禁',
        payload: { report_id: String(report.id), result },
      });
    }

    return {
      report: { id: String(report.id), status: 'done', result },
    };
  }

  /** 序列化（剥离 reporter_id，对外 status 用契约口径 done） */
  private serializeRow(row: ReportRow) {
    return {
      id: String(row.id),
      target_type: row.target_type,
      target_id: String(row.target_id),
      category: row.category,
      content: row.content,
      evidence_urls: row.evidence_urls,
      status: toContractStatus(row.status),
      result: row.result,
      sla_level: row.sla_level,
      sla_deadline: row.sla_deadline.toISOString(),
      is_timeout: row.is_timeout,
      handled_by: row.handled_by === null ? null : String(row.handled_by),
      handled_at: row.handled_at === null ? null : row.handled_at.toISOString(),
      handle_note: row.handle_note,
      created_at: row.created_at.toISOString(),
    };
  }
}
