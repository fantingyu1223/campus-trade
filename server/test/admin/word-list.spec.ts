/**
 * word-list.spec.ts —— 词表配置单元测试（§5.3 #82-86 具体化，PRD F22/F13）
 *
 * @module PIM-BC-06
 * 前端契约以 admin-web/src/api/word-list.ts DTO 为对齐基准：
 * - 契约口径 level=block/review ↔ DB RiskLevel high/mid（DB low 输出亦归 review）；
 * - 契约口径 status=enabled/disabled ↔ DB EnableStatus active/disabled；
 * - 变更写 admin_operation_log（target_type=word_list，detail 含 before/after）；
 * - 变更后触发词表快照 refresh（WordInterceptorService，§4.24 缓存+变更失效）；
 * - 写操作仅超管 admin（auditor → 6001）。
 */
import { WordListService, BusinessError } from '../../src/modules/admin/governance/word-list.service';
import { WordListRepository } from '../../src/modules/admin/governance/word-list.repository';
import { assertSuperAdmin } from '../../src/modules/admin/governance/word-list.validator';

function makeWord(overrides: Record<string, unknown> = {}) {
  return {
    id: 7n,
    word: '代考',
    type: 'prohibited',
    level: 'high',
    status: 'active',
    change_note: null,
    changed_by: null,
    created_at: new Date('2026-10-06T00:00:00.000Z'),
    updated_at: new Date('2026-10-07T00:00:00.000Z'),
    ...overrides,
  };
}

function makePrisma() {
  return {
    wordList: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    adminOperationLog: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    adminUser: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

function setup() {
  const prisma = makePrisma();
  const repo = new WordListRepository(prisma as never);
  const interceptor = { refresh: jest.fn().mockResolvedValue(undefined) };
  const service = new WordListService(repo, interceptor as never);
  return { prisma, repo, interceptor, service };
}

describe('WordListService.list（GET /admin/v1/word-lists）', () => {
  it('type 过滤直传 DB；输出 level/status 契约口径映射', async () => {
    const { prisma, service } = setup();
    prisma.wordList.findMany.mockResolvedValue([
      makeWord(),
      makeWord({ id: 8n, level: 'mid', status: 'disabled' }),
    ]);
    prisma.wordList.count.mockResolvedValue(2);

    const res = await service.list({ type: 'prohibited', page: 1, pageSize: 20 });

    expect(prisma.wordList.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { type: 'prohibited' },
        orderBy: { updated_at: 'desc' },
        skip: 0,
        take: 20,
      }),
    );
    expect(res.total).toBe(2);
    expect(res.list[0]).toMatchObject({ id: '7', word: '代考', level: 'block', status: 'enabled' });
    expect(res.list[1]).toMatchObject({ level: 'review', status: 'disabled' });
  });

  it('type 非法抛 9001', async () => {
    const { service } = setup();
    await expect(service.list({ type: 'xxx' })).rejects.toMatchObject({ code: 9001 });
  });
});

describe('WordListService.create（POST /admin/v1/word-lists）', () => {
  it('新增成功：level block→high 落库，留痕 create 并刷新快照', async () => {
    const { prisma, interceptor, service } = setup();
    prisma.wordList.findFirst.mockResolvedValue(null); // 无重复
    prisma.wordList.create.mockResolvedValue(makeWord());

    const res = await service.create('1', { word: '代考', type: 'prohibited', level: 'block' });

    expect(prisma.wordList.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ word: '代考', type: 'prohibited', level: 'high', changed_by: 1n }),
      }),
    );
    expect(prisma.adminOperationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'word_list.create',
          target_type: 'word_list',
          target_id: 7n,
          detail: expect.objectContaining({ after: expect.objectContaining({ word: '代考' }) }),
        }),
      }),
    );
    expect(interceptor.refresh).toHaveBeenCalledTimes(1);
    expect(res.word).toMatchObject({ id: '7', level: 'block', status: 'enabled' });
  });

  it('同词库词条重复抛 4002', async () => {
    const { prisma, service } = setup();
    prisma.wordList.findFirst.mockResolvedValue(makeWord());
    await expect(
      service.create('1', { word: '代考', type: 'prohibited', level: 'block' }),
    ).rejects.toMatchObject({ code: 4002 });
  });

  it('缺 word/type/level 或枚举非法抛 9001', async () => {
    const { service } = setup();
    await expect(service.create('1', { type: 'risk', level: 'block' })).rejects.toMatchObject({ code: 9001 });
    await expect(service.create('1', { word: 'x', type: 'bad', level: 'block' })).rejects.toMatchObject({ code: 9001 });
    await expect(service.create('1', { word: 'x', type: 'risk', level: 'bad' })).rejects.toMatchObject({ code: 9001 });
  });
});

