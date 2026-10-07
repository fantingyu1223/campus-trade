/**
 * account.service.ts —— 账号管理业务逻辑（PRD F20/F21 处置封禁、F31 申诉联动、A6）
 *
 * @module PIM-BC-05/06（后台治理子域 admin/governance）
 * @rule CIM-R-22 处置动作联动（封禁即时生效）；N6/N9 操作留痕（操作人/时间/事由必填）
 * @api §5.3 治理分组扩展（accounts，对齐 admin-web/src/api/account.ts）+ @ac F21-AC2
 *   （封禁即时生效、用户收到处置通知并可见 F31 申诉入口）
 *
 * 封禁联动：user.status='banned' 后，JwtAuthGuard 每请求校验 user.status!=='normal'
 * → 1005 拦截（技术方案 §2.6 既有设计，infra/auth/jwt.guard.ts 已实现，无需改 guard）。
 * 留痕口径：ban/unban 均走 AdminLogService.record（reason 必填；空字符串兜底默认事由，
 * 同 school-admin 修复模式 `reason?.trim() ? reason : 默认事由`）。
 * duration_days=-1 表示永久封禁；schema 无封禁截止字段，限期封禁的到期自动解封
 * 未建模（遗留，见交接）。
 */
import { Injectable } from '@nestjs/common';
import { NotificationType } from '@contract/index';
import { ERROR_CODES } from '@contract/error-codes';
import { AdminLogService } from '@infra/admin-log/admin-log.interceptor';
import { NotifySenderService } from '@infra/notify-sender/notify-sender.service';
import {
  AccountRepository,
  toContractStatus,
  type AccountRow,
} from './account.repository';
import { validateAccountListQuery, validateBanBody } from './account.validator';

/** 业务异常载体：code 为契约错误码，全局 BusinessErrorFilter 映射统一包络 */
export class BusinessError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'BusinessError';
  }
}

function serializeAccount(row: AccountRow) {
  return {
    id: String(row.id),
    nickname: row.nickname,
    identity_type: row.identity_type,
    // schema 无信用分字段（F26 未建模），占位 0（偏差已声明）
    credit_score: 0,
    status: toContractStatus(row.status),
    registered_at: row.created_at.toISOString(),
  };
}

@Injectable()
export class AccountService {
  constructor(
    private readonly repo: AccountRepository,
    private readonly adminLog: AdminLogService,
    private readonly notify: NotifySenderService,
  ) {}

  /** GET /admin/v1/accounts 账号检索（keyword/status/role + 分页） */
  async list(rawQuery: unknown) {
    const query = validateAccountListQuery(rawQuery);
    const { list, total } = await this.repo.findPage(query);
    return {
      page: query.page,
      pageSize: query.pageSize,
      total,
      list: list.map(serializeAccount),
    };
  }

  /** GET /admin/v1/accounts/:id 详情：账号信息 + 统计 + ban_info + 操作留痕 */
  async detail(id: bigint) {
    const row = await this.repo.findById(id);
    if (!row) throw new BusinessError(ERROR_CODES.ORDER_STATUS_CONFLICT, '账号不存在');

    const [stats, logs] = await Promise.all([this.repo.stats(id), this.repo.findLogs(id)]);
    const names = await this.repo.findAdminNames([...new Set(logs.map((l) => l.admin_id))]);

    // ban_info：封禁中 → user 字段组 + 最近一条 account.ban 留痕的 duration_days/source
    let banInfo: {
      duration_days: number;
      reason: string;
      source: string;
      banned_at: string;
    } | null = null;
    if (row.status === 'banned') {
      const lastBan = logs.find((l) => l.action === 'account.ban');
      const detail = (lastBan?.detail ?? {}) as { duration_days?: unknown; source?: unknown };
      banInfo = {
        duration_days: typeof detail.duration_days === 'number' ? detail.duration_days : -1,
        reason: row.banned_reason ?? '',
        source: typeof detail.source === 'string' ? detail.source : 'manual',
        banned_at: row.banned_at?.toISOString() ?? '',
      };
    }

    return {
      account: {
        ...serializeAccount(row),
        ban_info: banInfo,
        stats,
        operation_logs: logs.map((log) => ({
          time: log.created_at.toISOString(),
          operator: names.get(String(log.admin_id)) ?? String(log.admin_id),
          action: log.action,
          note: log.reason,
        })),
      },
    };
  }

  /**
   * POST /admin/v1/accounts/:id/ban 封禁（@ac F21-AC2）：状态机守卫 → 回写 →
   * 留痕（reason 兜底）→ 通知用户（处置通知可见 F31 申诉入口）。
   */
  async ban(adminId: string, id: bigint, rawBody: unknown, now = new Date()) {
    const body = validateBanBody(rawBody);
    const row = await this.repo.findById(id);
    if (!row) throw new BusinessError(ERROR_CODES.ORDER_STATUS_CONFLICT, '账号不存在');
    if (row.status === 'banned') {
      throw new BusinessError(ERROR_CODES.ORDER_STATUS_CONFLICT, '账号已处于封禁状态');
    }

    await this.repo.ban(id, body.reason, now);

    // 留痕（N6/N9：reason 必填，空字符串兜底默认事由）
    await this.adminLog.record({
      operatorId: adminId,
      action: 'account.ban',
      targetType: 'user',
      targetId: id,
      reason: body.reason?.trim() ? body.reason : `封禁账号 #${id}`,
      detail: {
        duration_days: body.duration_days,
        source: body.source ?? 'manual',
        nickname: row.nickname,
      },
    });

    // 处置通知（@ac F21-AC2：用户收到处置通知并可见 F31 申诉入口）
    await this.notify.send({
      user_id: id,
      type: NotificationType.REPORT_RESULT,
      title: '你的账号已被封禁',
      payload: { result: 'ban', duration_days: body.duration_days },
    });

    return { account: { status: 'banned' } };
  }

  /** POST /admin/v1/accounts/:id/unban 解封：状态机守卫 → 回写 → 留痕 → 通知 */
  async unban(adminId: string, id: bigint, _now = new Date()) {
    const row = await this.repo.findById(id);
    if (!row) throw new BusinessError(ERROR_CODES.ORDER_STATUS_CONFLICT, '账号不存在');
    if (row.status !== 'banned') {
      throw new BusinessError(ERROR_CODES.ORDER_STATUS_CONFLICT, '账号未在封禁状态');
    }

    await this.repo.unban(id);

    await this.adminLog.record({
      operatorId: adminId,
      action: 'account.unban',
      targetType: 'user',
      targetId: id,
      reason: `解封账号 #${id}`,
      detail: { nickname: row.nickname, before_status: 'banned', after_status: 'normal' },
    });

    await this.notify.send({
      user_id: id,
      type: NotificationType.REPORT_RESULT,
      title: '你的账号已解除封禁',
      payload: { result: 'unban' },
    });

    return { account: { status: 'normal' } };
  }
}
