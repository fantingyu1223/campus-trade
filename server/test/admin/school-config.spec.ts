/**
 * school-config.spec.ts —— T-104 后台高校名单配置（管理侧）
 * （PRD F36-AC2；契约 §5.3 school #68-73；模块 PIM-BC-06；规则 CIM-R-02；
 *  表 school/school_join_application/admin_operation_log → 无聚合 BC-06 支撑表）
 *
 * 覆盖验收点：
 *  - AdminJwtGuard：无/非 Bearer → 1001；过期 → 1002；签名错 → 1001；
 *    admin_id 缺失 → 1001；role∉{admin,auditor} → 6001；双角色放行并挂载 req.admin
 *  - #69 POST /admin/v1/schools：创建成功 status=active + 写 log(school.create)；重名 9001
 *  - #70 PUT：更新成功；学校不存在 9001
 *  - #71 DELETE：confirm=true 置 disabled + 留痕(school.disable)；confirm 缺失 9001
 *  - #68 GET 列表：member_count 由 identity_verification 聚合映射；空列表跳过 groupBy
 *  - #72 GET 申请列表：school_name + contact(用户 nickname) 映射
 *  - #73 handle：approve 全联动（申请 approved + 学校 active/allow_join_application + log）；
 *    reject 写 reject_reason=note；非 pending → 6002；申请不存在 → 6002
 *  - validator 分支覆盖；controller 返回包络 {code:0,message:'ok',data} + guard 元数据
 *
 * 无真实 MySQL：PrismaService 一律 jest mock。
 */
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ERROR_CODES } from '@contract/index';
import {
  AdminJwtGuard,
} from '../../src/infra/auth/admin-jwt.guard';
import { signToken } from '../../src/infra/auth/jwt.guard';
import { SchoolAdminController } from '../../src/modules/admin/support/school-admin.controller';
import {
  BusinessError,
  SchoolAdminService,
} from '../../src/modules/admin/support/school-admin.service';
import { SchoolAdminRepository } from '../../src/modules/admin/support/school-admin.repository';
import {
  validateHandleJoinDto,
  validateIdParam,
  validateJoinRequestListQuery,
  validateSchoolCreateDto,
  validateSchoolListQuery,
  validateSchoolUpdateDto,
} from '../../src/modules/admin/support/school-admin.validator';
import { PrismaService } from '../../src/infra/prisma.service';

// ---------- 测试夹具 ----------

const ADMIN_ID = '9001';

const makeSchool = (over: Record<string, unknown> = {}) => ({
  id: BigInt(10),
  name: '示例大学',
  short_name: '示大',
  email_suffix: '@stu.example.edu.cn',
  city: '北京',
  status: 'active',
  allow_join_application: false,
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-01T00:00:00Z'),
  ...over,
});

const makeApplication = (over: Record<string, unknown> = {}) => ({
  id: BigInt(700),
  user_id: BigInt(1001),
  school_id: BigInt(20),
  student_no: '20240001',
  proof_image_url: 'https://cdn.example.com/proof.jpg',
  reason: '希望开通本校',
  status: 'pending',
  reject_reason: null,
  submitted_at: new Date('2026-10-01T08:00:00Z'),
  reviewed_at: null,
  reviewer_id: null,
  ...over,
});

interface PrismaMock {
  school: {
    findMany: jest.Mock;
    count: jest.Mock;
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  identityVerification: {
    groupBy: jest.Mock;
  };
  schoolJoinApplication: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
    update: jest.Mock;
  };
  adminOperationLog: {
    create: jest.Mock;
  };
  user: {
    findMany: jest.Mock;
  };
}

const makePrismaMock = (): PrismaMock => ({
  school: {
    findMany: jest.fn(),
    count: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  identityVerification: {
    groupBy: jest.fn(),
  },
  schoolJoinApplication: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  },
  adminOperationLog: {
    create: jest.fn(),
  },
  user: {
    findMany: jest.fn(),
  },
});

const setup = () => {
  const prisma = makePrismaMock();
  const repo = new SchoolAdminRepository(prisma as unknown as PrismaService);
  const service = new SchoolAdminService(repo);
  const controller = new SchoolAdminController(service);
  return { prisma, repo, service, controller };
};

/** 断言同步函数抛出指定 code 的 BusinessError */
const expectBizError = (fn: () => unknown, code: number): void => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(BusinessError);
    expect((e as BusinessError).code).toBe(code);
    return;
  }
  throw new Error(`expected BusinessError(code=${code}) but nothing was thrown`);
};

