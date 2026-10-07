/**
 * account.spec.ts —— 账号管理单元测试（PRD F20/F21 处置封禁、F31 申诉联动）
 *
 * @module PIM-BC-05/06
 * 前端契约以 admin-web/src/api/account.ts DTO 为对齐基准：
 * - 状态口径 normal/banned/deactivating；DB UserStatus clearance→deactivating，
 *   readonly/cancelled 兜底原文透传（前端页面兜底展示）；
 * - credit_score 在 schema 中无对应字段，占位返回 0（偏差已声明）；
 * - ban 联动：user.status=banned 后 JwtAuthGuard 每请求校验拦截（§2.6 设计，
 *   jwt.guard.ts 已实现 status!=='normal' → 1005）；
 * - ban/unban 均走 AdminLogService.record 留痕（N6/N9，reason 必填，
 *   空字符串兜底默认事由，同 school-admin 修复模式）。
 */
import { AccountService, BusinessError } from '../../src/modules/admin/governance/account.service';
import { AccountRepository } from '../../src/modules/admin/governance/account.repository';

const NOW = new Date('2026-10-08T12:00:00.000Z');

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 2n,
    nickname: '李同学',
    identity_type: 'student',
    status: 'normal',
    banned_reason: null,
    banned_at: null,
    created_at: new Date('2026-10-06T15:00:28.000Z'),
    ...overrides,
  };
}

function makePrisma() {
  return {
    user: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    product: { count: jest.fn().mockResolvedValue(3) },
    tradeOrder: { count: jest.fn().mockResolvedValue(1) },
    report: { count: jest.fn().mockResolvedValue(0) },
    adminOperationLog: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
    },
    adminUser: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

function setup() {
  const prisma = makePrisma();
  const repo = new AccountRepository(prisma as never);
  const adminLog = { record: jest.fn().mockResolvedValue(undefined) };
  const notify = { send: jest.fn().mockResolvedValue({ id: '1' }) };
  const service = new AccountService(repo, adminLog as never, notify as never);
  return { prisma, repo, adminLog, notify, service };
}

describe('AccountService.list（GET /admin/v1/accounts）', () => {
  it('keyword/status/role 过滤；status=deactivating 映射 DB clearance；输出反向映射', async () => {
    const { prisma, service } = setup();
    prisma.user.findMany.mockResolvedValue([makeUser({ status: 'clearance' })]);
    prisma.user.count.mockResolvedValue(1);

    const res = await service.list({ keyword: '李', status: 'deactivating', role: 'student' });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'clearance',
          identity_type: 'student',
          nickname: { contains: '李' },
        }),
        skip: 0,
        take: 20,
      }),
    );
    expect(res.total).toBe(1);
    expect(res.list[0]).toEqual({
      id: '2',
      nickname: '李同学',
      identity_type: 'student',
      credit_score: 0, // schema 无信用分字段，占位 0
      status: 'deactivating',
      registered_at: '2026-10-06T15:00:28.000Z',
    });
  });

  it('status/role 非法抛 9001', async () => {
    const { service } = setup();
    await expect(service.list({ status: 'xxx' })).rejects.toMatchObject({ code: 9001 });
    await expect(service.list({ role: 'xxx' })).rejects.toMatchObject({ code: 9001 });
  });
});

describe('AccountService.detail（GET /admin/v1/accounts/:id）', () => {
  it('返回账号信息+统计+ban_info（取自最近 account.ban 留痕）+操作留痕', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(
      makeUser({ status: 'banned', banned_reason: '恶意欺诈', banned_at: NOW }),
    );
    prisma.adminOperationLog.findMany.mockResolvedValue([
      {
        id: 9n,
        admin_id: 1n,
        action: 'account.ban',
        reason: '恶意欺诈',
        detail: { duration_days: 7, source: 'manual' },
        created_at: NOW,
      },
    ]);
    prisma.adminUser.findMany.mockResolvedValue([{ id: 1n, username: 'admin' }]);

    const res = await service.detail(2n);

    expect(res.account.ban_info).toEqual({
      duration_days: 7,
      reason: '恶意欺诈',
      source: 'manual',
      banned_at: NOW.toISOString(),
    });
    expect(res.account.stats).toEqual({ publish_count: 3, order_count: 1, report_count: 0 });
    expect(res.account.operation_logs[0]).toEqual({
      time: NOW.toISOString(),
      operator: 'admin',
      action: 'account.ban',
      note: '恶意欺诈',
    });
  });

  it('未封禁账号 ban_info=null；账号不存在抛 4002', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(makeUser());
    const res = await service.detail(2n);
    expect(res.account.ban_info).toBeNull();

    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.detail(99n)).rejects.toMatchObject({ code: 4002 });
  });
});

