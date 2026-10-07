/**
 * @module infra/admin-log（统一留痕切面：admin 写操作与敏感调阅统一入口）
 * @rule CIM-R-34 敏感数据调阅必须留痕（操作人/时间/事由）
 * @table admin_operation_log → PIM-BC-06（§4.27 不可变日志，只增不改不删）
 * @ac PRD N6（隐私保护：调阅留痕记录）/ N9（证据留存：含操作人、时间、事由）
 *
 * AdminLogService.record：admin 侧写操作与敏感调阅的统一留痕入口。
 * 校验口径：action 必填、reason 必填（N6：所有操作必填事由）、operatorId 须可解析为数字。
 */
import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@contract/index';
import { AdminLogRepository } from './admin-log.repository';

/** 业务错误：code 对齐 §5.1 错误码分段 */
export class BusinessError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'BusinessError';
  }
}

/** 敏感调阅动作枚举（@rule CIM-R-34：调阅必须留痕，动作值统一 .access 后缀） */
export const SENSITIVE_ACTIONS = {
  /** 资质材料调阅（卖家/认证资质文件） */
  QUALIFICATION_ACCESS: 'qualification.access',
  /** 实名信息调阅（学号/凭证图等实名数据，须申诉仲裁授权） */
  REALNAME_ACCESS: 'realname.access',
  /** 举报详情调阅（举报证据与处理明细） */
  REPORT_DETAIL_ACCESS: 'report_detail.access',
  /** 聊天记录调阅（纠纷仲裁场景下的站内信记录） */
  CHAT_RECORD_ACCESS: 'chat_record.access',
  /** 订单记录调阅（交易订单明细调阅） */
  ORDER_RECORD_ACCESS: 'order_record.access',
} as const;

export interface AdminLogEntry {
  operatorId: string | number | bigint;
  action: string;
  targetType?: string;
  targetId?: string | number | bigint;
  reason: string;
  detail?: Record<string, unknown>;
  ip?: string;
}

@Injectable()
export class AdminLogService {
  constructor(private readonly repo: AdminLogRepository) {}

  /** 统一留痕写入：校验后落 admin_operation_log（target/ip 可省略 → NULL） */
  async record(entry: AdminLogEntry): Promise<void> {
    if (!entry.action || !entry.action.trim()) {
      throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, 'action 必填');
    }
    // N6：所有操作必填事由
    if (!entry.reason || !entry.reason.trim()) {
      throw new BusinessError(
        ERROR_CODES.PARAM_VALIDATION_FAILED,
        'reason 必填（N6：所有操作必填事由）',
      );
    }
    let adminId: bigint;
    try {
      adminId = BigInt(entry.operatorId);
    } catch {
      throw new BusinessError(
        ERROR_CODES.PARAM_VALIDATION_FAILED,
        'operatorId 须为数字',
      );
    }
    await this.repo.create({
      admin_id: adminId,
      action: entry.action,
      target_type: entry.targetType ?? null,
      target_id: entry.targetId !== undefined ? BigInt(entry.targetId) : null,
      reason: entry.reason,
      detail: entry.detail,
      ip: entry.ip ?? null,
    });
  }
}