const mockHttpContext = (authorization?: string) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization } }),
    }),
  }) as never;

// ---------- AdminJwtGuard ----------

describe('AdminJwtGuard（§5.3 后台认证守卫）', () => {
  const guard = new AdminJwtGuard();

  it('无 Authorization 头 → 1001', async () => {
    await expect(guard.canActivate(mockHttpContext())).rejects.toMatchObject({
      response: { code: ERROR_CODES.AUTH_TOKEN_INVALID },
    });
    await expect(guard.canActivate(mockHttpContext())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('非 Bearer 前缀 → 1001', async () => {
    await expect(
      guard.canActivate(mockHttpContext('Basic abc')),
    ).rejects.toMatchObject({ response: { code: 1001 } });
  });

  it('签名错误 → 1001', async () => {
    const token = signToken({ admin_id: '1', role: 'admin' }, 3600);
    const tampered = `${token.slice(0, -2)}xx`;
    await expect(
      guard.canActivate(mockHttpContext(`Bearer ${tampered}`)),
    ).rejects.toMatchObject({ response: { code: 1001 } });
  });

  it('token 过期 → 1002', async () => {
    const token = signToken({ admin_id: '1', role: 'admin' }, -10);
    await expect(
      guard.canActivate(mockHttpContext(`Bearer ${token}`)),
    ).rejects.toMatchObject({ response: { code: 1002 } });
  });

  it('payload 缺 admin_id → 1001', async () => {
    const token = signToken({ role: 'admin' }, 3600);
    await expect(
      guard.canActivate(mockHttpContext(`Bearer ${token}`)),
    ).rejects.toMatchObject({ response: { code: 1001 } });
  });

  it('role 非 admin/auditor → 6001 Forbidden', async () => {
    const token = signToken({ admin_id: '1', role: 'superop' }, 3600);
    const err = await guard
      .canActivate(mockHttpContext(`Bearer ${token}`))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getResponse()).toMatchObject({
      code: ERROR_CODES.ADMIN_PERMISSION_DENIED,
    });
  });

  it.each(['admin', 'auditor'])('role=%s 放行并挂载 req.admin', async (role) => {
    const token = signToken({ admin_id: ADMIN_ID, role }, 3600);
    const req: { headers: { authorization: string }; admin?: unknown } = {
      headers: { authorization: `Bearer ${token}` },
    };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as never;
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.admin).toEqual({ admin_id: ADMIN_ID, role });
  });

  it('static toJSON 返回类名（BigInt 序列化兜底约定）', () => {
    expect(AdminJwtGuard.toJSON()).toBe('AdminJwtGuard');
  });
});

// ---------- #69 新增学校 ----------

describe('SchoolAdminService.create（@api §5.3 #69，@ac F36-AC2）', () => {
  const body = {
    name: '新示例大学',
    short_name: '新示大',
    email_suffix: '@new.example.edu.cn',
    city: '上海',
    remark: '二期开通',
  };

  it('创建成功：status=active，写 log(school.create)', async () => {
    const { prisma, service } = setup();
    prisma.school.findFirst.mockResolvedValue(null);
    prisma.school.create.mockResolvedValue(
      makeSchool({ id: BigInt(30), name: body.name }),
    );
    prisma.adminOperationLog.create.mockResolvedValue({ id: BigInt(1) });

    const res = await service.create(ADMIN_ID, body);

    expect(prisma.school.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: body.name, status: 'active' }),
    });
    expect(res).toMatchObject({ id: '30', name: body.name, status: 'active' });
    expect(prisma.adminOperationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        admin_id: BigInt(ADMIN_ID),
        action: 'school.create',
        target_type: 'school',
        target_id: BigInt(30),
      }),
    });
  });

  it('重名 → 9001，不落库', async () => {
    const { prisma, service } = setup();
    prisma.school.findFirst.mockResolvedValueOnce(makeSchool());

    await expect(service.create(ADMIN_ID, body)).rejects.toMatchObject({
      code: ERROR_CODES.PARAM_VALIDATION_FAILED,
    });
    expect(prisma.school.create).not.toHaveBeenCalled();
  });

  it('邮箱后缀重复 → 9001', async () => {
    const { prisma, service } = setup();
    prisma.school.findFirst
      .mockResolvedValueOnce(null) // name 查重通过
      .mockResolvedValueOnce(makeSchool()); // 后缀查重命中

    await expect(service.create(ADMIN_ID, body)).rejects.toMatchObject({
      code: 9001,
    });
    expect(prisma.school.create).not.toHaveBeenCalled();
  });
});

