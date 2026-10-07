/**
 * @table identity_verification → PIM-AG-01
 * @table school → PIM-AG-01
 * 身份认证仓储：封装 identity_verification / school 表访问。
 * 查询结果以 Row 视图返回（as unknown as Row）。
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infra/prisma.service';

export interface SchoolRow {
  id: bigint;
  name: string;
  email_suffix: string | null;
  status: string;
  allow_join_application: boolean;
}

export interface VerificationRow {
  id: bigint;
  user_id: bigint;
  school_id: bigint;
  verify_type: string;
  student_no: string | null;
  campus_email: string | null;
  real_name: string | null;
  staff_flag: boolean;
  status: string;
  reject_reason: string | null;
  submitted_at: Date;
  reviewed_at: Date | null;
  reviewer_id: bigint | null;
  valid_until: Date | null;
  major: string | null;
  enrollment_year: number | null;
}

export interface VerificationCreateData {
  user_id: bigint;
  school_id: bigint;
  verify_type: 'student_no' | 'campus_email';
  student_no: string | null;
  campus_email: string | null;
  real_name: string | null;
  staff_flag: boolean;
  major: string | null;
  enrollment_year: number | null;
}

@Injectable()
export class VerificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findSchoolById(id: string): Promise<SchoolRow | null> {
    const row = await this.prisma.school.findUnique({ where: { id: BigInt(id) } });
    return row as unknown as SchoolRow | null;
  }

  /** 用户在某校的唯一认证记录（uk_user_school） */
  async findByUserAndSchool(userId: string, schoolId: string): Promise<VerificationRow | null> {
    const row = await this.prisma.identityVerification.findUnique({
      where: {
        user_id_school_id: { user_id: BigInt(userId), school_id: BigInt(schoolId) },
      },
    });
    return row as unknown as VerificationRow | null;
  }

  /** 用户最近一次提交的认证记录（状态查询用） */
  async findLatestByUser(userId: string): Promise<VerificationRow | null> {
    const row = await this.prisma.identityVerification.findFirst({
      where: { user_id: BigInt(userId) },
      orderBy: { submitted_at: 'desc' },
    });
    return row as unknown as VerificationRow | null;
  }

  async create(data: VerificationCreateData): Promise<VerificationRow> {
    const row = await this.prisma.identityVerification.create({
      data: { ...data, status: 'pending', submitted_at: new Date() },
    });
    return row as unknown as VerificationRow;
  }

  /** rejected 记录覆盖重提：重置回 pending 并清空驳回原因 */
  async resubmit(id: bigint, data: VerificationCreateData): Promise<VerificationRow> {
    const row = await this.prisma.identityVerification.update({
      where: { id },
      data: {
        verify_type: data.verify_type,
        student_no: data.student_no,
        campus_email: data.campus_email,
        real_name: data.real_name,
        staff_flag: data.staff_flag,
        major: data.major,
        enrollment_year: data.enrollment_year,
        status: 'pending',
        reject_reason: null,
        submitted_at: new Date(),
        reviewed_at: null,
        reviewer_id: null,
      },
    });
    return row as unknown as VerificationRow;
  }
}
