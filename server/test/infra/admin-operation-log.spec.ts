/**
 * admin-operation-log.spec.ts —— T-309 运营操作/调阅留痕（infra 操作日志切面）
 *
 * @module infra/admin-log（统一留痕切面：admin 写操作与敏感调阅统一入口）
 * @rule CIM-R-34 敏感数据调阅必须留痕（操作人/时间/事由）
 * @table admin_operation_log → 无聚合 BC-06（§4.27 不可变日志，只增不改不删）
 * @ac PRD N6（隐私保护：调阅留痕记录）/ N9（证据留存：含操作人、时间、事由）
 *
 * 覆盖验收点：
 *  - AdminLogService.record：operator_id/action/target_type/target_id/reason/detail 落库；
 *    reason 必填（N6：所有操作必填事由）；action 必填；target 可省略 → NULL
 *  - SENSITIVE_ACTIONS：敏感调阅动作枚举（资质/实名/举报详情调阅等）
 *  - AdminLogRepository.findPage：operator/action/target_type/时间范围过滤 + 分页
 *    （created_at 倒序），只读不写
 *  - GET /admin/v1/audit-logs：AdminJwtGuard 元数据；查询参数校验（9001）；
 *    返回包络 {code:0,message:'ok',data:{page,pageSize,total,list}}，BigInt→string
 *  - school-admin 接入：create 动作经 AdminLogService.record 统一留痕（替代自写口径）
 *
 * 无真实 MySQL：PrismaService 一律 jest mock（同 word-interceptor.spec.ts 口径）。
 */
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ERROR_CODES } from '@contract/index';
import { AdminJwtGuard } from '../../src/infra/auth/admin-jwt.guard';
import { PrismaService } from '../../src/infra/prisma.service';
import {
  AdminLogService,
  BusinessError,
  SENSITIVE_ACTIONS,
} from '../../src/infra/admin-log/admin-log.interceptor';
import { AdminLogRepository } from '../../src/infra/admin-log/admin-log.repository';
import { AdminLogQueryController } from '../../src/infra/admin-log/admin-log-query.controller';
import { SchoolAdminController } from '../../src/modules/admin/support/school-admin.controller';
import { SchoolAdminService } from '../../src/modules/admin/support/school-admin.service';
import { SchoolAdminRepository } from '../../src/modules/admin/support/school-admin.repository';

// ---------- 测试夹具 ----------

const ADMIN_ID = '9001';

const makeLogRow = (over: Record<string, unknown> = {}) => ({
  id: BigInt(101),
  admin_id: BigInt(ADMIN_ID),
  action: 'school.create',
  target_type: 'school',
  target_id: BigInt(30),
  reason: '二期开通',
  detail: { name: '新校' },
  ip: null,
  created_at: new Date('2026-10-06T08:00:00.000Z'),
  ...over,
});

const makePrismaMock = () =>
  ({
    adminOperationLog: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
  }) as unknown as PrismaService & {
    adminOperationLog: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
  };

// ---------- SENSITIVE_ACTIONS 敏感动作枚举 ----------

describe('SENSITIVE_ACTIONS（敏感调阅动作枚举，@rule CIM-R-34，@ac N6/N9）', () => {
  it('包含资质调阅/实名调阅/举报详情调阅等敏感动作，动作值统一 .access 后缀', () => {
    const values = Object.values(SENSITIVE_ACTIONS);
    expect(values).toContain('qualification.access');
    expect(values).toContain('realname.access');
    expect(values).toContain('report_detail.access');
    for (const v of values) {
      expect(v).toMatch(/\.access$/);
    }
  });
});

// ---------- AdminLogService.record 统一留痕写入 ----------