// ---------- #70 修改学校 ----------

describe('SchoolAdminService.update（@api §5.3 #70）', () => {
  it('更新成功并写 log(school.update)', async () => {
    const { prisma, service } = setup();
    prisma.school.findUnique.mockResolvedValue(makeSchool());
    prisma.school.findFirst.mockResolvedValue(null);
    prisma.school.update.mockResolvedValue(makeSchool({ city: '杭州' }));
    prisma.adminOperationLog.create.mockResolvedValue({ id: BigInt(2) });

    const res = await service.update(ADMIN_ID, '10', { city: '杭州' });

    expect(prisma.school.update).toHaveBeenCalledWith({
      where: { id: BigInt(10) },
      data: { city: '杭州' },
    });
    expect(res).toMatchObject({ id: '10', city: '杭州' });
    expect(prisma.adminOperationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'school.update' }),
    });
  });

  it('学校不存在 → 9001', async () => {
    const { prisma, service } = setup();
    prisma.school.findUnique.mockResolvedValue(null);

    await expect(
      service.update(ADMIN_ID, '999', { city: '杭州' }),
    ).rejects.toMatchObject({ code: 9001 });
    expect(prisma.school.update).not.toHaveBeenCalled();
  });
});

// ---------- #71 停用学校（软删除留痕） ----------

describe('SchoolAdminService.disable（@api §5.3 #71）', () => {
  it('confirm=true：置 disabled 并写 log(school.disable)', async () => {
    const { prisma, service } = setup();
    prisma.school.findUnique.mockResolvedValue(makeSchool());
    prisma.school.update.mockResolvedValue(makeSchool({ status: 'disabled' }));
    prisma.adminOperationLog.create.mockResolvedValue({ id: BigInt(3) });

    const res = await service.disable(ADMIN_ID, '10', { confirm: true });

    expect(prisma.school.update).toHaveBeenCalledWith({
      where: { id: BigInt(10) },
      data: { status: 'disabled' },
    });
    expect(res).toBeNull();
    expect(prisma.adminOperationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'school.disable',
        target_id: BigInt(10),
      }),
    });
  });

  it('confirm 缺失/非 true → 9001', async () => {
    const { prisma, service } = setup();
    await expect(
      service.disable(ADMIN_ID, '10', {}),
    ).rejects.toMatchObject({ code: 9001 });
    expect(prisma.school.update).not.toHaveBeenCalled();
  });

  it('学校不存在 → 9001', async () => {
    const { prisma, service } = setup();
    prisma.school.findUnique.mockResolvedValue(null);
    await expect(
      service.disable(ADMIN_ID, '999', { confirm: true }),
    ).rejects.toMatchObject({ code: 9001 });
  });
});

// ---------- #68 名单列表 ----------

describe('SchoolAdminService.list（@api §5.3 #68）', () => {
  it('member_count 由 identity_verification groupBy 聚合映射，缺省为 0', async () => {
    const { prisma, service } = setup();
    prisma.school.findMany.mockResolvedValue([
      makeSchool({ id: BigInt(10) }),
      makeSchool({ id: BigInt(11), name: '另一大学' }),
    ]);
    prisma.school.count.mockResolvedValue(2);
    prisma.identityVerification.groupBy.mockResolvedValue([
      { school_id: BigInt(10), _count: { _all: 42 } },
    ]);

    const res = await service.list({ page: 1, pageSize: 20 });

    expect(res).toMatchObject({ page: 1, pageSize: 20, total: 2 });
    expect(res.list[0]).toMatchObject({ id: '10', member_count: 42 });
    expect(res.list[1]).toMatchObject({ id: '11', member_count: 0 });
    expect(prisma.identityVerification.groupBy).toHaveBeenCalled();
  });

  it('空列表跳过 groupBy', async () => {
    const { prisma, service } = setup();
    prisma.school.findMany.mockResolvedValue([]);
    prisma.school.count.mockResolvedValue(0);

    const res = await service.list({});

    expect(res.list).toHaveLength(0);
    expect(prisma.identityVerification.groupBy).not.toHaveBeenCalled();
  });
});

