/**
 * @module PIM-BC-06
 * @rule CIM-R-02
 * @api §5.3 school #68-73
 * @ac F36-AC2
 * 后台高校名单配置服务：名单 CRUD（软删除留痕）与名单外加入申请处理。
 * 处理口径：approve 时学校置 active 且开放 allow_join_application；reject 须填 note 作驳回原因。
 * 所有变更均写 admin_operation_log（变更留痕）。
 */
import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@contract/error-codes';
import {
  JoinRequestListQuery,
  SchoolListQuery,
} from './dto/school-admin.dto';
import {
  SchoolAdminRepository,
  SchoolRow,
} from './school-admin.repository';
import {
  validateHandleJoinDto,
  validateIdParam,
  validateJoinRequestListQuery,
  validateSchoolCreateDto,
  validateSchoolListQuery,
  validateSchoolUpdateDto,
} from './school-admin.validator';

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

function toSchoolDto(s: SchoolRow, memberCount?: number) {
  return {
    id: String(s.id),
    name: s.name,
    short_name: s.short_name,
    email_suffix: s.email_suffix,
    /** 契约字段 domain（邮箱后缀），与 email_suffix 同源输出 */
    domain: s.email_suffix,
    city: s.city,
    status: s.status,
    allow_join_application: s.allow_join_application,
    ...(memberCount === undefined ? {} : { member_count: memberCount }),
  };
}

@Injectable()
export class SchoolAdminService {
  constructor(private readonly repo: SchoolAdminRepository) {}

  /** @api §5.3 #68 GET /admin/v1/schools：名单分页 + member_count 聚合 */
  async list(query: unknown): Promise<{
    page: number;
    pageSize: number;
    total: number;
    list: ReturnType<typeof toSchoolDto>[];
  }> {
    const q: SchoolListQuery = validateSchoolListQuery(query);
    const { list, total } = await this.repo.findSchools(q);

    const countMap = new Map<string, number>();
    if (list.length > 0) {
      const counts = await this.repo.countMembersBySchoolIds(
        list.map((s) => s.id),
      );
      for (const c of counts) {
        countMap.set(String(c.school_id), c.count);
      }
    }
    return {
      page: q.page,
      pageSize: q.pageSize,
      total,
      list: list.map((s) => toSchoolDto(s, countMap.get(String(s.id)) ?? 0)),
    };
  }

  /** @api §5.3 #69 POST /admin/v1/schools：新增学校（默认 active），留痕 school.create */
  async create(adminId: string, input: unknown) {
    const dto = validateSchoolCreateDto(input);

    const dupName = await this.repo.findSchoolByName(dto.name);
    if (dupName) {
      throw new BusinessError(
        ERROR_CODES.PARAM_VALIDATION_FAILED,
        '学校名称已存在',
      );
    }
    if (dto.email_suffix !== undefined) {
      const dupSuffix = await this.repo.findSchoolByEmailSuffix(
        dto.email_suffix,
      );
      if (dupSuffix) {
        throw new BusinessError(
          ERROR_CODES.PARAM_VALIDATION_FAILED,
          '校园邮箱后缀已被占用',
        );
      }
    }

    const created = await this.repo.createSchool({
      name: dto.name,
      short_name: dto.short_name ?? '',
      email_suffix: dto.email_suffix ?? null,
      city: dto.city ?? null,
      status: 'active',
    });

    await this.repo.createLog({
      admin_id: BigInt(adminId),
      action: 'school.create',
      target_type: 'school',
      target_id: created.id,
      reason: dto.remark ?? `新增学校 ${dto.name}`,
      detail: { name: dto.name, email_suffix: dto.email_suffix ?? null },
    });

    return toSchoolDto(created);
  }

