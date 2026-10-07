/**
 * merchant-review.spec.ts —— 商家入驻审核单元测试（T-306）
 *
 * 覆盖：list SLA 字段与排序/申请人脱敏、detail 调阅留痕、
 * approve 状态迁移+identity_type 回写+日志、reject 枚举与 30 天冷却、
 * 9001/4002/6002 错误码、cron 超时标记与幂等跳过。
 */
import { MerchantReviewRepository } from '../../src/modules/admin/governance/merchant-review.repository';
import { MerchantReviewService } from '../../src/modules/admin/governance/merchant-review.service';
import { MerchantSlaCron } from '../../src/modules/admin/governance/merchant-sla.cron';

const NOW = new Date('2026-10-06T12:00:00.000Z');

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 101n,
    user_id: 7n,
    shop_name: '校园文具店',
    license_image_url: 'https://cdn.example.com/license/101.png',
    shop_proof_image_url: null,
    contact_phone: '13800000000',
    shop_address: null,
    status: 'pending',
    reject_reason_code: null,
    reject_reason_detail: null,
    submitted_at: new Date('2026-10-05T09:00:00.000Z'),
    sla_deadline: new Date('2026-10-07T09:00:00.000Z'),
    reviewed_at: null,
    cooldown_until: null,
    ...overrides,
  };
}

function makePrisma() {
  return {
    merchantApplication: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    user: {
      update: jest.fn(),
      findMany: jest.fn(),
    },
    adminOperationLog: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  };
}

function setup() {
  const prisma = makePrisma();
  const adminLog = { record: jest.fn().mockResolvedValue(undefined) };
  const repo = new MerchantReviewRepository(prisma as never);
  const service = new MerchantReviewService(repo, adminLog as never);
  return { prisma, repo, service, adminLog };
}

describe('MerchantReviewService.list（分页/SLA/脱敏）', () => {
  it('按 submitted_at 升序查询，返回 sla_remaining_sec/sla_overdue 与 applicant_masked', async () => {
    const { prisma, service } = setup();
    prisma.merchantApplication.findMany.mockResolvedValue([makeRow()]);
    prisma.merchantApplication.count.mockResolvedValue(1);
    prisma.user.findMany.mockResolvedValue([{ id: 7n, nickname: '张三' }]);

    const data = await service.list({}, NOW);

    expect(prisma.merchantApplication.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'pending' },
        orderBy: { submitted_at: 'asc' },
      }),
    );
    expect(data.total).toBe(1);
    const item = data.list[0];
    expect(item.applicant_masked).toBe('张***');
    // 截止 2026-10-07 09:00，距 NOW 21 小时
    expect(item.sla_remaining_sec).toBe(21 * 3600);
    expect(item.sla_overdue).toBe(false);
  });

  it('sla_deadline 已过：sla_remaining_sec=0 且 sla_overdue=true', async () => {
    const { prisma, service } = setup();
    prisma.merchantApplication.findMany.mockResolvedValue([
      makeRow({ sla_deadline: new Date('2026-10-06T11:00:00.000Z') }),
    ]);
    prisma.merchantApplication.count.mockResolvedValue(1);
    prisma.user.findMany.mockResolvedValue([{ id: 7n, nickname: '李四' }]);

    const data = await service.list({ status: 'pending' }, NOW);

    expect(data.list[0].sla_remaining_sec).toBe(0);
    expect(data.list[0].sla_overdue).toBe(true);
  });

  it('status 越界 → 9001', async () => {
    const { service } = setup();
    await expect(service.list({ status: 'cancelled' }, NOW)).rejects.toMatchObject({ code: 9001 });
  });
});

