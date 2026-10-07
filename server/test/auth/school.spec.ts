/**
 * school.spec.ts —— T-103 高校名单查询与名单外加入申请（用户侧）
 * （PRD F36-AC1；契约 §5.2 school #5/#6；模型 PIM-BC-01/PIM-AG-01；规则 CIM-R-02；
 *  表 school/school_join_application → 无聚合 BC-06 支撑表，PSM-02-11）
 *
 * 覆盖验收点：
 *  - #5 GET /schools：只返回 status=active 学校（首期仅本校），含 id/name/short_name/city，
 *    keyword 模糊过滤，分页结构 {page,pageSize,total,list}（§5.1），游客可读（无登录态要求）
 *  - #6 POST /schools/join：名单外学校（disabled + allow_join_application）提交成功，
 *    创建 pending 记录并关联 user_id / school_id
 *  - 进度查询 GET /schools/join/status（契约外新增，对齐 verify/status 模式）：
 *    返回本人申请及状态（含 school_name）；无申请 → 空 list
 *  - 重复提交口径（自定）：同校已有 pending → 9001 拦截不新建；已有 approved → 9001；
 *    已有 rejected → 允许再次提交（新建 pending）
 *  - 学校校验：school_id 为空/非法 → 9001；school 不存在 → 9001；
 *    school 已 active → 9001 无需申请；disabled 且未开放申请 → 1006
 *
 * 无真实 MySQL：PrismaService 一律 jest mock。
 */
import { ERROR_CODES, VerificationStatus } from '@contract/index';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { SchoolController } from '../../src/modules/auth/school.controller';
import { SchoolService } from '../../src/modules/auth/school.service';
import { SchoolRepository } from '../../src/modules/auth/school.repository';
import {
  validateSchoolJoinDto,
  validateSchoolListQuery,
} from '../../src/modules/auth/school.validator';
import { BusinessError } from '../../src/modules/auth/auth.service';
import { JwtAuthGuard } from '../../src/infra/auth/jwt.guard';
import { PrismaService } from '../../src/infra/prisma.service';

// ---------- 测试夹具 ----------

const UID = '1001';

/** 首期本校（active） */
const makeActiveSchool = (over: Record<string, unknown> = {}) => ({
  id: BigInt(10),
  name: '示例大学',
  short_name: '示大',
  email_suffix: '@stu.example.edu.cn',
  city: '北京',
  status: 'active',
  allow_join_application: false,
  ...over,
});

/** 名单外学校（disabled 且开放加入申请） */
const makeOutsideSchool = (over: Record<string, unknown> = {}) => ({
  id: BigInt(20),
  name: '同城学院',
  short_name: '同城院',
  email_suffix: null,
  city: '北京',
  status: 'disabled',
  allow_join_application: true,
  ...over,
});

const makeApplication = (over: Record<string, unknown> = {}) => ({
  id: BigInt(700),
  user_id: BigInt(UID),
  school_id: BigInt(20),
  student_no: '20240001',
  proof_image_url: 'https://cdn.example.com/proof.jpg',
  reason: '希望开通本校',
  status: VerificationStatus.PENDING,
  reject_reason: null,
  submitted_at: new Date('2026-10-06T08:00:00Z'),
  reviewed_at: null,
  reviewer_id: null,
  ...over,
});

const makePrismaMock = () =>
  ({
    school: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
    },
    schoolJoinApplication: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
  }) as unknown as PrismaService & {
    school: { findMany: jest.Mock; count: jest.Mock; findUnique: jest.Mock };
    schoolJoinApplication: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
    };
  };

const setup = () => {
  const prisma = makePrismaMock();
  const repo = new SchoolRepository(prisma);
  const service = new SchoolService(repo);
  const controller = new SchoolController(service);
  return { prisma, repo, service, controller };
};

// ---------- §5.2 #5 GET /schools ----------

