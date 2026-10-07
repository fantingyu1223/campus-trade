/**
 * report-disposal.spec.ts —— 举报队列/详情/处置 + SLA cron 单元测试（T-302）
 *
 * 覆盖：queue 排序参数与 sla 字段（done→resolved 映射）、detail 匿名口径、
 * action off_shelf/ban 联动与通知、4002/9001 校验、cron 超时标记。
 */
import { ReportDisposalService, BusinessError } from '../../src/modules/admin/governance/report-disposal.service';
import { ReportRepository } from '../../src/modules/admin/governance/report.repository';
import { ReportSlaCron } from '../../src/modules/admin/governance/report-sla.cron';

const NOW = new Date('2026-10-06T12:00:00.000Z');

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 101n,
    reporter_id: 9001n,
    target_type: 'product',
    target_id: 55n,
    category: 'fraud',
    content: '涉嫌诈骗',
    evidence_urls: ['https://img/x.png'],
    status: 'pending',
    result: null,
    sla_level: 'high',
    sla_deadline: new Date('2026-10-06T13:00:00.000Z'), // 距 NOW 1h
    is_timeout: false,
    handled_by: null,
    handled_at: null,
    handle_note: null,
    created_at: new Date('2026-10-06T10:00:00.000Z'),
    updated_at: new Date('2026-10-06T10:00:00.000Z'),
    ...overrides,
  };
}

function makePrisma() {
  return {
    report: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    product: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    user: {
      update: jest.fn(),
    },
    adminOperationLog: {
      create: jest.fn(),
    },
  };
}

function setup() {
  const prisma = makePrisma();
  const repo = new ReportRepository(prisma as never);
  const notify = { send: jest.fn().mockResolvedValue(undefined) };
  const service = new ReportDisposalService(repo, notify as never);
  return { prisma, repo, notify, service };
}

describe('ReportDisposalService.getQueue（§5.3 #54）', () => {
  it('按 sla_deadline 升序查询并计算 sla 字段', async () => {
    const { prisma, service } = setup();
    prisma.report.findMany.mockResolvedValue([makeRow()]);
    prisma.report.count.mockResolvedValue(1);

    const res = await service.getQueue({}, NOW);

    expect(prisma.report.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { sla_deadline: 'asc' }, skip: 0, take: 20 }),
    );
    expect(res.total).toBe(1);
    expect(res.list[0].sla_remaining_sec).toBe(3600);
    expect(res.list[0].sla_overdue).toBe(false);
  });

  it("status='done' 映射为 DB 枚举 'resolved'", async () => {
    const { prisma, service } = setup();
    prisma.report.findMany.mockResolvedValue([]);
    prisma.report.count.mockResolvedValue(0);

    await service.getQueue({ status: 'done' }, NOW);

    expect(prisma.report.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'resolved' } }),
    );
  });

  it('过期举报 sla_remaining_sec=0 且 sla_overdue=true', async () => {
    const { prisma, service } = setup();
    prisma.report.findMany.mockResolvedValue([
      makeRow({ sla_deadline: new Date('2026-10-06T11:00:00.000Z') }),
    ]);
    prisma.report.count.mockResolvedValue(1);

    const res = await service.getQueue({}, NOW);

    expect(res.list[0].sla_remaining_sec).toBe(0);
    expect(res.list[0].sla_overdue).toBe(true);
  });

  it('pageSize 超上限抛 9001', async () => {
    const { service } = setup();
    await expect(service.getQueue({ pageSize: 51 }, NOW)).rejects.toMatchObject({ code: 9001 });
  });
});

describe('ReportDisposalService.getDetail（§5.3 #55，匿名口径 @rule CIM-R-20）', () => {
  it('响应不包含 reporter_id 与任何 reporter 字段', async () => {
    const { prisma, service } = setup();
    prisma.report.findUnique.mockResolvedValue(makeRow({ status: 'resolved', handled_at: NOW }));

    const detail = await service.getDetail(101n, NOW);
    const json = JSON.stringify(detail);

    expect(json).not.toContain('reporter_id');
    expect(json).not.toContain('reporter');
    expect(detail.status).toBe('done');
    expect(detail.timeline).toHaveLength(2);
  });

  it('举报不存在抛 4002', async () => {
    const { prisma, service } = setup();
    prisma.report.findUnique.mockResolvedValue(null);
    await expect(service.getDetail(999n, NOW)).rejects.toMatchObject({ code: 4002 });
  });
});

