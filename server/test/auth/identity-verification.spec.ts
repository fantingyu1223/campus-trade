/**
 * identity-verification.spec.ts —— T-102 三类身份认证提交与状态查询 + 未认证受限拦截
 * （PRD F1-AC1/AC2/AC3；契约 §5.2 auth #3-4；模型 PIM-AG-01；规则 CIM-R-01/02/03）
 *
 * 覆盖验收点：
 *  - AC1 学号通道提交成功：创建 pending 记录，状态查询回写可得
 *  - AC2 校园邮箱通道提交成功：verify_type=campus_email，校验邮箱后缀
 *  - AC3 非本校（school 不存在 / 非 active）提交拒绝 1006「该校暂不支持，可申请加入」
 *  - 教职工（staff_flag=true）沿用学生规则提交成功
 *  - 重复提交口径：已有 pending 记录 → 拒绝（9001）；已有 rejected → 覆盖重提为 pending
 *  - 状态查询：无记录 none；pending/approved/rejected 三态返回
 *  - CIM-R-01 VerifiedGuard：guest 拦截 1004；student/staff/merchant 放行
 *
 * 无真实 MySQL：PrismaService 一律 jest mock。
 */
import { ForbiddenException } from '@nestjs/common';
import {
  ERROR_CODES,
  UserIdentityType,
  VerificationStatus,
  VerifyType,
} from '@contract/index';
import { VerificationController } from '../../src/modules/auth/verification.controller';
import { VerificationService } from '../../src/modules/auth/verification.service';
import { VerificationRepository } from '../../src/modules/auth/verification.repository';
import { validateVerifySubmitDto } from '../../src/modules/auth/verification.validator';
import { BusinessError } from '../../src/modules/auth/auth.service';
import { VerifiedGuard } from '../../src/infra/auth/verified.guard';
import { PrismaService } from '../../src/infra/prisma.service';

// ---------- 测试夹具 ----------

const UID = '1001';

const makeSchool = (over: Record<string, unknown> = {}) => ({
  id: BigInt(10),
  name: '示例大学',
  short_name: '示大',
  email_suffix: '@stu.example.edu.cn',
  city: '北京',
  status: 'active',
  allow_join_application: true,
  ...over,
});

const makeVerification = (over: Record<string, unknown> = {}) => ({
  id: BigInt(500),
  user_id: BigInt(UID),
  school_id: BigInt(10),
  verify_type: VerifyType.STUDENT_NO,
  student_no: '20240001',
  campus_email: null,
  real_name: '张三',
  staff_flag: false,
  status: VerificationStatus.PENDING,
  reject_reason: null,
  submitted_at: new Date('2026-10-06T08:00:00Z'),
  reviewed_at: null,
  reviewer_id: null,
  valid_until: null,
  major: null,
  enrollment_year: 2024,
  ...over,
});

const makePrismaMock = () =>
  ({
    school: { findUnique: jest.fn() },
    identityVerification: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    user: { findUnique: jest.fn() },
  }) as unknown as PrismaService & {
    school: { findUnique: jest.Mock };
    identityVerification: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    user: { findUnique: jest.Mock };
  };

const setup = () => {
  const prisma = makePrismaMock();
  const repo = new VerificationRepository(prisma);
  const service = new VerificationService(repo);
  const controller = new VerificationController(service);
  return { prisma, repo, service, controller };
};

// ---------- §5.2 #3 POST /auth/verify ----------

