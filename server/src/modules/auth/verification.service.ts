/**
 * @module PIM-BC-01
 * @model PIM-AG-01
 * @rule CIM-R-02 / CIM-R-03
 * 身份认证领域服务：三类身份（学生/教职工，教职工沿用学生规则）认证提交与状态查询。
 *
 * 重复提交口径（自定，待契约确认）：
 *  - 已有 pending 记录 → 拒绝（9001「已有待审核的认证申请」）
 *  - 已有 rejected 记录 → 覆盖重提（原记录重置回 pending，清空驳回原因）
 *  - 已有 approved 记录 → 拒绝（9001「已完成认证」）
 */
import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@contract/error-codes';
import { VerificationStatus, VerifyType } from '@contract/enums';
import { BusinessError } from './auth.service';
import {
  VerificationRepository,
  VerificationCreateData,
  VerificationRow,
} from './verification.repository';
import { validateVerifySubmitDto } from './verification.validator';
import {
  VerifyStatusResponse,
  VerifySubmitResponse,
  VerificationStatusView,
} from './dto/verify.dto';

@Injectable()
export class VerificationService {
  constructor(private readonly repo: VerificationRepository) {}

  /**
   * @api §5.2 #3 POST /auth/verify
   * @ac F1-AC1/F1-AC2/F1-AC3
   * 校验入参（9001）→ 学校校验：不存在/非 active → 1006「该校暂不支持，可申请加入」
   * → 校园邮箱通道校验学校邮箱后缀 → 创建 pending 记录（或 rejected 覆盖重提）。
   */
  async submit(uid: string, input: unknown): Promise<VerifySubmitResponse> {
    const dto = validateVerifySubmitDto(input);

    const school = await this.repo.findSchoolById(dto.school_id);
    if (!school || school.status !== 'active') {
      throw new BusinessError(
        ERROR_CODES.SCHOOL_NOT_OPEN,
        '该校暂不支持校园认证，可申请加入',
      );
    }

    if (dto.verify_type === VerifyType.CAMPUS_EMAIL && school.email_suffix) {
      const suffix = school.email_suffix.toLowerCase();
      if (!dto.campus_email!.endsWith(suffix)) {
        throw new BusinessError(
          ERROR_CODES.PARAM_VALIDATION_FAILED,
          `校园邮箱须以 ${suffix} 结尾`,
        );
      }
    }

    const data: VerificationCreateData = {
      user_id: BigInt(uid),
      school_id: BigInt(dto.school_id),
      verify_type: dto.verify_type,
      student_no: dto.student_no ?? null,
      campus_email: dto.campus_email ?? null,
      real_name: dto.real_name ?? null,
      staff_flag: dto.staff_flag ?? false,
      major: dto.major ?? null,
      enrollment_year: dto.enrollment_year ?? null,
    };

    const existing = await this.repo.findByUserAndSchool(uid, dto.school_id);
    let row: VerificationRow;
    if (!existing) {
      row = await this.repo.create(data);
    } else if (existing.status === VerificationStatus.PENDING) {
      throw new BusinessError(
        ERROR_CODES.PARAM_VALIDATION_FAILED,
        '已有待审核的认证申请，请勿重复提交',
      );
    } else if (existing.status === VerificationStatus.REJECTED) {
      row = await this.repo.resubmit(existing.id, data);
    } else {
      throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, '已完成认证，无需重复提交');
    }

    // WX_MOCK 开发联调：提交即自动通过并回写用户身份（staff_flag→staff 否则 student）；
    // 生产流程由后台审核流转 pending→approved/rejected
    if (process.env.WX_MOCK === 'true') {
      await this.repo.approve(row.id);
      await this.repo.updateUserIdentity(
        BigInt(uid),
        data.staff_flag ? 'staff' : 'student',
        data.school_id,
      );
      return {
        id: row.id.toString(),
        status: 'approved',
        submitted_at: row.submitted_at.toISOString(),
      };
    }

    return {
      id: row.id.toString(),
      status: 'pending',
      submitted_at: row.submitted_at.toISOString(),
    };
  }

  /**
   * @api §5.2 #4 GET /auth/verify/status
   * @ac F1
   * 返回当前用户最近一次认证记录状态；从未提交 → none。
   */
  async getStatus(uid: string): Promise<VerifyStatusResponse> {
    const row = await this.repo.findLatestByUser(uid);
    if (!row) {
      return {
        status: 'none',
        verify_type: null,
        school_id: null,
        reject_reason: null,
        submitted_at: null,
      };
    }
    return {
      status: row.status as VerificationStatusView,
      verify_type: row.verify_type as VerifyType,
      school_id: row.school_id.toString(),
      reject_reason: row.reject_reason,
      submitted_at: row.submitted_at.toISOString(),
    };
  }
}
