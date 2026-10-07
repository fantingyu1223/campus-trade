/**
 * word-interceptor.spec.ts —— T-303 违规词拦截器治理侧（infra 通用拦截器）
 *
 * @module infra/word-interceptor（F22 治理侧，各模块本地消费，不跨模块 import）
 * @rule CIM-R-08 文本命中违规词表一律拦截，拦截记录留痕供运营复核
 * @table word_list（§4.24 只读快照）/ violation_intercept_log（§4.23 留痕，→ PIM-BC-06）
 * @ac F22-AC1 命中违规词提交被拦截并留痕，运营可在后台查看
 *
 * 覆盖验收点：
 *  - 命中拦截：返回 blocked=true + hits，且每命中词写一条 violation_intercept_log
 *    （五要素：scene/hit_word/content_hash(sha256 前16位)/user_id/action='blocked'/target_id）
 *  - 未命中放行：blocked=false，hits=[]，不写日志
 *  - 多词命中：写多条日志
 *  - 词表为空：降级放行不拦截（防御性兜底）
 *  - refresh()：词表配置变更事件触发刷新后新词立即生效
 *  - scene 越界：9001 PARAM_VALIDATION_FAILED，不落库
 *  - 读侧：InterceptLogRepository 按 user/scene 过滤分页（created_at 倒序）
 *
 * 无真实 MySQL：PrismaService 一律 jest mock（同 notification.spec.ts 口径）。
 */
import { createHash } from 'node:crypto';
import { ERROR_CODES } from '@contract/index';
import { PrismaService } from '../../src/infra/prisma.service';
import {
  BusinessError,
  WordInterceptorService,
} from '../../src/infra/word-interceptor/word-interceptor.service';
import { InterceptLogRepository } from '../../src/infra/word-interceptor/intercept-log.repository';

// ---------- 测试夹具 ----------

const UID = '7';
const UID_BIGINT = BigInt(7);

/** sha256(text) 前 16 位（与实现同算法，独立计算验证） */
const hash16 = (text: string) =>
  createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);

const makeWordRow = (word: string, over: Record<string, unknown> = {}) => ({
  id: BigInt(1),
  word,
  type: 'violation',
  level: 'high',
  status: 'active',
  change_note: null,
  changed_by: null,
  created_at: new Date('2026-10-06T08:00:00.000Z'),
  updated_at: new Date('2026-10-06T08:00:00.000Z'),
  ...over,
});

const makeLogRow = (over: Record<string, unknown> = {}) => ({
  id: BigInt(101),
  scene: 'product_publish',
  user_id: UID_BIGINT,
  target_id: BigInt(55),
  hit_word: '假货',
  content_snapshot: hash16('出售假货，加V：abc123'),
  action: 'blocked',
  created_at: new Date('2026-10-06T09:00:00.000Z'),
  ...over,
});

const makePrismaMock = () =>
  ({
    wordList: {
      findMany: jest.fn(),
    },
    violationInterceptLog: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
  }) as unknown as PrismaService & {
    wordList: { findMany: jest.Mock };
    violationInterceptLog: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
  };

const setup = (words: Array<ReturnType<typeof makeWordRow>> = []) => {
  const prisma = makePrismaMock();
  prisma.wordList.findMany.mockResolvedValue(words);
  const repo = new InterceptLogRepository(prisma);
  const service = new WordInterceptorService(prisma, repo);
  return { prisma, repo, service };
};

// ---------- WordInterceptorService.intercept ----------

