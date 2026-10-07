/**
 * merchant-review.service.ts —— 商家入驻审核业务逻辑（T-306）
 * @module PIM-AG-10
 * @rule CIM-R-28 全链路亮标字段由 user.identity_type 派生
 * @rule CIM-R-34 敏感资质调阅必须留痕（N9）
 */
import { Injectable } from '@nestjs/common';
import { AdminLogService } from '@infra/admin-log/admin-log.interceptor';
import { MerchantReviewRepository } from './merchant-review.repository';
import {
  ApproveBody,
  RejectBody,
  validateListQuery,
  validateRejectBody,
} from './dto/merchant-review.dto';

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

/** 驳回冷却期：30 天（与 T-305 提交侧口径一致） */
const COOLDOWN_MS = 30 * 86400000;

function maskNickname(nickname: string | null | undefined): string {
  const n = (nickname ?? '').trim();
  return (n ? n[0] : '?') + '***';
}

function toBigIntId(id: string): bigint {
  try {
    return BigInt(id);
  } catch {
    throw new BusinessError(9001, `非法 id：${id}`);
  }
}

interface ApplicationRow {
  id: bigint;
  user_id: bigint;
  shop_name: string;
  license_image_url: string;
  shop_proof_image_url: string | null;
  contact_phone: string;
  shop_address: string | null;
  status: string;
  reject_reason_code: string | null;
  reject_reason_detail: string | null;
  submitted_at: Date;
  sla_deadline: Date;
  reviewed_at: Date | null;
  cooldown_until: Date | null;
}

@Injectable()
export class MerchantReviewService {
  constructor(
    private readonly repo: MerchantReviewRepository,
    private readonly adminLog: AdminLogService,
  ) {}

  /** 申请列表：默认 pending，按提交时间升序，附 SLA 剩余与申请人脱敏 */
  async list(rawQuery: Record<string, unknown>, now: Date = new Date()) {
    const { status, page, pageSize } = validateListQuery(rawQuery);
    const { items, total } = await this.repo.findPage({ status, page, pageSize });
    const users = await this.repo.findUsersByIds(items.map((r: ApplicationRow) => r.user_id));
    const nicknameMap = new Map<bigint, string>(
      users.map((u: { id: bigint; nickname: string | null }) => [u.id, u.nickname ?? '']),
    );
    const list = (items as ApplicationRow[]).map((r) => ({
      id: r.id,
      shop_name: r.shop_name,
      applicant_masked: maskNickname(nicknameMap.get(r.user_id)),
      status: r.status,
      submitted_at: r.submitted_at.toISOString(),
      sla_deadline: r.sla_deadline.toISOString(),
      sla_remaining_sec: Math.max(0, Math.floor((r.sla_deadline.getTime() - now.getTime()) / 1000)),
      sla_overdue: r.sla_deadline.getTime() <= now.getTime(),
    }));
    return { list, total, page, pageSize };
  }

  /** 申请详情（含资质材料）：调阅即留痕 qualification.access（N9 证据留存） */
  async detail(adminId: string, id: string) {
    const appId = toBigIntId(id);
    const row = (await this.repo.findById(appId)) as ApplicationRow | null;
    if (!row) throw new BusinessError(6002, `入驻申请不存在：#${id}`);
    // N9：资质材料属敏感数据，调阅必须留痕（操作人/时间/事由）
    await this.adminLog.record({
      operatorId: adminId,
      action: 'qualification.access',
      targetType: 'merchant_application',
      targetId: id,
      reason: '调阅商家入驻资质材料 #' + id,
    });
    const now = new Date();
    return {
      id: row.id,
      shop_name: row.shop_name,
      materials: {
        license_image_url: row.license_image_url,
        shop_proof_image_url: row.shop_proof_image_url,
        contact_phone: row.contact_phone,
        shop_address: row.shop_address,
      },
      status: row.status,
      submitted_at: row.submitted_at.toISOString(),
      sla_deadline: row.sla_deadline.toISOString(),
      sla_remaining_sec: Math.max(0, Math.floor((row.sla_deadline.getTime() - now.getTime()) / 1000)),
      sla_overdue: row.sla_deadline.getTime() <= now.getTime(),
      reject_reason_code: row.reject_reason_code,
      reject_reason_detail: row.reject_reason_detail,
      reviewed_at: row.reviewed_at?.toISOString() ?? null,
      cooldown_until: row.cooldown_until?.toISOString() ?? null,
    };
  }

  /** 审核通过：状态迁移 + 回写 user.identity_type=merchant + 留痕 */
  async approve(adminId: string, id: string, body?: ApproveBody) {
    const appId = toBigIntId(id);
    const row = (await this.repo.findById(appId)) as ApplicationRow | null;
    if (!row) throw new BusinessError(6002, `入驻申请不存在：#${id}`);
    if (row.status !== 'pending') {
      throw new BusinessError(4002, `当前状态不可审核：${row.status}`);
    }
    const now = new Date();
    const count = await this.repo.transition(appId, 'pending', {
      status: 'approved',
      reviewed_at: now,
      reviewer_id: BigInt(adminId),
    });
    if (count === 0) throw new BusinessError(4002, '申请已被并发处理');
    // 跨 schema 写入：全链路亮标字段由 identity_type 派生生效 @rule CIM-R-28
    await this.repo.updateUserIdentityType(row.user_id, 'merchant');
    await this.adminLog.record({
      operatorId: adminId,
      action: 'merchant_review.approve',
      targetType: 'merchant_application',
      targetId: id,
      reason: body?.note ?? '通过商家入驻申请 #' + id,
      detail: { shop_name: row.shop_name },
    });
    return {
      id: row.id,
      status: 'approved',
      user_identity_type: 'merchant',
      reviewed_at: now.toISOString(),
    };
  }

  /** 审核驳回：8 枚举理由码 + 30 天冷却 + 留痕 */
  async reject(adminId: string, id: string, body: RejectBody) {
    const { reason_code, detail } = validateRejectBody(body);
    const appId = toBigIntId(id);
    const row = (await this.repo.findById(appId)) as ApplicationRow | null;
    if (!row) throw new BusinessError(6002, `入驻申请不存在：#${id}`);
    if (row.status !== 'pending') {
      throw new BusinessError(4002, `当前状态不可审核：${row.status}`);
    }
    const now = new Date();
    const cooldownUntil = new Date(now.getTime() + COOLDOWN_MS);
    // 冷却期 30 天，与 T-305 提交侧口径一致
    const count = await this.repo.transition(appId, 'pending', {
      status: 'rejected',
      reject_reason_code: reason_code,
      reject_reason_detail: detail,
      reviewed_at: now,
      reviewer_id: BigInt(adminId),
      cooldown_until: cooldownUntil,
    });
    if (count === 0) throw new BusinessError(4002, '申请已被并发处理');
    await this.adminLog.record({
      operatorId: adminId,
      action: 'merchant_review.reject',
      targetType: 'merchant_application',
      targetId: id,
      reason: detail ?? `驳回商家入驻申请 #${id}（${reason_code}）`,
      detail: { shop_name: row.shop_name, reason_code },
    });
    return {
      id: row.id,
      status: 'rejected',
      reject_reason_code: reason_code,
      cooldown_until: cooldownUntil.toISOString(),
    };
  }
}