// ---------- #72 加入申请列表 ----------

describe('SchoolAdminService.joinRequests（@api §5.3 #72）', () => {
  it('school_name 与 contact（用户 nickname）映射', async () => {
    const { prisma, service } = setup();
    prisma.schoolJoinApplication.findMany.mockResolvedValue([makeApplication()]);
    prisma.schoolJoinApplication.count.mockResolvedValue(1);
    prisma.school.findUnique.mockResolvedValue(
      makeSchool({ id: BigInt(20), name: '同城学院' }),
    );
    prisma.user.findMany.mockResolvedValue([
      { id: BigInt(1001), nickname: '张三' },
    ]);

    const res = await service.joinRequests({ status: 'pending' });

    expect(res.list).toHaveLength(1);
    expect(res.list[0]).toMatchObject({
      id: '700',
      school_name: '同城学院',
      contact: '张三',
      status: 'pending',
      reason: '希望开通本校',
    });
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: [BigInt(1001)] } },
      select: { id: true, nickname: true },
    });
  });
});

// ---------- #73 申请处理 ----------

describe('SchoolAdminService.handleJoin（@api §5.3 #73，@rule CIM-R-02）', () => {
  it('approve 全联动：申请 approved(+reviewed_at/reviewer_id) + 学校 active/allow_join_application=true + log(school_join.approve)', async () => {
    const { prisma, service } = setup();
    prisma.schoolJoinApplication.findUnique.mockResolvedValue(makeApplication());
    prisma.schoolJoinApplication.update.mockResolvedValue(
      makeApplication({ status: 'approved' }),
    );
    prisma.school.update.mockResolvedValue(
      makeSchool({ id: BigInt(20), status: 'active', allow_join_application: true }),
    );
    prisma.adminOperationLog.create.mockResolvedValue({ id: BigInt(4) });

    const res = await service.handleJoin(ADMIN_ID, '700', { action: 'approve' });

    expect(prisma.schoolJoinApplication.update).toHaveBeenCalledWith({
      where: { id: BigInt(700) },
      data: expect.objectContaining({
        status: 'approved',
        reviewer_id: BigInt(ADMIN_ID),
        reviewed_at: expect.any(Date),
      }),
    });
    expect(prisma.school.update).toHaveBeenCalledWith({
      where: { id: BigInt(20) },
      data: { status: 'active', allow_join_application: true },
    });
    expect(prisma.adminOperationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'school_join.approve' }),
    });
    expect(res).toMatchObject({ id: '700', status: 'approved' });
  });

  it('reject：reject_reason=note 并写 log(school_join.reject)', async () => {
    const { prisma, service } = setup();
    prisma.schoolJoinApplication.findUnique.mockResolvedValue(makeApplication());
    prisma.schoolJoinApplication.update.mockResolvedValue(
      makeApplication({ status: 'rejected', reject_reason: '材料不清晰' }),
    );
    prisma.adminOperationLog.create.mockResolvedValue({ id: BigInt(5) });

    const res = await service.handleJoin(ADMIN_ID, '700', {
      action: 'reject',
      note: '材料不清晰',
    });

    expect(prisma.schoolJoinApplication.update).toHaveBeenCalledWith({
      where: { id: BigInt(700) },
      data: expect.objectContaining({
        status: 'rejected',
        reject_reason: '材料不清晰',
      }),
    });
    expect(prisma.school.update).not.toHaveBeenCalled();
    expect(prisma.adminOperationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'school_join.reject' }),
    });
    expect(res).toMatchObject({ status: 'rejected' });
  });

  it('申请非 pending → 6002', async () => {
    const { prisma, service } = setup();
    prisma.schoolJoinApplication.findUnique.mockResolvedValue(
      makeApplication({ status: 'approved' }),
    );

    await expect(
      service.handleJoin(ADMIN_ID, '700', { action: 'approve' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.AUDIT_TASK_NOT_FOUND });
    expect(prisma.schoolJoinApplication.update).not.toHaveBeenCalled();
  });

  it('申请不存在 → 6002', async () => {
    const { prisma, service } = setup();
    prisma.schoolJoinApplication.findUnique.mockResolvedValue(null);

    await expect(
      service.handleJoin(ADMIN_ID, '999', { action: 'approve' }),
    ).rejects.toMatchObject({ code: 6002 });
  });
});

// ---------- validator 分支 ----------

