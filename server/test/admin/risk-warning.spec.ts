/**
 * risk-warning.spec.ts —— 黄牛预警扫描与复核单元测试（T-304）
 *
 * 覆盖：三条规则触发/merchant 豁免、existsPending 幂等、
 * 列表 user_masked 脱敏、review confirm/ignore、4002/9001、cron 开关幂等。
 */
import { RiskWarningRepository } from '../../src/modules/admin/governance/risk-warning.repository';
import { RiskScanCron } from '../../src/modules/admin/governance/risk-scan.cron';
import { RiskReviewService } from '../../src/modules/admin/governance/risk-review.service';
import { maskUserId } from '../../src/modules/admin/governance/dto/risk.dto';

const NOW = new Date('2026-10-06T12:00:00.000Z');

function makePrisma() {
  return {
    product: { groupBy: jest.fn(), findMany: jest.fn() },
    violationInterceptLog: { groupBy: jest.fn() },
    user: { findMany: jest.fn() },
    riskWarning: {
      findFirst: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
}

function setupScan() {
  const prisma = makePrisma();
  // 默认空数据
  prisma.product.groupBy.mockResolvedValue([]);
  prisma.product.findMany.mockResolvedValue([]);
  prisma.violationInterceptLog.groupBy.mockResolvedValue([]);
  prisma.user.findMany.mockResolvedValue([]);
  prisma.riskWarning.findFirst.mockResolvedValue(null);
  prisma.riskWarning.create.mockResolvedValue({});
  const repo = new RiskWarningRepository(prisma as never);
  const cron = new RiskScanCron(repo);
  return { prisma, repo, cron };
}

describe('RiskScanCron.runDaily（@module PIM-BC-05 @rule CIM-R-36）', () => {
  it('daily_ge5：student 日发 5 件触发一次 createWarning', async () => {
    const { prisma, cron } = setupScan();
    prisma.product.groupBy.mockResolvedValue([{ seller_id: 7n, _count: { _all: 5 } }]);
    prisma.user.findMany.mockResolvedValue([{ id: 7n, identity_type: 'student' }]);

    const created = await cron.runDaily(NOW);

    expect(prisma.product.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ by: ['seller_id'], _count: { _all: true } }),
    );
    expect(prisma.riskWarning.create).toHaveBeenCalledTimes(1);
    expect(prisma.riskWarning.create).toHaveBeenCalledWith({
      data: {
        user_id: 7n,
        rule_code: 'daily_ge5',
        rule_snapshot: { daily_count: 5 },
        status: 'pending',
      },
    });
    expect(created).toBe(1);
  });

  it('merchant 日发 10 件：全规则均不触发', async () => {
    const { prisma, cron } = setupScan();
    prisma.product.groupBy.mockResolvedValue([{ seller_id: 8n, _count: { _all: 10 } }]);
    prisma.user.findMany.mockResolvedValue([{ id: 8n, identity_type: 'merchant' }]);

    const created = await cron.runDaily(NOW);

    expect(created).toBe(0);
    expect(prisma.riskWarning.create).not.toHaveBeenCalled();
  });

  it('cross_ge3_cat：在售跨 3 类目触发', async () => {
    const { prisma, cron } = setupScan();
    prisma.product.findMany.mockResolvedValue([
      { seller_id: 9n, category_id: 1n },
      { seller_id: 9n, category_id: 2n },
      { seller_id: 9n, category_id: 3n },
      { seller_id: 9n, category_id: 3n }, // 重复类目不计
    ]);
    prisma.user.findMany.mockResolvedValue([{ id: 9n, identity_type: 'student' }]);

    const created = await cron.runDaily(NOW);

    expect(prisma.product.findMany).toHaveBeenCalledWith({
      where: { status: 'on_sale' },
      select: { seller_id: true, category_id: true },
    });
    expect(created).toBe(1);
    expect(prisma.riskWarning.create).toHaveBeenCalledWith({
      data: {
        user_id: 9n,
        rule_code: 'cross_ge3_cat',
        rule_snapshot: { category_count: 3 },
        status: 'pending',
      },
    });
  });

  it('suspected_merchant：近 30 天 blocked ≥ 3 触发', async () => {
    const { prisma, cron } = setupScan();
    prisma.violationInterceptLog.groupBy.mockResolvedValue([
      { user_id: 11n, _count: { _all: 3 } },
    ]);
    prisma.user.findMany.mockResolvedValue([{ id: 11n, identity_type: 'staff' }]);

    const created = await cron.runDaily(NOW);

    expect(prisma.violationInterceptLog.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ by: ['user_id'], where: expect.objectContaining({ action: 'blocked' }) }),
    );
    expect(created).toBe(1);
    expect(prisma.riskWarning.create).toHaveBeenCalledWith({
      data: {
        user_id: 11n,
        rule_code: 'suspected_merchant',
        rule_snapshot: { blocked_30d: 3, daily_count: 0 },
        status: 'pending',
      },
    });
  });

  it('幂等：已存在 pending 预警时不重复创建', async () => {
    const { prisma, cron } = setupScan();
    prisma.product.groupBy.mockResolvedValue([{ seller_id: 7n, _count: { _all: 6 } }]);
    prisma.user.findMany.mockResolvedValue([{ id: 7n, identity_type: 'student' }]);
    prisma.riskWarning.findFirst.mockResolvedValue({ id: 99n, status: 'pending' });

    const created = await cron.runDaily(NOW);

    expect(created).toBe(0);
    expect(prisma.riskWarning.create).not.toHaveBeenCalled();
  });
});