describe('SchoolService.list（@api §5.2 #5，@ac F36-AC1）', () => {
  it('只返回 active 学校：仓储查询条件固定 status=active，首期仅本校', async () => {
    const { prisma, service } = setup();
    prisma.school.findMany.mockResolvedValue([makeActiveSchool()]);
    prisma.school.count.mockResolvedValue(1);

    const res = await service.list({});

    expect(res.list).toHaveLength(1);
    expect(res.list[0]).toEqual({
      id: '10',
      name: '示例大学',
      short_name: '示大',
      city: '北京',
    });
    const where = prisma.school.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('active');
    // 不得返回 disabled 学校的过滤责任在查询条件上（首期本校 active）
    expect(res.list.every((s) => s.id === '10')).toBe(true);
  });

  it('含必要字段 id/name/short_name/city；BigInt 序列化为字符串', async () => {
    const { prisma, service } = setup();
    prisma.school.findMany.mockResolvedValue([makeActiveSchool({ city: null })]);
    prisma.school.count.mockResolvedValue(1);

    const res = await service.list({});
    expect(typeof res.list[0].id).toBe('string');
    expect(res.list[0].city).toBeNull();
    expect(Object.keys(res.list[0]).sort()).toEqual(
      ['city', 'id', 'name', 'short_name'].sort(),
    );
  });

  it('keyword 模糊匹配 name/short_name，分页参数透传（skip/take）', async () => {
    const { prisma, service } = setup();
    prisma.school.findMany.mockResolvedValue([]);
    prisma.school.count.mockResolvedValue(0);

    const res = await service.list({ keyword: '示例', page: 2, pageSize: 10 });

    const args = prisma.school.findMany.mock.calls[0][0];
    expect(args.where.OR).toEqual([
      { name: { contains: '示例' } },
      { short_name: { contains: '示例' } },
    ]);
    expect(args.skip).toBe(10);
    expect(args.take).toBe(10);
    expect(res).toMatchObject({ page: 2, pageSize: 10, total: 0, list: [] });
  });

  it('无 keyword 时不带 OR 条件；默认分页 page=1 pageSize=20', async () => {
    const { prisma, service } = setup();
    prisma.school.findMany.mockResolvedValue([makeActiveSchool()]);
    prisma.school.count.mockResolvedValue(1);

    const res = await service.list({});

    const args = prisma.school.findMany.mock.calls[0][0];
    expect(args.where.OR).toBeUndefined();
    expect(args.skip).toBe(0);
    expect(args.take).toBe(20);
    expect(res.page).toBe(1);
    expect(res.pageSize).toBe(20);
    expect(res.total).toBe(1);
  });
});

// ---------- §5.2 #6 POST /schools/join ----------