describe('AdminLogService.record（统一留痕写入，@table admin_operation_log → PIM-BC-06）', () => {
  it('operator_id/action/target/reason/detail 全要素落库（BigInt 转换）', async () => {
    const prisma = makePrismaMock();
    const service = new AdminLogService(new AdminLogRepository(prisma));
    prisma.adminOperationLog.create.mockResolvedValue(makeLogRow());

    await service.record({
      operatorId: ADMIN_ID,
      action: 'school.create',
      targetType: 'school',
      targetId: '30',
      reason: '二期开通',
      detail: { name: '新校' },
    });

    expect(prisma.adminOperationLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.adminOperationLog.create).toHaveBeenCalledWith({
      data: {
        admin_id: BigInt(ADMIN_ID),
        action: 'school.create',
        target_type: 'school',
        target_id: BigInt(30),
        reason: '二期开通',
        detail: { name: '新校' },
        ip: null,
      },
    });
  });

  it('target/detail/ip 可省略 → 落 NULL（无对象的全局动作）', async () => {
    const prisma = makePrismaMock();
    const service = new AdminLogService(new AdminLogRepository(prisma));
    prisma.adminOperationLog.create.mockResolvedValue(makeLogRow());

    await service.record({
      operatorId: ADMIN_ID,
      action: 'word_list.reload',
      reason: '词表快照刷新',
    });

    expect(prisma.adminOperationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        target_type: null,
        target_id: null,
        ip: null,
      }),
    });
  });

  it('敏感调阅动作（data_access 口径）：detail 记录调阅字段清单（§4.27）', async () => {
    const prisma = makePrismaMock();
    const service = new AdminLogService(new AdminLogRepository(prisma));
    prisma.adminOperationLog.create.mockResolvedValue(makeLogRow());

    await service.record({
      operatorId: ADMIN_ID,
      action: SENSITIVE_ACTIONS.REALNAME_ACCESS,
      targetType: 'user_data',
      targetId: '1001',
      reason: '申诉仲裁 A8 授权调阅（工单#42）',
      detail: { fields: ['student_no', 'proof_image_url'] },
    });

    expect(prisma.adminOperationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'realname.access',
        reason: '申诉仲裁 A8 授权调阅（工单#42）',
        detail: { fields: ['student_no', 'proof_image_url'] },
      }),
    });
  });

  it('reason 为空 → 9001（N6：所有操作必填事由），不落库', async () => {
    const prisma = makePrismaMock();
    const service = new AdminLogService(new AdminLogRepository(prisma));

    await expect(
      service.record({ operatorId: ADMIN_ID, action: 'school.create', reason: '' }),
    ).rejects.toMatchObject({
      name: 'BusinessError',
      code: ERROR_CODES.PARAM_VALIDATION_FAILED,
    });
    await expect(
      service.record({ operatorId: ADMIN_ID, action: 'school.create', reason: '  ' }),
    ).rejects.toBeInstanceOf(BusinessError);
    expect(prisma.adminOperationLog.create).not.toHaveBeenCalled();
  });

  it('action 为空 / operatorId 非数字 → 9001，不落库', async () => {
    const prisma = makePrismaMock();
    const service = new AdminLogService(new AdminLogRepository(prisma));

    await expect(
      service.record({ operatorId: ADMIN_ID, action: '', reason: 'r' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.PARAM_VALIDATION_FAILED });
    await expect(
      service.record({ operatorId: 'not-a-number', action: 'a.b', reason: 'r' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.PARAM_VALIDATION_FAILED });
    expect(prisma.adminOperationLog.create).not.toHaveBeenCalled();
  });
});

// ---------- AdminLogRepository.findPage 审计查询 ----------

describe('AdminLogRepository.findPage（审计查询：过滤 + 分页，只读）', () => {
  it('无过滤：默认分页 page=1/pageSize=20，created_at 倒序', async () => {
    const prisma = makePrismaMock();
    const repo = new AdminLogRepository(prisma);
    prisma.adminOperationLog.findMany.mockResolvedValue([makeLogRow()]);
    prisma.adminOperationLog.count.mockResolvedValue(1);

    const res = await repo.findPage({});

    expect(res).toEqual({ list: [makeLogRow()], total: 1 });
    expect(prisma.adminOperationLog.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { created_at: 'desc' },
      skip: 0,
      take: 20,
    });
  });

  it('operator/action/target_type/时间范围组合过滤（取交集）+ 分页换算', async () => {
    const prisma = makePrismaMock();
    const repo = new AdminLogRepository(prisma);
    prisma.adminOperationLog.findMany.mockResolvedValue([]);
    prisma.adminOperationLog.count.mockResolvedValue(0);

    const from = new Date('2026-10-01T00:00:00.000Z');
    const to = new Date('2026-10-06T23:59:59.000Z');
    await repo.findPage(
      {
        operatorId: BigInt(ADMIN_ID),
        action: 'realname.access',
        targetType: 'user_data',
        timeFrom: from,
        timeTo: to,
      },
      3,
      10,
    );

    expect(prisma.adminOperationLog.findMany).toHaveBeenCalledWith({
      where: {
        admin_id: BigInt(ADMIN_ID),
        action: 'realname.access',
        target_type: 'user_data',
        created_at: { gte: from, lte: to },
      },
      orderBy: { created_at: 'desc' },
      skip: 20,
      take: 10,
    });
    expect(prisma.adminOperationLog.count).toHaveBeenCalledWith({
      where: {
        admin_id: BigInt(ADMIN_ID),
        action: 'realname.access',
        target_type: 'user_data',
        created_at: { gte: from, lte: to },
      },
    });
  });
});

