/**
 * @table school/school_join_application
 * 高校名单与名单外加入申请仓储 → 无聚合 BC-06 支撑表（PSM-02-11）。
 * 只封装 Prisma 访问，不含业务规则。
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infra/prisma.service';
import { VerificationStatus } from '@prisma/client';

/** school 表行（本模块消费的最小字段集） */
export interface SchoolRow {
  id: bigint;
  name: string;
  short_name: string;
  city: string | null;
  status: string;
  allow_join_application: boolean;
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
}

export interface CreateApplicationData {
  user_id: bigint;
  school_id: bigint;
  student_no: string | null;
  proof_image_url: string | null;
  reason: string | null;
  status: VerificationStatus;
}

@Injectable()
export class SchoolRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** §5.2 #5：只查 status=active 学校；keyword 时 OR name/short_name contains，id asc 分页 */
  async findActiveSchools(params: {
    keyword?: string;
    page: number;
    pageSize: number;
  }): Promise<{ list: SchoolRow[]; total: number }> {
    const where: Record<string, unknown> = { status: 'active' };
    if (params.keyword) {
      where.OR = [
        { name: { contains: params.keyword } },
        { short_name: { contains: params.keyword } },
      ];
    }
    const [list, total] = await Promise.all([
      this.prisma.school.findMany({
        where,
        orderBy: { id: 'asc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }) as Promise<SchoolRow[]>,
      this.prisma.school.count({ where }),
    ]);
    return { list, total };
  }

  async findSchoolById(id: bigint): Promise<SchoolRow | null> {
    return (await this.prisma.school.findUnique({
      where: { id },
    })) as SchoolRow | null;
  }

  /** 本人对某校最近一次申请（submitted_at desc） */
  async findApplicationByUserAndSchool(
    userId: bigint,
    schoolId: bigint,
  ): Promise<SchoolJoinApplicationRow | null> {
    return (await this.prisma.schoolJoinApplication.findFirst({
      where: { user_id: userId, school_id: schoolId },
      orderBy: { submitted_at: 'desc' },
    })) as SchoolJoinApplicationRow | null;
  }

  async createApplication(
    data: CreateApplicationData,
  ): Promise<SchoolJoinApplicationRow> {
    // schema 要求 submitted_at 必填（无库默认值），由仓储写入当前时间
    return (await this.prisma.schoolJoinApplication.create({
      data: { ...data, submitted_at: new Date() },
    })) as SchoolJoinApplicationRow;
  }

  /** 本人全部申请（submitted_at desc） */
  async findApplicationsByUser(
    userId: bigint,
  ): Promise<SchoolJoinApplicationRow[]> {
    return (await this.prisma.schoolJoinApplication.findMany({
      where: { user_id: userId },
      orderBy: { submitted_at: 'desc' },
    })) as SchoolJoinApplicationRow[];
  }

  async findSchoolsByIds(ids: bigint[]): Promise<SchoolRow[]> {
    return (await this.prisma.school.findMany({
      where: { id: { in: ids } },
    })) as SchoolRow[];
  }
}