describe('MerchantReviewService.detail（调阅留痕）', () => {
  it('返回资质材料并写入 qualification.access 留痕', async () => {
    const { prisma, service, adminLog } = setup();
    prisma.merchantApplication.findUnique.mockResolvedValue(makeRow());

    const data = await service.detail('9', '101');

    expect(adminLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        operatorId: '9',
        action: 'qualification.access',
        targetType: 'merchant_application',
        targetId: '101',
        reason: '调阅商家入驻资质材料 #101',
      }),
    );
    expect(data.materials.license_image_url).toBe('https://cdn.example.com/license/101.png');
    expect(data.materials.contact_phone).toBe('13800000000');
  });

  it('不存在 → 6002，且不留痕', async () => {
    const { prisma, service, adminLog } = setup();
    prisma.merchantApplication.findUnique.mockResolvedValue(null);

    await expect(service.detail('9', '999')).rejects.toMatchObject({ code: 6002 });
    expect(adminLog.record).not.toHaveBeenCalled();
  });
});

describe('MerchantReviewService.approve', () => {
  it('迁移为 approved + 回写 user.identity_type=merchant + 留痕', async () => {
    const { prisma, service, adminLog } = setup();
    prisma.merchantApplication.findUnique.mockResolvedValue(makeRow());
    prisma.merchantApplication.updateMany.mockResolvedValue({ count: 1 });

    const data = await service.approve('9', '101');

    expect(prisma.merchantApplication.updateMany).toHaveBeenCalledWith({
      where: { id: 101n, status: 'pending' },
      data: expect.objectContaining({
        status: 'approved',
        reviewer_id: 9n,
        reviewed_at: expect.any(Date),
      }),
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 7n },
      data: { identity_type: 'merchant' },
    });
    expect(adminLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'merchant_review.approve',
        reason: '通过商家入驻申请 #101',
        detail: { shop_name: '校园文具店' },
      }),
    );
    expect(data.status).toBe('approved');
    expect(data.user_identity_type).toBe('merchant');
  });

  it('并发迁移 count=0 → 4002', async () => {
    const { prisma, service } = setup();
    prisma.merchantApplication.findUnique.mockResolvedValue(makeRow());
    prisma.merchantApplication.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.approve('9', '101')).rejects.toMatchObject({ code: 4002 });
  });

  it('非 pending → 4002', async () => {
    const { prisma, service } = setup();
    prisma.merchantApplication.findUnique.mockResolvedValue(makeRow({ status: 'approved' }));

    await expect(service.approve('9', '101')).rejects.toMatchObject({ code: 4002 });
  });

  it('不存在 → 6002', async () => {
    const { prisma, service } = setup();
    prisma.merchantApplication.findUnique.mockResolvedValue(null);

    await expect(service.approve('9', '999')).rejects.toMatchObject({ code: 6002 });
  });
});