describe('school-admin.validator（@rule CIM-R-02 入参校验）', () => {
  it('create：name 必填/超长 → 9001；email_suffix 须以 @ 开头；remark≤500', () => {
    expectBizError(() => validateSchoolCreateDto({}), 9001);
    expectBizError(() => validateSchoolCreateDto({ name: 'x'.repeat(129) }), 9001);
    expectBizError(
      () => validateSchoolCreateDto({ name: 'A', email_suffix: 'no-at.com' }),
      9001,
    );
    expectBizError(
      () => validateSchoolCreateDto({ name: 'A', remark: 'r'.repeat(501) }),
      9001,
    );
    expect(
      validateSchoolCreateDto({ name: 'A', email_suffix: '@a.edu.cn' }),
    ).toMatchObject({ name: 'A', email_suffix: '@a.edu.cn' });
  });

  it('update：全可选但至少一项', () => {
    expectBizError(() => validateSchoolUpdateDto({}), 9001);
    expect(validateSchoolUpdateDto({ city: '杭州' })).toEqual({ city: '杭州' });
  });

  it('handle：action 必填且 approve/reject；reject 时 note 必填；note≤500', () => {
    expectBizError(() => validateHandleJoinDto({}), 9001);
    expectBizError(() => validateHandleJoinDto({ action: 'pass' }), 9001);
    expectBizError(() => validateHandleJoinDto({ action: 'reject' }), 9001);
    expectBizError(
      () => validateHandleJoinDto({ action: 'approve', note: 'n'.repeat(501) }),
      9001,
    );
    expect(validateHandleJoinDto({ action: 'approve' })).toEqual({
      action: 'approve',
      note: undefined,
    });
  });

  it('validateIdParam：仅接受纯数字', () => {
    expect(validateIdParam('123')).toBe('123');
    expectBizError(() => validateIdParam('abc'), 9001);
  });

  it('list query：学校 status 域与申请 status 域分离；page/pageSize 默认与上限 50', () => {
    expect(validateSchoolListQuery({})).toEqual({ page: 1, pageSize: 20 });
    expect(validateSchoolListQuery({ status: 'active' })).toMatchObject({
      status: 'active',
    });
    expectBizError(() => validateSchoolListQuery({ status: 'pending' }), 9001);
    expectBizError(
      () => validateSchoolListQuery({ page: 1, pageSize: 51 }),
      9001,
    );

    expect(validateJoinRequestListQuery({ status: 'pending' })).toMatchObject({
      status: 'pending',
    });
    expectBizError(
      () => validateJoinRequestListQuery({ status: 'active' }),
      9001,
    );
    expect(validateJoinRequestListQuery({})).toEqual({ page: 1, pageSize: 20 });
  });
});

// ---------- controller 包络与 guard 元数据 ----------

describe('SchoolAdminController（@api §5.3 #68-73 返回包络）', () => {
  it('统一返回 {code:0,message:ok,data}；DELETE data=null；adminId 取 req.admin.admin_id', async () => {
    const { prisma, controller } = setup();
    const req = { admin: { admin_id: ADMIN_ID, role: 'admin' } };

    // POST schools
    prisma.school.findFirst.mockResolvedValue(null);
    prisma.school.create.mockResolvedValue(
      makeSchool({ id: BigInt(30), name: '新校' }),
    );
    prisma.adminOperationLog.create.mockResolvedValue({ id: BigInt(6) });
    const created = await controller.createSchool(req as never, {
      name: '新校',
    });
    expect(created).toMatchObject({ code: 0, message: 'ok' });
    expect(created.data).toMatchObject({ id: '30' });

    // DELETE schools/:id
    prisma.school.findUnique.mockResolvedValue(makeSchool());
    prisma.school.update.mockResolvedValue(makeSchool({ status: 'disabled' }));
    const removed = await controller.disableSchool(req as never, '10', {
      confirm: true,
    });
    expect(removed).toEqual({ code: 0, message: 'ok', data: null });
  });

  it('类级 @UseGuards(AdminJwtGuard) 元数据存在', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      SchoolAdminController,
    ) as unknown[];
    expect(guards).toContain(AdminJwtGuard);
  });

  it('BusinessError 携带 code 与 message', () => {
    const err = new BusinessError(9001, 'bad');
    expect(err.code).toBe(9001);
    expect(err.message).toBe('bad');
    expect(err).toBeInstanceOf(Error);
  });
});