describe('ReportDisposalService.action（§5.3 #56）', () => {
  it('off_shelf：商品下架 + report 回写 resolved + 两条通知', async () => {
    const { prisma, notify, service } = setup();
    prisma.report.findUnique.mockResolvedValue(makeRow());
    prisma.report.update.mockResolvedValue(makeRow({ status: 'resolved' }));
    prisma.product.findUnique.mockResolvedValue({ id: 55n, seller_id: 777n, status: 'on_sale' });

    const res = await service.action('42', 101n, { result: 'off_shelf', note: '违规商品' }, NOW);

    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: 55n },
      data: { status: 'off_sale' },
    });
    expect(prisma.report.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 101n },
        data: expect.objectContaining({
          status: 'resolved',
          result: 'off_shelf',
          handled_by: 42n,
          handle_note: '违规商品',
        }),
      }),
    );
    expect(notify.send).toHaveBeenCalledTimes(2);
    // 举报人通知 payload 不含举报人身份
    expect(notify.send).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 9001n,
        type: 'report_result',
        payload: { report_id: '101', result: 'off_shelf' },
      }),
    );
    // 卖家通知
    expect(notify.send).toHaveBeenCalledWith(expect.objectContaining({ user_id: 777n }));
    expect(res).toEqual({ report: { id: '101', status: 'done', result: 'off_shelf' } });
  });

  it('ban：用户封禁回写 + 通知被举报人', async () => {
    const { prisma, notify, service } = setup();
    prisma.report.findUnique.mockResolvedValue(makeRow({ target_type: 'user', target_id: 88n }));
    prisma.report.update.mockResolvedValue(makeRow({ status: 'resolved' }));

    await service.action('42', 101n, { result: 'ban', duration_days: 7 }, NOW);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 88n },
      data: { status: 'banned', banned_reason: '违规封禁', banned_at: NOW },
    });
    expect(notify.send).toHaveBeenCalledWith(expect.objectContaining({ user_id: 88n }));
  });

  it('ban 缺少/非法 duration_days 抛 9001', async () => {
    const { service } = setup();
    await expect(service.action('42', 101n, { result: 'ban' }, NOW)).rejects.toMatchObject({
      code: 9001,
    });
    await expect(
      service.action('42', 101n, { result: 'ban', duration_days: 0 }, NOW),
    ).rejects.toMatchObject({ code: 9001 });
  });

  it('result 越界抛 4002', async () => {
    const { service } = setup();
    await expect(service.action('42', 101n, { result: 'delete' }, NOW)).rejects.toMatchObject({
      code: 4002,
    });
  });

  it('非 pending/processing 状态抛 4002', async () => {
    const { prisma, service } = setup();
    prisma.report.findUnique.mockResolvedValue(makeRow({ status: 'resolved' }));
    await expect(
      service.action('42', 101n, { result: 'warning' }, NOW),
    ).rejects.toMatchObject({ code: 4002 });
  });
});

describe('ReportSlaCron（@rule CIM-R-21）', () => {
  it('超时举报标记 is_timeout 并写升级日志（admin_id=0n 系统占位）', async () => {
    const prisma = makePrisma();
    const repo = new ReportRepository(prisma as never);
    const cron = new ReportSlaCron(prisma as never, repo);
    prisma.report.findMany.mockResolvedValue([{ id: 201n }, { id: 202n }]);

    const n = await cron.runOnce(NOW);

    expect(n).toBe(2);
    expect(prisma.report.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: { in: ['pending', 'processing'] },
          sla_deadline: { lte: NOW },
          is_timeout: false,
        },
      }),
    );
    expect(prisma.report.update).toHaveBeenCalledTimes(2);
    expect(prisma.report.update).toHaveBeenCalledWith({
      where: { id: 201n },
      data: { is_timeout: true },
    });
    expect(prisma.adminOperationLog.create).toHaveBeenCalledTimes(2);
    expect(prisma.adminOperationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          admin_id: 0n,
          action: 'report.sla_timeout',
          target_type: 'report',
          target_id: 201n,
          reason: expect.stringContaining('举报 SLA 超时升级'),
        }),
      }),
    );
  });

  it('未超时不处理', async () => {
    const prisma = makePrisma();
    const repo = new ReportRepository(prisma as never);
    const cron = new ReportSlaCron(prisma as never, repo);
    prisma.report.findMany.mockResolvedValue([]);

    const n = await cron.runOnce(NOW);

    expect(n).toBe(0);
    expect(prisma.report.update).not.toHaveBeenCalled();
    expect(prisma.adminOperationLog.create).not.toHaveBeenCalled();
  });

  it('调度开关：env 未启用时 start 不生效', () => {
    const prisma = makePrisma();
    const repo = new ReportRepository(prisma as never);
    const cron = new ReportSlaCron(prisma as never, repo);
    delete process.env.REPORT_SLA_CRON_ENABLED;
    cron.start();
    expect(cron.isRunning()).toBe(false);
    cron.stop();
  });
});
