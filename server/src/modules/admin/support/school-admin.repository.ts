/**
 * @module PIM-BC-06
 * @table school/school_join_application/admin_operation_log → 无聚合 BC-06 支撑表
 * 后台高校名单配置仓储：只封装 Prisma 访问，不含业务规则。
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infra/prisma.service';
import {
  JoinRequestListQuery,
  SchoolListQuery,
} from './dto/school-admin.dto';

/** school 表行（本模块消费的最小字段集） */
export interface SchoolRow {
  id: bigint;
  name: string;
  short_name: string;
  email_suffix: string | null;
  city: string | null;
  status: string;
  allow_join_application: boolean;
  created_at: Date;
  updated_at: Date;
}

/** school_join_application 表行 */
export interface SchoolJoinApplicationRow {
  id: bigint;
  user_id: bigint;
  school_id: bigint;
  student_no: string | null;
  proof_image_url: string | null;
  reason: string | null;
  status: string;
  reject_reason: string | null;
  submitted_at: Date;
  reviewed_at: Date | null;
  reviewer_id: bigint | null;
}

export interface CreateSchoolData {
  name: string;
  short_name: string;
  email_suffix: string | null;
  city: string | null;
  status: string;
}

export interface CreateLogData {
  admin_id: bigint;
  action: string;
  target_type: string | null;
  target_id: bigint | null;
  reason: string;
  detail?: Record<string, unknown>;
}

@Injectable()
export class SchoolAdminRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** #68 名单分页：keyword 时 OR name/short_name contains；status 可选过滤；id asc */
  async findSchools(query: SchoolListQuery): Promise<{
    list: SchoolRow[];
    total: number;
  }> {
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.keyword) {
      where.OR = [
        { name: { contains: query.keyword } },
        { short_name: { contains: query.keyword } },
      ];
    }
    const [list, total] = await Promise.all([
      this.prisma.school.findMany({
        where,
        orderBy: { id: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }) as Promise<SchoolRow[]>,
      this.prisma.school.count({ where }),
    ]);
    return { list, total };
  }

  /** 在册成员数聚合（identity_verification 按 school_id 分组计数） */
  async countMembersBySchoolIds(
    ids: bigint[],
  ): Promise<{ school_id: bigint; count: number }[]> {
    const rows = await this.prisma.identityVerification.groupBy({
      by: ['school_id'],
      where: { school_id: { in: ids } },
      _count: { _all: true },
    });
    return rows.map((r) => ({
      school_id: r.school_id,
      count: r._count._all,
    }));
  }

  async findSchoolByName(
    name: string,
    excludeId?: bigint,
  ): Promise<SchoolRow | null> {
    return (await this.prisma.school.findFirst({
      where: excludeId === undefined ? { name } : { name, id: { not: excludeId } },
    })) as SchoolRow | null;
  }

  async findSchoolByEmailSuffix(
    emailSuffix: string,
    excludeId?: bigint,
  ): Promise<SchoolRow | null> {
    return (await this.prisma.school.findFirst({
      where:
        excludeId === undefined
          ? { email_suffix: emailSuffix }
          : { email_suffix: emailSuffix, id: { not: excludeId } },
    })) as SchoolRow | null;
  }

  async findSchoolById(id: bigint): Promise<SchoolRow | null> {
    return (await this.prisma.school.findUnique({
      where: { id },
    })) as SchoolRow | null;
  }

  async createSchool(data: CreateSchoolData): Promise<SchoolRow> {
    return (await this.prisma.school.create({
      data: data as unknown as Prisma.SchoolCreateInput,
    })) as SchoolRow;
  }

  async updateSchool(
    id: bigint,
    data: Record<string, unknown>,
  ): Promise<SchoolRow> {
    return (await this.prisma.school.update({
      where: { id },
      data,
    })) as SchoolRow;
  }

  async findApplicationById(
    id: bigint,
  ): Promise<SchoolJoinApplicationRow | null> {
    return (await this.prisma.schoolJoinApplication.findUnique({
      where: { id },
    })) as SchoolJoinApplicationRow | null;
  }

  /** #72 申请分页：status 可选过滤；submitted_at desc */
  async findApplications(query: JoinRequestListQuery): Promise<{
    list: SchoolJoinApplicationRow[];
    total: number;
  }> {
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    const [list, total] = await Promise.all([
      this.prisma.schoolJoinApplication.findMany({
        where,
        orderBy: { submitted_at: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }) as Promise<SchoolJoinApplicationRow[]>,
      this.prisma.schoolJoinApplication.count({ where }),
    ]);
    return { list, total };
  }

  async updateApplication(
    id: bigint,
    data: Record<string, unknown>,
  ): Promise<SchoolJoinApplicationRow> {
    return (await this.prisma.schoolJoinApplication.update({
      where: { id },
      data,
    })) as SchoolJoinApplicationRow;
  }

  /** 后台操作留痕（admin_operation_log 不可变日志，仅 create） */
  async createLog(data: CreateLogData): Promise<void> {
    await this.prisma.adminOperationLog.create({
      data: data as unknown as Prisma.AdminOperationLogCreateInput,
    });
  }

  /** 申请人昵称映射（contact 展示用） */
  async findUsersByIds(
    ids: bigint[],
  ): Promise<{ id: bigint; nickname: string }[]> {
    return (await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, nickname: true },
    })) as { id: bigint; nickname: string }[];
  }
}