// ---------- GET /admin/v1/audit-logs 审计查询接口 ----------

describe('AdminLogQueryController（GET /admin/v1/audit-logs，@ac N9 调阅留痕可审计）', () => {
  const setup = () => {
    const prisma = makePrismaMock();
    const repo = new AdminLogRepository(prisma);
    const controller = new AdminLogQueryController(repo);
    return { prisma, repo, controller };
  };

  it('类级 @UseGuards(AdminJwtGuard) 元数据存在', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      AdminLogQueryController,
    ) as unknown[];
    expect(guards).toContain(AdminJwtGuard);
  });

  it('查询成功：包络 {code:0,data:{page,pageSize,total,list}}，BigInt→string，created_at ISO', async () => {
    const { prisma, controller } = setup();
    prisma.adminOperationLog.findMany.mockResolvedValue([makeLogRow()]);
    prisma.adminOperationLog.count.mockResolvedValue(1);

    const res = await controller.list({
      operator_id: ADMIN_ID,
      action: 'school.create',
      target_type: 'school',
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-06T23:59:59.000Z',
      page: '1',
      pageSize: '20',
    });

    expect(res.code).toBe(0);
    expect(res.message).toBe('ok');
    expect(res.data).toMatchObject({ page: 1, pageSize: 20, total: 1 });
    expect(res.data.list[0]).toEqual({
      id: '101',
      admin_id: ADMIN_ID,
      action: 'school.create',
      target_type: 'school',
      target_id: '30',
      reason: '二期开通',
      detail: { name: '新校' },
      ip: null,
      created_at: '2026-10-06T08:00:00.000Z',
    });
    expect(prisma.adminOperationLog.findMany).toHaveBeenCalledWith({
      where: {
        admin_id: BigInt(ADMIN_ID),
        action: 'school.create',
        target_type: 'school',
        created_at: {
          gte: new Date('2026-10-01T00:00:00.000Z'),
          lte: new Date('2026-10-06T23:59:59.000Z'),
        },
      },
      orderBy: { created_at: 'desc' },
      skip: 0,
      take: 20,
    });
  });

  it('空 query：默认分页 page=1/pageSize=20，where 为空', async () => {
    const { prisma, controller } = setup();
    prisma.adminOperationLog.findMany.mockResolvedValue([]);
    prisma.adminOperationLog.count.mockResolvedValue(0);

    const res = await controller.list({});

    expect(res.data).toMatchObject({ page: 1, pageSize: 20, total: 0, list: [] });
    expect(prisma.adminOperationLog.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { created_at: 'desc' },
      skip: 0,
      take: 20,
    });
  });

  it('operator_id 非数字 / pageSize 越界 / from 非法日期 → 9001，不查库', async () => {
    const { prisma, controller } = setup();

    await expect(
      controller.list({ operator_id: 'abc' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.PARAM_VALIDATION_FAILED });
    await expect(controller.list({ page: '0' })).rejects.toMatchObject({
      code: ERROR_CODES.PARAM_VALIDATION_FAILED,
    });
    await expect(controller.list({ pageSize: '51' })).rejects.toMatchObject({
      code: ERROR_CODES.PARAM_VALIDATION_FAILED,
    });
    await expect(controller.list({ from: 'not-a-date' })).rejects.toMatchObject({
      code: ERROR_CODES.PARAM_VALIDATION_FAILED,
    });
    expect(prisma.adminOperationLog.findMany).not.toHaveBeenCalled();
  });
});

// ---------- school-admin 接入统一切面 ----------