describe('WordInterceptorService.intercept 命中拦截（@rule CIM-R-08，@ac F22-AC1）', () => {
  it('命中违规词 → blocked=true + hits，写 violation_intercept_log 五要素（含 content_hash 与 action=blocked）', async () => {
    const { prisma, service } = setup([makeWordRow('假货')]);
    prisma.violationInterceptLog.create.mockResolvedValue(makeLogRow());
    const text = '出售假货，加V：abc123';

    const result = await service.intercept({
      scene: 'product_publish',
      userId: UID,
      text,
      targetId: '55',
    });

    expect(result).toEqual({ blocked: true, hits: ['假货'] });
    expect(prisma.violationInterceptLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.violationInterceptLog.create).toHaveBeenCalledWith({
      data: {
        scene: 'product_publish',
        user_id: UID_BIGINT,
        target_id: BigInt(55),
        hit_word: '假货',
        content_snapshot: hash16(text),
        action: 'blocked',
      },
    });
  });

  it('只加载 word_list 中 type=violation 且 status=active 的词（本地只读快照）', async () => {
    const { prisma, service } = setup([makeWordRow('假货')]);
    prisma.violationInterceptLog.create.mockResolvedValue(makeLogRow());

    await service.intercept({ scene: 'product_edit', userId: UID, text: '无命中文本' });

    expect(prisma.wordList.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.wordList.findMany.mock.calls[0][0].where).toEqual({
      type: 'violation',
      status: 'active',
    });
  });

  it('未命中 → blocked=false + hits=[]，不写留痕日志', async () => {
    const { prisma, service } = setup([makeWordRow('假货')]);

    const result = await service.intercept({
      scene: 'profile_edit',
      userId: UID,
      text: '普通个人简介',
    });

    expect(result).toEqual({ blocked: false, hits: [] });
    expect(prisma.violationInterceptLog.create).not.toHaveBeenCalled();
  });

  it('多词命中 → hits 全收，每词写一条留痕日志', async () => {
    const { prisma, service } = setup([makeWordRow('假货'), makeWordRow('走私')]);
    prisma.violationInterceptLog.create.mockResolvedValue(makeLogRow());
    const text = '假货与走私货都有';

    const result = await service.intercept({
      scene: 'want_buy',
      userId: UID,
      text,
    });

    expect(result).toEqual({ blocked: true, hits: ['假货', '走私'] });
    expect(prisma.violationInterceptLog.create).toHaveBeenCalledTimes(2);
    const words = prisma.violationInterceptLog.create.mock.calls.map(
      (c) => c[0].data.hit_word,
    );
    expect(words).toEqual(['假货', '走私']);
    for (const call of prisma.violationInterceptLog.create.mock.calls) {
      expect(call[0].data.content_snapshot).toBe(hash16(text));
      expect(call[0].data.action).toBe('blocked');
    }
  });

  it('词表为空 → 降级放行（不拦截、不写日志）', async () => {
    const { prisma, service } = setup([]);

    const result = await service.intercept({
      scene: 'message',
      userId: UID,
      text: '假货',
    });

    expect(result).toEqual({ blocked: false, hits: [] });
    expect(prisma.violationInterceptLog.create).not.toHaveBeenCalled();
  });

  it('快照缓存：多次 intercept 只加载一次词表；refresh() 后新词立即生效', async () => {
    const { prisma, service } = setup([makeWordRow('假货')]);

    await service.intercept({ scene: 'comment', userId: UID, text: '正常评论' });
    await service.intercept({ scene: 'comment', userId: UID, text: '正常评论2' });
    expect(prisma.wordList.findMany).toHaveBeenCalledTimes(1);

    // 词表配置变更事件触发刷新：新词「代购」入库生效
    prisma.wordList.findMany.mockResolvedValue([makeWordRow('假货'), makeWordRow('代购')]);
    prisma.violationInterceptLog.create.mockResolvedValue(makeLogRow());
    await service.refresh();

    const result = await service.intercept({
      scene: 'message',
      userId: UID,
      text: '可以代购吗',
    });
    expect(result).toEqual({ blocked: true, hits: ['代购'] });
    expect(prisma.wordList.findMany).toHaveBeenCalledTimes(2);
  });

  it('scene 越界 → 9001 PARAM_VALIDATION_FAILED，不读词表不落库', async () => {
    const { prisma, service } = setup([makeWordRow('假货')]);

    await expect(
      service.intercept({
        scene: 'not_a_scene' as never,
        userId: UID,
        text: '假货',
      }),
    ).rejects.toMatchObject({
      name: 'BusinessError',
      code: ERROR_CODES.PARAM_VALIDATION_FAILED,
    });
    await expect(
      service.intercept({ scene: '' as never, userId: UID, text: '假货' }),
    ).rejects.toBeInstanceOf(BusinessError);
    expect(prisma.wordList.findMany).not.toHaveBeenCalled();
    expect(prisma.violationInterceptLog.create).not.toHaveBeenCalled();
  });

  it('targetId 省略时落 NULL（拦截未落库场景）', async () => {
    const { prisma, service } = setup([makeWordRow('假货')]);
    prisma.violationInterceptLog.create.mockResolvedValue(makeLogRow({ target_id: null }));

    await service.intercept({ scene: 'product_publish', userId: UID, text: '假货' });

    expect(prisma.violationInterceptLog.create.mock.calls[0][0].data.target_id).toBeNull();
  });
});

// ---------- InterceptLogRepository 读侧分页 ----------

describe('InterceptLogRepository.findPage 按 user/scene 分页（@table violation_intercept_log → PIM-BC-06）', () => {
  it('按 user_id + scene 过滤，created_at 倒序分页，返回 list + total', async () => {
    const { prisma, repo } = setup();
    prisma.violationInterceptLog.findMany.mockResolvedValue([makeLogRow()]);
    prisma.violationInterceptLog.count.mockResolvedValue(21);

    const result = await repo.findPage(
      { userId: UID_BIGINT, scene: 'product_publish' },
      2,
      20,
    );

    expect(prisma.violationInterceptLog.findMany).toHaveBeenCalledWith({
      where: { user_id: UID_BIGINT, scene: 'product_publish' },
      orderBy: { created_at: 'desc' },
      skip: 20,
      take: 20,
    });
    expect(prisma.violationInterceptLog.count).toHaveBeenCalledWith({
      where: { user_id: UID_BIGINT, scene: 'product_publish' },
    });
    expect(result.total).toBe(21);
    expect(result.list).toHaveLength(1);
  });

  it('过滤条件可选：仅 scene 时 where 不带 user_id；无条件时 where 为空', async () => {
    const { prisma, repo } = setup();
    prisma.violationInterceptLog.findMany.mockResolvedValue([]);
    prisma.violationInterceptLog.count.mockResolvedValue(0);

    await repo.findPage({ scene: 'want_buy' }, 1, 10);
    expect(prisma.violationInterceptLog.findMany.mock.calls[0][0].where).toEqual({
      scene: 'want_buy',
    });

    await repo.findPage({}, 1, 10);
    expect(prisma.violationInterceptLog.findMany.mock.calls[1][0].where).toEqual({});
  });

  it('默认分页 page=1/pageSize=20（skip=0/take=20）', async () => {
    const { prisma, repo } = setup();
    prisma.violationInterceptLog.findMany.mockResolvedValue([]);
    prisma.violationInterceptLog.count.mockResolvedValue(0);

    await repo.findPage({ userId: UID_BIGINT });

    expect(prisma.violationInterceptLog.findMany.mock.calls[0][0]).toMatchObject({
      skip: 0,
      take: 20,
    });
  });
});
