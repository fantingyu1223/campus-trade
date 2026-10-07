/**
 * @module infra/admin-log
 * @api GET /admin/v1/audit-logs（运营操作/调阅留痕审计查询）
 * @ac N9（证据留存：调阅留痕可审计）
 * 审计查询控制器：类级 AdminJwtGuard；查询参数校验（9001）；
 * 返回包络 {code:0,message:'ok',data:{page,pageSize,total,list}}，BigInt→string。
 */
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ERROR_CODES } from '@contract/index';
import { AdminJwtGuard } from '@infra/auth/admin-jwt.guard';
import { BusinessError } from './admin-log.interceptor';
import {
  AdminLogFilter,
  AdminLogRepository,
} from './admin-log.repository';

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

interface AuditLogQuery {
  operator_id?: string;
  action?: string;
  target_type?: string;
  from?: string;
  to?: string;
  page?: string;
  pageSize?: string;
}

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  field: string,
): number {
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new BusinessError(
      ERROR_CODES.PARAM_VALIDATION_FAILED,
      `${field} 须为正整数`,
    );
  }
  const n = Number(raw);
  if (n < 1) {
    throw new BusinessError(
      ERROR_CODES.PARAM_VALIDATION_FAILED,
      `${field} 须为正整数`,
    );
  }
  return n;
}

function parseDate(raw: string | undefined, field: string): Date | undefined {
  if (raw === undefined) return undefined;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new BusinessError(
      ERROR_CODES.PARAM_VALIDATION_FAILED,
      `${field} 非法日期`,
    );
  }
  return d;
}

@Controller('admin/v1')
@UseGuards(AdminJwtGuard)
export class AdminLogQueryController {
  constructor(private readonly repo: AdminLogRepository) {}

  /** @api GET /admin/v1/audit-logs：操作日志分页审计查询 */
  @Get('audit-logs')
  async list(@Query() query: AuditLogQuery) {
    const q = query ?? {};
    let operatorId: bigint | undefined;
    if (q.operator_id !== undefined) {
      if (!/^\d+$/.test(q.operator_id)) {
        throw new BusinessError(
          ERROR_CODES.PARAM_VALIDATION_FAILED,
          'operator_id 须为数字',
        );
      }
      operatorId = BigInt(q.operator_id);
    }
    const page = parsePositiveInt(q.page, DEFAULT_PAGE, 'page');
    const pageSize = parsePositiveInt(q.pageSize, DEFAULT_PAGE_SIZE, 'pageSize');
    if (pageSize > MAX_PAGE_SIZE) {
      throw new BusinessError(
        ERROR_CODES.PARAM_VALIDATION_FAILED,
        `pageSize 上限 ${MAX_PAGE_SIZE}`,
      );
    }
    const filter: AdminLogFilter = {
      ...(operatorId !== undefined ? { operatorId } : {}),
      ...(q.action !== undefined ? { action: q.action } : {}),
      ...(q.target_type !== undefined ? { targetType: q.target_type } : {}),
      ...(parseDate(q.from, 'from') !== undefined
        ? { timeFrom: parseDate(q.from, 'from') }
        : {}),
      ...(parseDate(q.to, 'to') !== undefined
        ? { timeTo: parseDate(q.to, 'to') }
        : {}),
    };

    const { list, total } = await this.repo.findPage(filter, page, pageSize);
    return {
      code: 0,
      message: 'ok',
      data: {
        page,
        pageSize,
        total,
        list: list.map((row) => ({
          id: String(row.id),
          admin_id: String(row.admin_id),
          action: row.action,
          target_type: row.target_type,
          target_id: row.target_id === null ? null : String(row.target_id),
          reason: row.reason,
          detail: row.detail,
          ip: row.ip,
          created_at: row.created_at.toISOString(),
        })),
      },
    };
  }
}