describe('AccountService.ban（POST /admin/v1/accounts/:id/ban，@ac F21-AC2）', () => {
  it('封禁成功：回写 user + AdminLogService 留痕（含 duration_days/source）+ 通知用户', async () => {
    const { prisma, adminLog, notify, service } = setup();
    prisma.user.findUnique.mockResolvedValue(makeUser());
    prisma.user.update.mockResolvedValue(makeUser({ status: 'banned' }));

    const res = await service.ban('1', 2n, { duration_days: 7, reason: '恶意欺诈', source: 'manual' }, NOW);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 2n },
      data: { status: 'banned', banned_reason: '恶意欺诈', banned_at: NOW },
    });
    expect(adminLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        operatorId: '1',
        action: 'account.ban',
        targetType: 'user',
        targetId: 2n,
        reason: '恶意欺诈',
        detail: expect.objectContaining({ duration_days: 7, source: 'manual' }),
      }),
    );
    expect(notify.send).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 2n, type: 'report_result' }),
    );
    expect(res).toEqual({ account: { status: 'banned' } });
  });

  it('reason 空白抛 9001；duration_days 非法抛 9001', async () => {
    const { service } = setup();
    await expect(
      service.ban('1', 2n, { duration_days: 7, reason: '   ' }, NOW),
    ).rejects.toMatchObject({ code: 9001 });
    await expect(
      service.ban('1', 2n, { duration_days: 0, reason: 'x' }, NOW),
    ).rejects.toMatchObject({ code: 9001 });
    await expect(
      service.ban('1', 2n, { duration_days: -2, reason: 'x' }, NOW),
    ).rejects.toMatchObject({ code: 9001 });
  });

  it('duration_days=-1（永久）合法；账号不存在/已封禁抛 4002', async () => {
    const { prisma, adminLog, service } = setup();
    prisma.user.findUnique.mockResolvedValue(makeUser());
    prisma.user.update.mockResolvedValue(makeUser({ status: 'banned' }));
    await service.ban('1', 2n, { duration_days: -1, reason: '严重违规' }, NOW);
    expect(adminLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ detail: expect.objectContaining({ duration_days: -1 }) }),
    );

    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      service.ban('1', 99n, { duration_days: 1, reason: 'x' }, NOW),
    ).rejects.toMatchObject({ code: 4002 });

    prisma.user.findUnique.mockResolvedValue(makeUser({ status: 'banned' }));
    await expect(
      service.ban('1', 2n, { duration_days: 1, reason: 'x' }, NOW),
    ).rejects.toMatchObject({ code: 4002 });
  });
});

describe('AccountService.unban（POST /admin/v1/accounts/:id/unban）', () => {
  it('解封成功：状态回写 normal + 留痕（reason 兜底默认事由）+ 通知', async () => {
    const { prisma, adminLog, notify, service } = setup();
    prisma.user.findUnique.mockResolvedValue(
      makeUser({ status: 'banned', banned_reason: 'x', banned_at: NOW }),
    );
    prisma.user.update.mockResolvedValue(makeUser());

    const res = await service.unban('1', 2n, NOW);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 2n },
      data: { status: 'normal', banned_reason: null, banned_at: null },
    });
    expect(adminLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'account.unban',
        targetType: 'user',
        targetId: 2n,
        reason: expect.stringContaining('解封账号'),
      }),
    );
    expect(notify.send).toHaveBeenCalledWith(expect.objectContaining({ user_id: 2n }));
    expect(res).toEqual({ account: { status: 'normal' } });
  });

  it('非封禁状态抛 4002', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(makeUser());
    await expect(service.unban('1', 2n, NOW)).rejects.toMatchObject({ code: 4002 });
  });

  it('BusinessError 类型可用', () => {
    expect(new BusinessError(4002, 'x').name).toBe('BusinessError');
  });
});