describe('SchoolService.submitJoin（@api §5.2 #6，@ac F36-AC1）', () => {
  it('名单外学校提交成功：创建 pending 记录，关联 user_id 与 school_id', async () => {
    const { prisma, service } = setup();
    prisma.school.findUnique.mockResolvedValue(makeOutsideSchool());
    prisma.schoolJoinApplication.findFirst.mockResolvedValue(null);
    prisma.schoolJoinApplication.create.mockResolvedValue(makeApplication());

    const res = await service.submitJoin(UID, {
      school_id: '20',
      evidence: ['https://cdn.example.com/proof.jpg'],
      reason: '希望开通本校',
      student_no: '20240001',
    });

    expect(res.status).toBe(VerificationStatus.PENDING);
    expect(res.apply_id).toBe('700');
    const created = prisma.schoolJoinApplication.create.mock.calls[0][0].data;
    expect(created.user_id).toBe(BigInt(UID));
    expect(created.school_id).toBe(BigInt(20));
    expect(created.status).toBe(VerificationStatus.PENDING);
    expect(created.proof_image_url).toBe('https://cdn.example.com/proof.jpg');
  });

  it('学校标识为空/缺失 → 9001', async () => {
    const { prisma, service } = setup();

    await expect(service.submitJoin(UID, {})).rejects.toMatchObject({
      code: ERROR_CODES.PARAM_VALIDATION_FAILED,
    });
    await expect(
      service.submitJoin(UID, { school_id: '  ' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.PARAM_VALIDATION_FAILED });
    expect(prisma.schoolJoinApplication.create).not.toHaveBeenCalled();
  });

  it('school 不存在 → 9001 学校不存在', async () => {
    const { prisma, service } = setup();
    prisma.school.findUnique.mockResolvedValue(null);

    await expect(
      service.submitJoin(UID, { school_id: '999' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.PARAM_VALIDATION_FAILED });
  });

  it('school 已 active（名单内）→ 9001 无需申请', async () => {
    const { prisma, service } = setup();
    prisma.school.findUnique.mockResolvedValue(makeActiveSchool());

    await expect(
      service.submitJoin(UID, { school_id: '10' }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.PARAM_VALIDATION_FAILED,
      message: expect.stringContaining('无需'),
    });
  });

  it('school disabled 且未开放加入申请 → 1006', async () => {
    const { prisma, service } = setup();
    prisma.school.findUnique.mockResolvedValue(
      makeOutsideSchool({ allow_join_application: false }),
    );

    await expect(
      service.submitJoin(UID, { school_id: '20' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.SCHOOL_NOT_OPEN });
  });

  it('重复提交口径：同校已有 pending → 9001 拦截，不新建', async () => {
    const { prisma, service } = setup();
    prisma.school.findUnique.mockResolvedValue(makeOutsideSchool());
    prisma.schoolJoinApplication.findFirst.mockResolvedValue(makeApplication());

    await expect(
      service.submitJoin(UID, { school_id: '20' }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.PARAM_VALIDATION_FAILED,
      message: expect.stringContaining('待审核'),
    });
    expect(prisma.schoolJoinApplication.create).not.toHaveBeenCalled();
  });

  it('重复提交口径：同校已有 approved → 9001 拦截', async () => {
    const { prisma, service } = setup();
    prisma.school.findUnique.mockResolvedValue(makeOutsideSchool());
    prisma.schoolJoinApplication.findFirst.mockResolvedValue(
      makeApplication({ status: VerificationStatus.APPROVED }),
    );

    await expect(
      service.submitJoin(UID, { school_id: '20' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.PARAM_VALIDATION_FAILED });
    expect(prisma.schoolJoinApplication.create).not.toHaveBeenCalled();
  });

  it('重复提交口径：同校已有 rejected → 允许再次提交（新建 pending）', async () => {
    const { prisma, service } = setup();
    prisma.school.findUnique.mockResolvedValue(makeOutsideSchool());
    prisma.schoolJoinApplication.findFirst.mockResolvedValue(
      makeApplication({ status: VerificationStatus.REJECTED, reject_reason: '材料不清晰' }),
    );
    prisma.schoolJoinApplication.create.mockResolvedValue(makeApplication());

    const res = await service.submitJoin(UID, { school_id: '20' });

    expect(res.status).toBe(VerificationStatus.PENDING);
    expect(prisma.schoolJoinApplication.create).toHaveBeenCalledTimes(1);
  });
});

// ---------- 进度查询 GET /schools/join/status（契约外新增，已声明） ----------

describe('SchoolService.getJoinStatus（进度查询）', () => {
  it('返回本人申请及状态，含 school_name（school 表名称映射）', async () => {
    const { prisma, service } = setup();
    prisma.schoolJoinApplication.findMany.mockResolvedValue([
      makeApplication(),
      makeApplication({
        id: BigInt(701),
        status: VerificationStatus.REJECTED,
        reject_reason: '材料不清晰',
        reviewed_at: new Date('2026-10-05T10:00:00Z'),
      }),
    ]);
    prisma.school.findMany.mockResolvedValue([makeOutsideSchool()]);

    const res = await service.getJoinStatus(UID);

    expect(res.list).toHaveLength(2);
    expect(res.list[0]).toMatchObject({
      id: '700',
      school_id: '20',
      school_name: '同城学院',
      status: VerificationStatus.PENDING,
      reject_reason: null,
    });
    expect(res.list[1].status).toBe(VerificationStatus.REJECTED);
    expect(res.list[1].reject_reason).toBe('材料不清晰');
    // 只查本人申请
    expect(prisma.schoolJoinApplication.findMany.mock.calls[0][0].where.user_id).toBe(
      BigInt(UID),
    );
  });

  it('无申请记录 → 空 list，且不再查 school 表', async () => {
    const { prisma, service } = setup();
    prisma.schoolJoinApplication.findMany.mockResolvedValue([]);

    const res = await service.getJoinStatus(UID);

    expect(res.list).toEqual([]);
    expect(prisma.school.findMany).not.toHaveBeenCalled();
  });
});

// ---------- controller 包装与鉴权 ----------

describe('SchoolController（@api §5.2 #5/#6）', () => {
  it('GET /schools 游客可读：list 方法未挂 JwtAuthGuard', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, SchoolController.prototype.list);
    expect(guards ?? []).not.toContain(JwtAuthGuard);
  });

  it('POST /schools/join 与 GET /schools/join/status 需登录（JwtAuthGuard，无 token → 1001）', () => {
    const joinGuards = Reflect.getMetadata(GUARDS_METADATA, SchoolController.prototype.join);
    const statusGuards = Reflect.getMetadata(
      GUARDS_METADATA,
      SchoolController.prototype.joinStatus,
    );
    expect(joinGuards).toContain(JwtAuthGuard);
    expect(statusGuards).toContain(JwtAuthGuard);
  });

  it('POST /schools/join 返回 {code:0,data:{apply_id,status}}，uid 取自 req.user', async () => {
    const { prisma, controller } = setup();
    prisma.school.findUnique.mockResolvedValue(makeOutsideSchool());
    prisma.schoolJoinApplication.findFirst.mockResolvedValue(null);
    prisma.schoolJoinApplication.create.mockResolvedValue(makeApplication());

    const res = await controller.join({ user: { uid: UID } } as never, { school_id: '20' });

    expect(res.code).toBe(0);
    expect(res.data).toMatchObject({ apply_id: '700', status: 'pending' });
  });

  it('GET /schools/join/status 返回 {code:0,data:{list}}', async () => {
    const { prisma, controller } = setup();
    prisma.schoolJoinApplication.findMany.mockResolvedValue([]);

    const res = await controller.joinStatus({ user: { uid: UID } } as never);

    expect(res.code).toBe(0);
    expect(res.data.list).toEqual([]);
  });

  it('GET /schools 返回 {code:0,data:分页结构}', async () => {
    const { prisma, controller } = setup();
    prisma.school.findMany.mockResolvedValue([makeActiveSchool()]);
    prisma.school.count.mockResolvedValue(1);

    const res = await controller.list({});

    expect(res.code).toBe(0);
    expect(res.data.total).toBe(1);
    expect(res.data.list[0].name).toBe('示例大学');
  });
});

// ---------- 入参校验 ----------

describe('validateSchoolJoinDto', () => {
  it('合法入参透传（evidence/reason/student_no 可选）', () => {
    const dto = validateSchoolJoinDto({
      school_id: '20',
      evidence: ['https://a.jpg'],
      reason: '原因',
      student_no: '20240001',
    });
    expect(dto.school_id).toBe('20');
    expect(dto.evidence).toEqual(['https://a.jpg']);
  });

  it('school_id 缺失/空/非数字 → 9001', () => {
    expect(() => validateSchoolJoinDto({})).toThrow(BusinessError);
    expect(() => validateSchoolJoinDto({ school_id: '' })).toThrow(BusinessError);
    expect(() => validateSchoolJoinDto({ school_id: 'abc' })).toThrow(BusinessError);
  });

  it('evidence 非数组 / 元素非字符串 / 超过 9 张 / URL 超长 → 9001', () => {
    expect(() => validateSchoolJoinDto({ school_id: '20', evidence: 'x' })).toThrow(
      BusinessError,
    );
    expect(() => validateSchoolJoinDto({ school_id: '20', evidence: [1] })).toThrow(
      BusinessError,
    );
    expect(() =>
      validateSchoolJoinDto({ school_id: '20', evidence: Array(10).fill('https://a.jpg') }),
    ).toThrow(BusinessError);
    expect(() =>
      validateSchoolJoinDto({ school_id: '20', evidence: [`https://${'a'.repeat(520)}`] }),
    ).toThrow(BusinessError);
  });

  it('reason 超长（>500）/ student_no 超长（>64）→ 9001', () => {
    expect(() =>
      validateSchoolJoinDto({ school_id: '20', reason: 'x'.repeat(501) }),
    ).toThrow(BusinessError);
    expect(() =>
      validateSchoolJoinDto({ school_id: '20', student_no: '1'.repeat(65) }),
    ).toThrow(BusinessError);
  });
});

describe('validateSchoolListQuery', () => {
  it('缺省 → page=1 pageSize=20；字符串数字可解析', () => {
    expect(validateSchoolListQuery({})).toEqual({ page: 1, pageSize: 20 });
    expect(validateSchoolListQuery({ page: '3', pageSize: '50' })).toEqual({
      page: 3,
      pageSize: 50,
    });
  });

  it('keyword 去空白透传；空白 keyword 视为无', () => {
    expect(validateSchoolListQuery({ keyword: ' 示例 ' })).toMatchObject({
      keyword: '示例',
    });
    expect(validateSchoolListQuery({ keyword: '   ' })).toEqual({ page: 1, pageSize: 20 });
  });

  it('非法分页参数 → 9001；pageSize 超上限 50 → 9001', () => {
    expect(() => validateSchoolListQuery({ page: '0' })).toThrow(BusinessError);
    expect(() => validateSchoolListQuery({ page: 'x' })).toThrow(BusinessError);
    expect(() => validateSchoolListQuery({ pageSize: '51' })).toThrow(BusinessError);
    expect(() => validateSchoolListQuery({ keyword: 123 })).toThrow(BusinessError);
  });
});