describe('RiskScanCron 调度开关', () => {
  afterEach(() => {
    delete process.env.RISK_SCAN_CRON_ENABLED;
  });

  it('start/stop 幂等；env 未启用时 start 不生效', () => {
    const { cron } = setupScan();

    // 未启用
    cron.start();
    expect(cron.isRunning()).toBe(false);

    // 启用
    process.env.RISK_SCAN_CRON_ENABLED = '1';
    cron.start();
    expect(cron.isRunning()).toBe(true);
    cron.start(); // 重复 start 不报错
    expect(cron.isRunning()).toBe(true);

    cron.stop();
    expect(cron.isRunning()).toBe(false);
    cron.stop(); // 重复 stop 幂等
    expect(cron.isRunning()).toBe(false);
  });
});

describe('RiskReviewService.list', () => {
  function setup() {
    const prisma = makePrisma();
    const repo = new RiskWarningRepository(prisma as never);
    const service = new RiskReviewService(repo);
    return { prisma, service };
  }

  it('列表项携带 user_masked（***+尾4位）', async () => {
    const { prisma, service } = setup();
    prisma.riskWarning.findMany.mockResolvedValue([
      { id: 1n, user_id: 12345678n, rule_code: 'daily_ge5', status: 'pending', created_at: NOW },
    ]);
    prisma.riskWarning.count.mockResolvedValue(1);

    const res = await service.list({});

    expect(prisma.riskWarning.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'pending' }, skip: 0, take: 20 }),
    );
    expect(res.total).toBe(1);
    expect(res.list[0].user_masked).toBe('***5678');
    expect(maskUserId('42')).toBe('***42');
  });

  it("status='handled' 映射为 in ['confirmed','false_alarm']", async () => {
    const { prisma, service } = setup();
    prisma.riskWarning.findMany.mockResolvedValue([]);
    prisma.riskWarning.count.mockResolvedValue(0);

    await service.list({ status: 'handled', rule_code: 'cross_ge3_cat' });

    expect(prisma.riskWarning.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: { in: ['confirmed', 'false_alarm'] }, rule_code: 'cross_ge3_cat' },
      }),
    );
  });

  it('rule_code/status/pageSize 越界抛 9001', async () => {
    const { service } = setup();
    await expect(service.list({ rule_code: 'xxx' })).rejects.toMatchObject({ code: 9001 });
    await expect(service.list({ status: 'xxx' })).rejects.toMatchObject({ code: 9001 });
    await expect(service.list({ pageSize: 51 })).rejects.toMatchObject({ code: 9001 });
  });
});

describe('RiskReviewService.review', () => {
  function setup() {
    const prisma = makePrisma();
    const repo = new RiskWarningRepository(prisma as never);
    const service = new RiskReviewService(repo);
    return { prisma, service };
  }

  const pendingRow = {
    id: 5n,
    user_id: 777n,
    rule_code: 'daily_ge5',
    rule_snapshot: { daily_count: 5 },
    status: 'pending',
    created_at: NOW,
  };

  it('confirm + action_detail=ban：回写 confirmed，note 含 转处置（ban)', async () => {
    const { prisma, service } = setup();
    prisma.riskWarning.findUnique.mockResolvedValue(pendingRow);
    prisma.riskWarning.update.mockResolvedValue({});

    const res = await service.review('42', '5', { conclusion: 'confirm', action_detail: 'ban' });

    expect(prisma.riskWarning.update).toHaveBeenCalledWith({
      where: { id: 5n },
      data: expect.objectContaining({
        status: 'confirmed',
        handled_by: 42n,
        handled_at: expect.any(Date),
        handle_note: expect.stringContaining('转处置（ban)'),
      }),
    });
    expect(res).toEqual({ warning: { id: '5', status: 'handled', conclusion: 'confirm' } });
  });

  it('confirm 无 note 时默认线索文案', async () => {
    const { prisma, service } = setup();
    prisma.riskWarning.findUnique.mockResolvedValue(pendingRow);
    prisma.riskWarning.update.mockResolvedValue({});

    await service.review('42', '5', { conclusion: 'confirm' });

    expect(prisma.riskWarning.update).toHaveBeenCalledWith({
      where: { id: 5n },
      data: expect.objectContaining({ handle_note: '确认风险，转商家入驻核查线索' }),
    });
  });

  it('ignore：回写 false_alarm', async () => {
    const { prisma, service } = setup();
    prisma.riskWarning.findUnique.mockResolvedValue(pendingRow);
    prisma.riskWarning.update.mockResolvedValue({});

    const res = await service.review('42', '5', { conclusion: 'ignore', note: '误报' });

    expect(prisma.riskWarning.update).toHaveBeenCalledWith({
      where: { id: 5n },
      data: expect.objectContaining({ status: 'false_alarm', handle_note: '误报' }),
    });
    expect(res.warning.conclusion).toBe('ignore');
  });

  it('预警不存在或非 pending 抛 4002', async () => {
    const { prisma, service } = setup();
    prisma.riskWarning.findUnique.mockResolvedValue(null);
    await expect(service.review('42', '5', { conclusion: 'confirm' })).rejects.toMatchObject({
      code: 4002,
    });

    prisma.riskWarning.findUnique.mockResolvedValue({ ...pendingRow, status: 'confirmed' });
    await expect(service.review('42', '5', { conclusion: 'confirm' })).rejects.toMatchObject({
      code: 4002,
    });
  });

  it('conclusion/action_detail/id 越界抛 9001', async () => {
    const { service } = setup();
    await expect(service.review('42', '5', { conclusion: 'xxx' })).rejects.toMatchObject({
      code: 9001,
    });
    await expect(
      service.review('42', '5', { conclusion: 'confirm', action_detail: 'delete' }),
    ).rejects.toMatchObject({ code: 9001 });
    await expect(service.review('42', 'abc', { conclusion: 'confirm' })).rejects.toMatchObject({
      code: 9001,
    });
  });
});