describe('WordListService.update（PUT /admin/v1/word-lists/:id）', () => {
  it('修改成功：留痕含 before/after 并刷新快照', async () => {
    const { prisma, interceptor, service } = setup();
    prisma.wordList.findUnique.mockResolvedValue(makeWord());
    prisma.wordList.findFirst.mockResolvedValue(null);
    prisma.wordList.update.mockResolvedValue(makeWord({ word: '替考', level: 'mid' }));

    const res = await service.update('1', 7n, { word: '替考', type: 'prohibited', level: 'review' });

    expect(prisma.wordList.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 7n },
        data: expect.objectContaining({ word: '替考', level: 'mid' }),
      }),
    );
    expect(prisma.adminOperationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'word_list.update',
          detail: expect.objectContaining({
            before: expect.objectContaining({ word: '代考' }),
            after: expect.objectContaining({ word: '替考' }),
          }),
        }),
      }),
    );
    expect(interceptor.refresh).toHaveBeenCalledTimes(1);
    expect(res.word).toMatchObject({ level: 'review' });
  });

  it('词条不存在抛 4002', async () => {
    const { prisma, service } = setup();
    prisma.wordList.findUnique.mockResolvedValue(null);
    await expect(
      service.update('1', 99n, { word: 'x', type: 'risk', level: 'block' }),
    ).rejects.toMatchObject({ code: 4002 });
  });
});

describe('WordListService.toggle（POST /admin/v1/word-lists/:id/toggle）', () => {
  it('active→disabled，返回契约口径并刷新快照', async () => {
    const { prisma, interceptor, service } = setup();
    prisma.wordList.findUnique.mockResolvedValue(makeWord());
    prisma.wordList.update.mockResolvedValue(makeWord({ status: 'disabled' }));

    const res = await service.toggle('1', 7n);

    expect(prisma.wordList.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 7n }, data: expect.objectContaining({ status: 'disabled' }) }),
    );
    expect(prisma.adminOperationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'word_list.toggle' }) }),
    );
    expect(interceptor.refresh).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ word: { status: 'disabled' } });
  });

  it('disabled→active', async () => {
    const { prisma, service } = setup();
    prisma.wordList.findUnique.mockResolvedValue(makeWord({ status: 'disabled' }));
    prisma.wordList.update.mockResolvedValue(makeWord({ status: 'active' }));

    const res = await service.toggle('1', 7n);
    expect(prisma.wordList.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'active' }) }),
    );
    expect(res).toEqual({ word: { status: 'enabled' } });
  });
});

describe('WordListService.history（GET /admin/v1/word-lists/:id/history）', () => {
  it('从 admin_operation_log 映射 {time, operator, action, before, after}', async () => {
    const { prisma, service } = setup();
    prisma.wordList.findUnique.mockResolvedValue(makeWord());
    prisma.adminOperationLog.findMany.mockResolvedValue([
      {
        id: 3n,
        admin_id: 1n,
        action: 'word_list.toggle',
        reason: '停用违规词',
        detail: { before: { status: 'active' }, after: { status: 'disabled' } },
        created_at: new Date('2026-10-07T01:00:00.000Z'),
      },
      {
        id: 2n,
        admin_id: 1n,
        action: 'word_list.create',
        reason: '新增词条 代考',
        detail: { before: null, after: { word: '代考', type: 'prohibited' } },
        created_at: new Date('2026-10-06T01:00:00.000Z'),
      },
    ]);
    prisma.adminUser.findMany.mockResolvedValue([{ id: 1n, username: 'admin' }]);

    const res = await service.history(7n);

    expect(prisma.adminOperationLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ target_type: 'word_list', target_id: 7n }),
        orderBy: { created_at: 'desc' },
      }),
    );
    expect(res.history).toHaveLength(2);
    expect(res.history[0]).toEqual({
      time: '2026-10-07T01:00:00.000Z',
      operator: 'admin',
      action: 'toggle',
      before: { status: 'active' },
      after: { status: 'disabled' },
    });
    expect(res.history[1].action).toBe('create');
  });

  it('词条不存在抛 4002', async () => {
    const { prisma, service } = setup();
    prisma.wordList.findUnique.mockResolvedValue(null);
    await expect(service.history(99n)).rejects.toMatchObject({ code: 4002 });
  });
});

describe('角色门槛（§5.3 通用约定：词表写操作仅 admin）', () => {
  it('auditor 抛 6001，admin 放行', () => {
    expect(() => assertSuperAdmin('auditor')).toThrowError(
      expect.objectContaining({ code: 6001 }) as unknown as Error,
    );
    expect(() => assertSuperAdmin('admin')).not.toThrow();
  });

  it('BusinessError 类型可用', () => {
    expect(new BusinessError(4002, 'x').name).toBe('BusinessError');
  });
});