describe('SchoolAdminController 接入 AdminLogService（T-104 埋点改经统一切面）', () => {
  const setupWithLog = () => {
    const prisma = makePrismaMock();
    const schoolPrisma = {
      school: {
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      identityVerification: { groupBy: jest.fn() },
      schoolJoinApplication: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      adminOperationLog: prisma.adminOperationLog,
      user: { findMany: jest.fn() },
    };
    const repo = new SchoolAdminRepository(
      schoolPrisma as unknown as PrismaService,
    );
    const service = new SchoolAdminService(repo);
    const adminLog = { record: jest.fn().mockResolvedValue(undefined) };
    const controller = new SchoolAdminController(
      service,
      adminLog as unknown as AdminLogService,
    );
    return { schoolPrisma, adminLog, controller };
  };

  it('create 动作经 AdminLogService.record 统一留痕（operator/action/target/reason）', async () => {
    const { schoolPrisma, adminLog, controller } = setupWithLog();
    const req = { admin: { admin_id: ADMIN_ID, role: 'admin' } };
    const body = { name: '新校', remark: '二期开通' };
    schoolPrisma.school.findFirst.mockResolvedValue(null);
    schoolPrisma.school.create.mockResolvedValue({
      id: BigInt(30),
      name: '新校',
      short_name: '',
      email_suffix: null,
      city: null,
      status: 'active',
      allow_join_application: false,
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
    });
    schoolPrisma.adminOperationLog.create.mockResolvedValue({ id: BigInt(1) });

    const res = await controller.createSchool(req as never, body);

    expect(res).toMatchObject({ code: 0, message: 'ok' });
    expect(adminLog.record).toHaveBeenCalledTimes(1);
    expect(adminLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        operatorId: ADMIN_ID,
        action: 'school.create',
        targetType: 'school',
        targetId: '30',
        reason: '二期开通',
      }),
    );
  });

  it('disable 动作经 AdminLogService.record（targetType=school，动作 school.disable）', async () => {
    const { schoolPrisma, adminLog, controller } = setupWithLog();
    const req = { admin: { admin_id: ADMIN_ID, role: 'admin' } };
    schoolPrisma.school.findUnique.mockResolvedValue({
      id: BigInt(10),
      name: '示例大学',
      short_name: '示大',
      email_suffix: null,
      city: null,
      status: 'active',
      allow_join_application: false,
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
    });
    schoolPrisma.school.update.mockResolvedValue({});
    schoolPrisma.adminOperationLog.create.mockResolvedValue({ id: BigInt(2) });

    const res = await controller.disableSchool(req as never, '10', {
      confirm: true,
    });

    expect(res).toEqual({ code: 0, message: 'ok', data: null });
    expect(adminLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        operatorId: ADMIN_ID,
        action: 'school.disable',
        targetType: 'school',
        targetId: '10',
      }),
    );
  });

  it('handleJoin approve/reject 按 body.action 映射 school_join.approve/reject 留痕', async () => {
    const { schoolPrisma, adminLog, controller } = setupWithLog();
    const req = { admin: { admin_id: ADMIN_ID, role: 'admin' } };
    schoolPrisma.schoolJoinApplication.findUnique.mockResolvedValue({
      id: BigInt(700),
      user_id: BigInt(1001),
      school_id: BigInt(20),
      status: 'pending',
      submitted_at: new Date('2026-10-01T08:00:00Z'),
    });
    schoolPrisma.schoolJoinApplication.update.mockResolvedValue({
      id: BigInt(700),
      status: 'approved',
    });
    schoolPrisma.school.update.mockResolvedValue({});
    schoolPrisma.adminOperationLog.create.mockResolvedValue({ id: BigInt(3) });

    await controller.handleJoinRequest(req as never, '700', {
      action: 'approve',
    });

    expect(adminLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        operatorId: ADMIN_ID,
        action: 'school_join.approve',
        targetType: 'school_join_application',
        targetId: '700',
      }),
    );
  });

  it('update 动作经 AdminLogService.record（动作 school.update）', async () => {
    const { schoolPrisma, adminLog, controller } = setupWithLog();
    const req = { admin: { admin_id: ADMIN_ID, role: 'admin' } };
    const schoolRow = {
      id: BigInt(10),
      name: '示例大学',
      short_name: '示大',
      email_suffix: null,
      city: '杭州',
      status: 'active',
      allow_join_application: false,
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
    };
    schoolPrisma.school.findUnique.mockResolvedValue(schoolRow);
    schoolPrisma.school.findFirst.mockResolvedValue(null);
    schoolPrisma.school.update.mockResolvedValue(schoolRow);
    schoolPrisma.adminOperationLog.create.mockResolvedValue({ id: BigInt(4) });

    await controller.updateSchool(req as never, '10', { city: '杭州' });

    expect(adminLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        operatorId: ADMIN_ID,
        action: 'school.update',
        targetType: 'school',
        targetId: '10',
      }),
    );
  });
});