describe('MerchantReviewService.reject', () => {
  it('合法枚举：迁移 rejected，cooldown_until = reviewed_at + 30 天', async () => {
    const { prisma, service, adminLog } = setup();
    prisma.merchantApplication.findUnique.mockResolvedValue(makeRow());
    prisma.merchantApplication.updateMany.mockResolvedValue({ count: 1 });

    const data = await service.reject('9', '101', {
      reason_code: 'license_unclear',
      note: '执照照片模糊',
    });

    const call = prisma.merchantApplication.updateMany.mock.calls[0][0];
    const reviewedAt: Date = call.data.reviewed_at;
    const cooldownUntil: Date = call.data.cooldown_until;
    expect(call.where).toEqual({ id: 101n, status: 'pending' });
    expect(call.data.status).toBe('rejected');
    expect(call.data.reject_reason_code).toBe('license_unclear');
    expect(call.data.reject_reason_detail).toBe('执照照片模糊');
    expect(cooldownUntil.getTime() - reviewedAt.getTime()).toBe(30 * 86400000);
    expect(data.cooldown_until).toBe(cooldownUntil.toISOString());
    expect(adminLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'merchant_review.reject' }),
    );
  });

  it('reason_code 越界 → 9001', async () => {
    const { service } = setup();
    await expect(
      service.reject('9', '101', { reason_code: 'not_a_code' }),
    ).rejects.toMatchObject({ code: 9001 });
  });

  it("reason_code='other' 且缺补充说明 → 9001", async () => {
    const { service } = setup();
    await expect(service.reject('9', '101', { reason_code: 'other' })).rejects.toMatchObject({
      code: 9001,
    });
  });

  it("reason_code='other' 带说明 → 通过", async () => {
    const { prisma, service } = setup();
    prisma.merchantApplication.findUnique.mockResolvedValue(makeRow());
    prisma.merchantApplication.updateMany.mockResolvedValue({ count: 1 });

    const data = await service.reject('9', '101', {
      reason_code: 'other',
      reject_reason_detail: '综合判定不符合入驻条件',
    });

    expect(data.reject_reason_code).toBe('other');
  });

  it('非 pending → 4002；不存在 → 6002', async () => {
    const { prisma, service } = setup();
    prisma.merchantApplication.findUnique.mockResolvedValue(makeRow({ status: 'rejected' }));
    await expect(
      service.reject('9', '101', { reason_code: 'blacklisted' }),
    ).rejects.toMatchObject({ code: 4002 });

    prisma.merchantApplication.findUnique.mockResolvedValue(null);
    await expect(
      service.reject('9', '999', { reason_code: 'blacklisted' }),
    ).rejects.toMatchObject({ code: 6002 });
  });
});

describe('MerchantSlaCron.runDaily（超时标记与幂等）', () => {
  function setupCron() {
    const prisma = makePrisma();
    const repo = new MerchantReviewRepository(prisma as never);
    const cron = new MerchantSlaCron(repo);
    return { prisma, cron };
  }

  it('超时未标记：写入 sla_timeout 留痕并返回标记条数', async () => {
    const { prisma, cron } = setupCron();
    prisma.merchantApplication.findMany.mockResolvedValue([{ id: 101n }, { id: 102n }]);
    prisma.adminOperationLog.findFirst.mockResolvedValue(null);

    const marked = await cron.runDaily(NOW);

    expect(prisma.merchantApplication.findMany).toHaveBeenCalledWith({
      where: { status: 'pending', sla_deadline: { lte: NOW } },
    });
    expect(prisma.adminOperationLog.create).toHaveBeenCalledTimes(2);
    expect(prisma.adminOperationLog.create).toHaveBeenCalledWith({
      data: {
        admin_id: 0n,
        action: 'merchant_review.sla_timeout',
        target_type: 'merchant_application',
        target_id: 101n,
        reason: '商家入驻审核 SLA 超时升级通知：申请 #101 已过 sla_deadline，请尽快处理',
      },
    });
    expect(marked).toBe(2);
  });

  it('已有超时标记：幂等跳过，不重复写入', async () => {
    const { prisma, cron } = setupCron();
    prisma.merchantApplication.findMany.mockResolvedValue([{ id: 101n }, { id: 102n }]);
    prisma.adminOperationLog.findFirst
      .mockResolvedValueOnce({ id: 1n })
      .mockResolvedValueOnce(null);

    const marked = await cron.runDaily(NOW);

    expect(prisma.adminOperationLog.create).toHaveBeenCalledTimes(1);
    expect(marked).toBe(1);
  });

  it('cron 开关：MERCHANT_SLA_CRON_ENABLED 未置 1 时 start 不启动', () => {
    const { cron } = setupCron();
    delete process.env.MERCHANT_SLA_CRON_ENABLED;
    cron.start();
    expect(cron.isRunning()).toBe(false);
    process.env.MERCHANT_SLA_CRON_ENABLED = '1';
    cron.start();
    expect(cron.isRunning()).toBe(true);
    cron.stop();
    expect(cron.isRunning()).toBe(false);
    delete process.env.MERCHANT_SLA_CRON_ENABLED;
  });
});