  /** @api §5.3 #70 PUT /admin/v1/schools/{id}：修改（排除自身查重），留痕 school.update */
  async update(adminId: string, idParam: string, input: unknown) {
    const id = BigInt(validateIdParam(idParam));
    const dto = validateSchoolUpdateDto(input);

    const school = await this.repo.findSchoolById(id);
    if (!school) {
      throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, '学校不存在');
    }
    if (dto.name !== undefined) {
      const dupName = await this.repo.findSchoolByName(dto.name, id);
      if (dupName) {
        throw new BusinessError(
          ERROR_CODES.PARAM_VALIDATION_FAILED,
          '学校名称已存在',
        );
      }
    }
    if (dto.email_suffix !== undefined) {
      const dupSuffix = await this.repo.findSchoolByEmailSuffix(
        dto.email_suffix,
        id,
      );
      if (dupSuffix) {
        throw new BusinessError(
          ERROR_CODES.PARAM_VALIDATION_FAILED,
          '校园邮箱后缀已被占用',
        );
      }
    }

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.short_name !== undefined) data.short_name = dto.short_name;
    if (dto.email_suffix !== undefined) data.email_suffix = dto.email_suffix;
    if (dto.city !== undefined) data.city = dto.city;

    const updated = await this.repo.updateSchool(id, data);

    await this.repo.createLog({
      admin_id: BigInt(adminId),
      action: 'school.update',
      target_type: 'school',
      target_id: id,
      reason: dto.remark ?? `修改学校 ${school.name}`,
      detail: data,
    });

    return toSchoolDto(updated);
  }

  /** @api §5.3 #71 DELETE /admin/v1/schools/{id}：软删除（status→disabled），留痕 school.disable */
  async disable(
    adminId: string,
    idParam: string,
    input: unknown,
  ): Promise<null> {
    const id = BigInt(validateIdParam(idParam));
    const body = (input ?? {}) as { confirm?: unknown };
    if (body.confirm !== true) {
      throw new BusinessError(
        ERROR_CODES.PARAM_VALIDATION_FAILED,
        '缺少二次确认（confirm=true）',
      );
    }
    const school = await this.repo.findSchoolById(id);
    if (!school) {
      throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, '学校不存在');
    }

    await this.repo.updateSchool(id, { status: 'disabled' });

    await this.repo.createLog({
      admin_id: BigInt(adminId),
      action: 'school.disable',
      target_type: 'school',
      target_id: id,
      reason: `停用学校 ${school.name}`,
      detail: { before_status: school.status, after_status: 'disabled' },
    });

    return null;
  }

  /** @api §5.3 #72 GET /admin/v1/school-join-requests：申请列表 + school_name/contact 映射 */
  async joinRequests(query: unknown): Promise<{
    page: number;
    pageSize: number;
    total: number;
    list: {
      id: string;
      school_id: string;
      school_name: string | null;
      contact: string | null;
      reason: string | null;
      status: string;
      created_at: string;
    }[];
  }> {
    const q: JoinRequestListQuery = validateJoinRequestListQuery(query);
    const { list, total } = await this.repo.findApplications(q);

    const schoolNameMap = new Map<string, string>();
    const nicknameMap = new Map<string, string>();
    if (list.length > 0) {
      const schoolIds = [...new Set(list.map((a) => a.school_id))];
      const schools = await Promise.all(
        schoolIds.map((sid) => this.repo.findSchoolById(sid)),
      );
      for (const s of schools) {
        if (s) schoolNameMap.set(String(s.id), s.name);
      }
      const users = await this.repo.findUsersByIds([
        ...new Set(list.map((a) => a.user_id)),
      ]);
      for (const u of users) {
        nicknameMap.set(String(u.id), u.nickname);
      }
    }

    return {
      page: q.page,
      pageSize: q.pageSize,
      total,
      list: list.map((a) => ({
        id: String(a.id),
        school_id: String(a.school_id),
        school_name: schoolNameMap.get(String(a.school_id)) ?? null,
        contact: nicknameMap.get(String(a.user_id)) ?? null,
        reason: a.reason,
        status: a.status,
        created_at: a.submitted_at.toISOString(),
      })),
    };
  }

  /**
   * @api §5.3 #73 POST /admin/v1/school-join-requests/{id}/handle
   * approve：申请 approved + 学校置 active/开放加入申请，留痕 school_join.approve；
   * reject：申请 rejected + reject_reason=note，留痕 school_join.reject。
   */
  async handleJoin(adminId: string, idParam: string, input: unknown) {
    const id = BigInt(validateIdParam(idParam));
    const dto = validateHandleJoinDto(input);

    const application = await this.repo.findApplicationById(id);
    if (!application || application.status !== 'pending') {
      throw new BusinessError(
        ERROR_CODES.AUDIT_TASK_NOT_FOUND,
        '申请不存在或已被处理',
      );
    }

    const now = new Date();
    if (dto.action === 'approve') {
      const updated = await this.repo.updateApplication(id, {
        status: 'approved',
        reviewed_at: now,
        reviewer_id: BigInt(adminId),
      });
      await this.repo.updateSchool(application.school_id, {
        status: 'active',
        allow_join_application: true,
      });
      await this.repo.createLog({
        admin_id: BigInt(adminId),
        action: 'school_join.approve',
        target_type: 'school_join_application',
        target_id: id,
        reason: dto.note ?? `通过加入申请（school_id=${String(application.school_id)}）`,
        detail: { school_id: String(application.school_id) },
      });
      return { id: String(updated.id), status: updated.status };
    }

    const updated = await this.repo.updateApplication(id, {
      status: 'rejected',
      reject_reason: dto.note as string,
      reviewed_at: now,
      reviewer_id: BigInt(adminId),
    });
    await this.repo.createLog({
      admin_id: BigInt(adminId),
      action: 'school_join.reject',
      target_type: 'school_join_application',
      target_id: id,
      reason: dto.note as string,
      detail: { school_id: String(application.school_id) },
    });
    return { id: String(updated.id), status: updated.status };
  }
}