describe('VerificationService.submit（@api §5.2 #3，@ac F1-AC1/AC2/AC3）', () => {
  it('AC1 学号通道提交成功：创建 pending 记录', async () => {
    const { prisma, service } = setup();
    prisma.school.findUnique.mockResolvedValue(makeSchool());
    prisma.identityVerification.findUnique.mockResolvedValue(null);
    prisma.identityVerification.create.mockResolvedValue(makeVerification());

    const res = await service.submit(UID, {
      school_id: '10',
      verify_type: VerifyType.STUDENT_NO,
      student_no: '20240001',
      real_name: '张三',
    });

    expect(res.status).toBe(VerificationStatus.PENDING);
    expect(res.id).toBe('500');
    const created = prisma.identityVerification.create.mock.calls[0][0].data;
    expect(created.verify_type).toBe(VerifyType.STUDENT_NO);
    expect(created.status).toBe(VerificationStatus.PENDING);
    expect(created.student_no).toBe('20240001');
    expect(created.user_id).toBe(BigInt(UID));
  });

  it('AC2 校园邮箱通道提交成功（后缀匹配 school.email_suffix）', async () => {
    const { prisma, service } = setup();
    prisma.school.findUnique.mockResolvedValue(makeSchool());
    prisma.identityVerification.findUnique.mockResolvedValue(null);
    prisma.identityVerification.create.mockResolvedValue(
      makeVerification({
        verify_type: VerifyType.CAMPUS_EMAIL,
        campus_email: 'zhangsan@stu.example.edu.cn',
        student_no: null,
      }),
    );

    const res = await service.submit(UID, {
      school_id: '10',
      verify_type: VerifyType.CAMPUS_EMAIL,
      campus_email: 'zhangsan@stu.example.edu.cn',
    });

    expect(res.status).toBe(VerificationStatus.PENDING);
    const created = prisma.identityVerification.create.mock.calls[0][0].data;
    expect(created.verify_type).toBe(VerifyType.CAMPUS_EMAIL);
    expect(created.campus_email).toBe('zhangsan@stu.example.edu.cn');
  });

  it('AC2 校园邮箱后缀与学校不匹配 → 9001', async () => {
    const { prisma, service } = setup();
    prisma.school.findUnique.mockResolvedValue(makeSchool());

    await expect(
      service.submit(UID, {
        school_id: '10',
        verify_type: VerifyType.CAMPUS_EMAIL,
        campus_email: 'zhangsan@other.edu.cn',
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.PARAM_VALIDATION_FAILED });
    expect(prisma.identityVerification.create).not.toHaveBeenCalled();
  });

  it('AC3 school 不存在 → 1006 该校暂不支持可申请加入', async () => {
    const { prisma, service } = setup();
    prisma.school.findUnique.mockResolvedValue(null);

    await expect(
      service.submit(UID, {
        school_id: '999',
        verify_type: VerifyType.STUDENT_NO,
        student_no: '20240001',
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.SCHOOL_NOT_OPEN,
      message: expect.stringContaining('可申请加入'),
    });
  });

  it('AC3 school 非 active → 1006', async () => {
    const { prisma, service } = setup();
    prisma.school.findUnique.mockResolvedValue(makeSchool({ status: 'disabled' }));

    await expect(
      service.submit(UID, {
        school_id: '10',
        verify_type: VerifyType.STUDENT_NO,
        student_no: '20240001',
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.SCHOOL_NOT_OPEN });
  });

  it('教职工（staff_flag=true）沿用学生规则：创建 pending 且 staff_flag 落库', async () => {
    const { prisma, service } = setup();
    prisma.school.findUnique.mockResolvedValue(makeSchool());
    prisma.identityVerification.findUnique.mockResolvedValue(null);
    prisma.identityVerification.create.mockResolvedValue(
      makeVerification({ staff_flag: true }),
    );

    const res = await service.submit(UID, {
      school_id: '10',
      verify_type: VerifyType.STUDENT_NO,
      student_no: 'T2024001',
      real_name: '李老师',
      staff_flag: true,
    });

    expect(res.status).toBe(VerificationStatus.PENDING);
    expect(prisma.identityVerification.create.mock.calls[0][0].data.staff_flag).toBe(true);
  });

  it('重复提交口径：已有 pending 记录 → 拒绝 9001，不新建', async () => {
    const { prisma, service } = setup();
    prisma.school.findUnique.mockResolvedValue(makeSchool());
    prisma.identityVerification.findUnique.mockResolvedValue(makeVerification());

    await expect(
      service.submit(UID, {
        school_id: '10',
        verify_type: VerifyType.STUDENT_NO,
        student_no: '20240001',
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.PARAM_VALIDATION_FAILED,
      message: expect.stringContaining('待审核'),
    });
    expect(prisma.identityVerification.create).not.toHaveBeenCalled();
  });

  it('重复提交口径：已有 rejected 记录 → 覆盖重提为 pending', async () => {
    const { prisma, service } = setup();
    prisma.school.findUnique.mockResolvedValue(makeSchool());
    prisma.identityVerification.findUnique.mockResolvedValue(
      makeVerification({
        status: VerificationStatus.REJECTED,
        reject_reason: '学号与姓名不匹配',
      }),
    );
    prisma.identityVerification.update.mockResolvedValue(
      makeVerification({ status: VerificationStatus.PENDING, reject_reason: null }),
    );

    const res = await service.submit(UID, {
      school_id: '10',
      verify_type: VerifyType.STUDENT_NO,
      student_no: '20240001',
      real_name: '张三',
    });

    expect(res.status).toBe(VerificationStatus.PENDING);
    const updated = prisma.identityVerification.update.mock.calls[0][0];
    expect(updated.data.status).toBe(VerificationStatus.PENDING);
    expect(updated.data.reject_reason).toBeNull();
    expect(prisma.identityVerification.create).not.toHaveBeenCalled();
  });
});

// ---------- §5.2 #4 GET /auth/verify/status ----------

describe('VerificationService.getStatus（@api §5.2 #4，@ac F1）', () => {
  it.each([
    [VerificationStatus.PENDING],
    [VerificationStatus.APPROVED],
    [VerificationStatus.REJECTED],
  ])('有记录时返回对应状态 %s', async (status) => {
    const { prisma, service } = setup();
    prisma.identityVerification.findFirst.mockResolvedValue(
      makeVerification({ status, reject_reason: status === VerificationStatus.REJECTED ? '原因' : null }),
    );

    const res = await service.getStatus(UID);
    expect(res.status).toBe(status);
    expect(res.school_id).toBe('10');
    if (status === VerificationStatus.REJECTED) {
      expect(res.reject_reason).toBe('原因');
    }
  });

  it('无记录返回 none', async () => {
    const { prisma, service } = setup();
    prisma.identityVerification.findFirst.mockResolvedValue(null);

    const res = await service.getStatus(UID);
    expect(res.status).toBe('none');
    expect(res.reject_reason).toBeNull();
  });

  it('提交后回写状态查询可得（pending）', async () => {
    const { prisma, service } = setup();
    prisma.school.findUnique.mockResolvedValue(makeSchool());
    prisma.identityVerification.findUnique.mockResolvedValue(null);
    const row = makeVerification();
    prisma.identityVerification.create.mockResolvedValue(row);
    await service.submit(UID, {
      school_id: '10',
      verify_type: VerifyType.STUDENT_NO,
      student_no: '20240001',
    });
    prisma.identityVerification.findFirst.mockResolvedValue(row);

    const res = await service.getStatus(UID);
    expect(res.status).toBe(VerificationStatus.PENDING);
  });
});

// ---------- controller 包装 ----------

describe('VerificationController（@api §5.2 #3/#4）', () => {
  it('POST /auth/verify 返回 {code:0,data}', async () => {
    const { prisma, controller } = setup();
    prisma.school.findUnique.mockResolvedValue(makeSchool());
    prisma.identityVerification.findUnique.mockResolvedValue(null);
    prisma.identityVerification.create.mockResolvedValue(makeVerification());

    const res = await controller.submit({ user: { uid: UID } } as never, {
      school_id: '10',
      verify_type: VerifyType.STUDENT_NO,
      student_no: '20240001',
    });
    expect(res.code).toBe(0);
    expect(res.data.status).toBe(VerificationStatus.PENDING);
  });

  it('GET /auth/verify/status 返回 {code:0,data}', async () => {
    const { prisma, controller } = setup();
    prisma.identityVerification.findFirst.mockResolvedValue(null);
    const res = await controller.status({ user: { uid: UID } } as never);
    expect(res.code).toBe(0);
    expect(res.data.status).toBe('none');
  });
});

// ---------- 入参校验 ----------

describe('validateVerifySubmitDto', () => {
  it('school_id 缺失 → 9001', () => {
    expect(() =>
      validateVerifySubmitDto({ verify_type: VerifyType.STUDENT_NO, student_no: '1' }),
    ).toThrow(BusinessError);
  });

  it('verify_type 非法 → 9001', () => {
    expect(() =>
      validateVerifySubmitDto({ school_id: '10', verify_type: 'id_card' }),
    ).toThrow(BusinessError);
  });

  it('student_no 通道缺学号 → 9001', () => {
    expect(() =>
      validateVerifySubmitDto({ school_id: '10', verify_type: VerifyType.STUDENT_NO }),
    ).toThrow(BusinessError);
  });

  it('campus_email 通道缺邮箱或格式非法 → 9001', () => {
    expect(() =>
      validateVerifySubmitDto({ school_id: '10', verify_type: VerifyType.CAMPUS_EMAIL }),
    ).toThrow(BusinessError);
    expect(() =>
      validateVerifySubmitDto({
        school_id: '10',
        verify_type: VerifyType.CAMPUS_EMAIL,
        campus_email: 'not-an-email',
      }),
    ).toThrow(BusinessError);
  });

  it('staff_flag 非布尔 → 9001', () => {
    expect(() =>
      validateVerifySubmitDto({
        school_id: '10',
        verify_type: VerifyType.STUDENT_NO,
        student_no: '1',
        staff_flag: 'yes',
      }),
    ).toThrow(BusinessError);
  });
});

// ---------- CIM-R-01 VerifiedGuard ----------

describe('VerifiedGuard（@rule CIM-R-01 未认证受限操作拦截）', () => {
  const makeContext = (user: unknown) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as never;

  it('guest 身份 → 拒绝 code 1004', async () => {
    const prisma = makePrismaMock();
    prisma.user.findUnique.mockResolvedValue({
      identity_type: UserIdentityType.GUEST,
    });
    const guard = new VerifiedGuard(prisma);

    await expect(guard.canActivate(makeContext({ uid: UID }))).rejects.toMatchObject({
      response: { code: ERROR_CODES.NOT_VERIFIED },
    });
    expect.assertions(1);
  });

  it.each([[UserIdentityType.STUDENT], [UserIdentityType.STAFF], [UserIdentityType.MERCHANT]])(
    '%s 身份 → 放行',
    async (identity) => {
      const prisma = makePrismaMock();
      prisma.user.findUnique.mockResolvedValue({ identity_type: identity });
      const guard = new VerifiedGuard(prisma);

      await expect(guard.canActivate(makeContext({ uid: UID }))).resolves.toBe(true);
    },
  );

  it('未登录（无 req.user）→ 1001', async () => {
    const prisma = makePrismaMock();
    const guard = new VerifiedGuard(prisma);
    await expect(guard.canActivate(makeContext(undefined))).rejects.toMatchObject({
      response: { code: ERROR_CODES.AUTH_TOKEN_INVALID },
    });
  });

  it('用户不存在视为 guest → 1004', async () => {
    const prisma = makePrismaMock();
    prisma.user.findUnique.mockResolvedValue(null);
    const guard = new VerifiedGuard(prisma);
    await expect(guard.canActivate(makeContext({ uid: UID }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
