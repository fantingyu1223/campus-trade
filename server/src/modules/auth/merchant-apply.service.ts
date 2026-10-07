/**
 * @module PIM-BC-01
 * @model PIM-AG-10
 * @statemachine PIM-SM-04 商家入驻申请状态机（提交侧迁移：→pending）
 * @rule CIM-R-25 入驻申请提交守卫（字段完整性 / 已是商家拦截 / pending 重复拦截）
 * @rule CIM-R-26 驳回冷却守卫（最近一次 rejected 且 reviewed_at+30 天>now 拦截）
 * 商家入驻申请领域服务（F32 提交侧）：提交申请、我的申请状态、冷却期查询。
 *
 * 口径说明（任务 T-305 暂定口径 PIM-C-4）：
 *  - 冷却期：驳回后 30 天，自审核完成时刻 reviewed_at 起算（reviewed_at+30 天>now 拦截，
 *    错误携带 cooldown_until）。与 PRD F32 正文「7 天冷却」不一致，按任务口径实现并注明。
 *  - SLA：sla_deadline = submitted_at + 2 天（MVP 简化口径，未跳过周末/法定节假日；
 *    PRD §7.2 第 9 条「跳过周末与法定节假日」留给 T-306 审核侧精确计时）。
 */
import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@contract/error-codes';
import { MerchantApplicationStatus } from '@contract/enums';
import { BusinessError } from './auth.service';
import {
  MerchantApplicationRow,
  MerchantApplyRepository,
} from './merchant-apply.repository';
import { validateMerchantApplyDto } from './merchant-apply.validator';
import {
  MerchantApplyResponse,
  MerchantApplyStatusResponse,
  MerchantApplyStatusView,
  MerchantCooldownResponse,
} from './dto/merchant-apply.dto';

const DAY_MS = 24 * 3600 * 1000;
/** @rule CIM-R-26 驳回冷却时长（天），自 reviewed_at 起算 */
const COOLDOWN_DAYS = 30;
/** SLA 时长（天）：MVP 简化口径，submitted_at 直接 +2 天 */
const SLA_DAYS = 2;

/** @rule CIM-R-26 冷却期拦截错误：携带 cooldown_until（ISO 字符串）供前端展示 */
export class MerchantCooldownError extends BusinessError {
  constructor(public readonly cooldown_until: string) {
    super(ERROR_CODES.PARAM_VALIDATION_FAILED, `驳回后冷却期内不可重新提交，冷却截止 ${cooldown_until}`);
    this.name = 'MerchantCooldownError';
  }
}

/** 派生冷却截止：rejected 且有 reviewed_at → reviewed_at + 30 天，否则 null */
function deriveCooldownUntil(row: MerchantApplicationRow): Date | null {
  if (row.status !== MerchantApplicationStatus.REJECTED || !row.reviewed_at) {
    return null;
  }
  return new Date(row.reviewed_at.getTime() + COOLDOWN_DAYS * DAY_MS);
}

@Injectable()
export class MerchantApplyService {
  constructor(private readonly repo: MerchantApplyRepository) {}

  /**
   * @api §5.2 #7 POST /merchant/apply
   * @ac F32-AC1
   * @rule CIM-R-23 黑名单前置校验（禁入驻名单命中拦截，先于用户身份校验）
   * 校验入参（9001）→ 黑名单前置校验（9001）→ 用户存在（1001）→ 已是商家拦截（9001）
   * → pending 重复拦截（9001）→ 冷却期拦截（9001 带 cooldown_until）
   * → 创建 pending 记录（sla_deadline = submitted_at + 2 天）。
   */
  async apply(uid: string, input: unknown): Promise<MerchantApplyResponse> {
    const dto = validateMerchantApplyDto(input);

    // @rule CIM-R-23 三件套后续拦截：user_id 或 contact_phone 命中 active 禁入驻名单 → 9001
    // 自含直查 auth schema 的 merchant_ban_list（治理侧 MerchantBanService 负责写入）
    const banned =
      (await this.repo.findActiveBanByUser(uid)) ??
      (await this.repo.findActiveBanByPhone(dto.contact_phone));
    if (banned) {
      throw new BusinessError(
        ERROR_CODES.PARAM_VALIDATION_FAILED,
        '该主体在禁入驻名单内，禁止入驻',
      );
    }

    const user = await this.repo.findUserIdentity(uid);
    if (!user) {
      throw new BusinessError(1001, '用户不存在');
    }
    if (user.identity_type === 'merchant') {
      throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, '已是认证商家，无需重复申请');
    }

    const latest = await this.repo.findLatestByUser(uid);
    if (latest) {
      if (latest.status === MerchantApplicationStatus.PENDING) {
        throw new BusinessError(
          ERROR_CODES.PARAM_VALIDATION_FAILED,
          '已有待审核的入驻申请，请勿重复提交',
        );
      }
      // @rule CIM-R-26：最近一次 rejected 且冷却未过期 → 拦截
      const cooldownUntil = deriveCooldownUntil(latest);
      if (cooldownUntil && cooldownUntil.getTime() > Date.now()) {
        throw new MerchantCooldownError(cooldownUntil.toISOString());
      }
    }

    const submittedAt = new Date();
    const row = await this.repo.create({
      user_id: BigInt(uid),
      shop_name: dto.shop_name,
      license_image_url: dto.license_image_url,
      shop_proof_image_url: dto.shop_proof_image_url ?? null,
      contact_phone: dto.contact_phone,
      shop_address: dto.shop_address ?? null,
      submitted_at: submittedAt,
      sla_deadline: new Date(submittedAt.getTime() + SLA_DAYS * DAY_MS),
    });

    return {
      id: row.id.toString(),
      status: 'pending',
      submitted_at: row.submitted_at.toISOString(),
      sla_deadline: row.sla_deadline.toISOString(),
    };
  }

  /**
   * @api §5.2 #8 GET /merchant/apply/status
   * @ac F32-AC1
   * 返回当前用户最近一条入驻申请（含驳回理由与派生 cooldown_until）；从未提交 → none。
   */
  async getStatus(uid: string): Promise<MerchantApplyStatusResponse> {
    const row = await this.repo.findLatestByUser(uid);
    if (!row) {
      return {
        status: 'none',
        reject_reason_code: null,
        reject_reason_detail: null,
        submitted_at: null,
        reviewed_at: null,
        cooldown_until: null,
      };
    }
    const cooldownUntil = deriveCooldownUntil(row);
    return {
      status: row.status as MerchantApplyStatusView,
      reject_reason_code: row.reject_reason_code,
      reject_reason_detail: row.reject_reason_detail,
      submitted_at: row.submitted_at.toISOString(),
      reviewed_at: row.reviewed_at ? row.reviewed_at.toISOString() : null,
      cooldown_until: cooldownUntil ? cooldownUntil.toISOString() : null,
    };
  }

  /**
   * @api §5.2 #9 GET /merchant/apply/cooldown
   * @ac F32-AC1
   * 冷却期查询：最近一次 rejected 且冷却未过期 → 返回 cooldown_until，否则 null。
   */
  async getCooldown(uid: string): Promise<MerchantCooldownResponse> {
    const row = await this.repo.findLatestByUser(uid);
    const cooldownUntil = row ? deriveCooldownUntil(row) : null;
    return {
      cooldown_until:
        cooldownUntil && cooldownUntil.getTime() > Date.now()
          ? cooldownUntil.toISOString()
          : null,
    };
  }
}
