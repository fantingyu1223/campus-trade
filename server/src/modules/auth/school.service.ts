/**
 * @module PIM-BC-01
 * @model PIM-AG-01
 * @rule CIM-R-02
 * @api §5.2 #5/#6
 * @ac F36-AC1
 * 高校名单服务：名单查询（只 active）、名单外学校加入申请提交与进度查询。
 * 重复提交口径：同校 pending/approved → 9001 拦截；rejected → 允许再次提交。
 */
import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@contract/error-codes';
import { VerificationStatus } from '@contract/enums';
import { BusinessError } from './auth.service';
import { SchoolRepository } from './school.repository';
import {
  validateSchoolJoinDto,
  validateSchoolListQuery,
} from './school.validator';
import {
  JoinStatusResponse,
  SchoolJoinResponse,
  SchoolListResponse,
} from './dto/school.dto';

@Injectable()
export class SchoolService {
  constructor(private readonly repo: SchoolRepository) {}

  /** @api §5.2 #5 GET /schools：只返回 active 学校，§5.1 分页结构 */
  async list(query: unknown): Promise<SchoolListResponse> {
    const q = validateSchoolListQuery(query);
    const { list, total } = await this.repo.findActiveSchools(q);
    return {
      page: q.page,
      pageSize: q.pageSize,
      total,
      list: list.map((s) => ({
        id: String(s.id),
        name: s.name,
        short_name: s.short_name,
        city: s.city,
      })),
    };
  }

  /** @api §5.2 #6 POST /schools/join：名单外学校加入申请 */
  async submitJoin(uid: string, input: unknown): Promise<SchoolJoinResponse> {
    const dto = validateSchoolJoinDto(input);
    const schoolId = BigInt(dto.school_id);

    const school = await this.repo.findSchoolById(schoolId);
    if (!school) {
      throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, '学校不存在');
    }
    if (school.status === 'active') {
      throw new BusinessError(
        ERROR_CODES.PARAM_VALIDATION_FAILED,
        '该校已支持，无需申请',
      );
    }
    if (!school.allow_join_application) {
      throw new BusinessError(
        ERROR_CODES.SCHOOL_NOT_OPEN,
        '该校暂未开放加入申请',
      );
    }

    const existing = await this.repo.findApplicationByUserAndSchool(
      BigInt(uid),
      schoolId,
    );
    if (existing?.status === VerificationStatus.PENDING) {
      throw new BusinessError(
        ERROR_CODES.PARAM_VALIDATION_FAILED,
        '已有待审核的加入申请，请勿重复提交',
      );
    }
    if (existing?.status === VerificationStatus.APPROVED) {
      throw new BusinessError(
        ERROR_CODES.PARAM_VALIDATION_FAILED,
        '该校加入申请已通过，无需重复提交',
      );
    }

    const created = await this.repo.createApplication({
      user_id: BigInt(uid),
      school_id: schoolId,
      student_no: dto.student_no ?? null,
      proof_image_url: dto.evidence?.[0] ?? null,
      reason: dto.reason ?? null,
      status: VerificationStatus.PENDING,
    });

    return {
      apply_id: String(created.id),
      status: VerificationStatus.PENDING,
      submitted_at: created.submitted_at.toISOString(),
    };
  }

  /** 进度查询：本人申请列表（含 school_name 映射）；无申请 → 空 list */
  async getJoinStatus(uid: string): Promise<JoinStatusResponse> {
    const applications = await this.repo.findApplicationsByUser(BigInt(uid));
    if (applications.length === 0) {
      return { list: [] };
    }
    const schoolIds = [...new Set(applications.map((a) => a.school_id))];
    const schools = await this.repo.findSchoolsByIds(schoolIds);
    const nameMap = new Map(schools.map((s) => [String(s.id), s.name]));

    return {
      list: applications.map((a) => ({
        id: String(a.id),
        school_id: String(a.school_id),
        school_name: nameMap.get(String(a.school_id)) ?? null,
        status: a.status as 'pending' | 'approved' | 'rejected',
        reject_reason: a.reject_reason,
        submitted_at: a.submitted_at.toISOString(),
        reviewed_at: a.reviewed_at ? a.reviewed_at.toISOString() : null,
      })),
    };
  }
}
