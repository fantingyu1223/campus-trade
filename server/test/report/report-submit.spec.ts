/**
 * report-submit.spec.ts —— T-301 举报提交与匿名保护（POST /reports）
 *
 * @module PIM-BC-05 举报
 * @model PIM-AG-08 举报聚合
 * @rule CIM-R-20 举报人匿名保护（reporter_id 落库但响应/读侧绝不输出）
 * @rule EV-13 同举报人同对象 24h 限 1 次（9002）
 * @table report → PIM-AG-08
 * @api §5.2 #40 POST /reports + @ac F18-AC1（提交进运营队列，受理回执）
 *
 * 覆盖验收点：
 *  - 提交成功：sla 分级映射（fraud→urgent+4h / prohibited→high+24h / false_desc,other→normal+48h）
 *    且 sla_deadline=now+对应小时数落库
 *  - 匿名保护：响应 JSON 仅 report_id+status，不含 reporter_id 及举报人身份字段
 *  - target_type 越界（merchant/chat 等）9001；理由枚举越界（harassment 等）9001
 *  - 凭证图 >9 张 9001；content 缺失/空串/超长 9001；target_id 非法 9001
 *  - 目标不存在 9001（product/user/order/want_buy/message 五类逐一）
 *  - 24h 防刷：同举报人同对象命中 → 9002 且不落库
 *  - controller：成功包络 code=0 / 未登录 1001
 *
 * 无真实 MySQL：PrismaService 一律 jest mock。
 */
import { ERROR_CODES } from '@contract/index';
import { BusinessError, ReportService } from '../../src/modules/report/report.service';
import { ReportRepository } from '../../src/modules/report/report.repository';
import { ReportController } from '../../src/modules/report/report.controller';
import { validateSubmitReport } from '../../src/modules/report/report.validator';
import { PrismaService } from '../../src/infra/prisma.service';

// ---------- 测试夹具 ----------

const REPORTER_ID = BigInt(42);
const TARGET_ID = BigInt(1001);
const REPORT_ID = BigInt(7001);
const NOW = new Date('2026-10-06T08:00:00.000Z');

const validBody = (over: Record<string, unknown> = {}) => ({
  target_type: 'product',
  target_id: TARGET_ID.toString(),
  category: 'fraud',
  content: '会话中诱导线下转账，疑似诈骗',
  evidence_urls: ['https://img.example.com/e1.png'],
  ...over,
});

const makeReportRow = (over: Record<string, unknown> = {}) => ({
  id: REPORT_ID,
  reporter_id: REPORTER_ID,
  target_type: 'product',
  target_id: TARGET_ID,
  category: 'fraud',
  content: 'x',
  evidence_urls: ['https://img.example.com/e1.png'],
  status: 'pending',
  result: null,
  sla_level: 'urgent',
  sla_deadline: new Date(NOW.getTime() + 4 * 3600 * 1000),
  is_timeout: false,
  handled_by: null,
  handled_at: null,
  handle_note: null,
  created_at: NOW,
  updated_at: NOW,
  ...over,
});

const makePrismaMock = () =>
  ({
    report: { findFirst: jest.fn(), create: jest.fn() },
    product: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    tradeOrder: { findUnique: jest.fn() },
    wantBuy: { findUnique: jest.fn() },
    message: { findUnique: jest.fn() },
  }) as unknown as PrismaService & {
    report: { findFirst: jest.Mock; create: jest.Mock };
    product: { findUnique: jest.Mock };
    user: { findUnique: jest.Mock };
    tradeOrder: { findUnique: jest.Mock };
    wantBuy: { findUnique: jest.Mock };
    message: { findUnique: jest.Mock };
  };

const setup = () => {
  const prisma = makePrismaMock();
  const repo = new ReportRepository(prisma);
  const service = new ReportService(repo);
  return { prisma, repo, service };
};

const expectBizError = async (p: Promise<unknown>, code: number) => {
  await expect(p).rejects.toMatchObject({ code });
  await p.catch((e: BusinessError) => expect(e).toBeInstanceOf(BusinessError));
};

const expectValidatorError = (raw: unknown, code: number) => {
  try {
    validateSubmitReport(raw);
    throw new Error('should have thrown');
  } catch (e) {
    expect(e).toBeInstanceOf(BusinessError);
    expect((e as BusinessError).code).toBe(code);
  }
};

/** 目标存在性 mock：按 target_type 命中对应表 */
const mockTargetExists = (prisma: ReturnType<typeof makePrismaMock>, targetType: string) => {
  const row = { id: TARGET_ID };
  const table = {
    product: prisma.product,
    user: prisma.user,
    order: prisma.tradeOrder,
    want_buy: prisma.wantBuy,
    message: prisma.message,
  }[targetType] as { findUnique: jest.Mock };
  table.findUnique.mockResolvedValue(row);
};

// ---------- 提交成功 + SLA 分级 ----------

describe('POST /reports 提交成功：SLA 分级与 deadline 落库', () => {
  it.each([
    ['fraud', 'urgent', 4],
    ['prohibited', 'high', 24],
    ['false_desc', 'normal', 48],
    ['other', 'normal', 48],
  ])('category=%s → sla_level=%s, deadline=now+%dh', async (category, slaLevel, hours) => {
    const { prisma, service } = setup();
    mockTargetExists(prisma, 'product');
    prisma.report.findFirst.mockResolvedValue(null);
    prisma.report.create.mockResolvedValue(makeReportRow({ category, sla_level: slaLevel }));

    const result = await service.submitReport(REPORTER_ID, validBody({ category }), NOW);

    expect(result).toEqual({ report_id: REPORT_ID.toString(), status: 'pending' });
    const created = prisma.report.create.mock.calls[0][0].data;
    expect(created.sla_level).toBe(slaLevel);
    expect(created.sla_deadline).toEqual(new Date(NOW.getTime() + hours * 3600 * 1000));
    expect(created.reporter_id).toBe(REPORTER_ID); // 落库保留（平台侧可见）
    expect(created.status).toBe('pending');
  });

  it('响应 JSON 不含 reporter_id（CIM-R-20 匿名保护断言）', async () => {
    const { prisma, service } = setup();
    mockTargetExists(prisma, 'product');
    prisma.report.findFirst.mockResolvedValue(null);
    prisma.report.create.mockResolvedValue(makeReportRow());

    const result = await service.submitReport(REPORTER_ID, validBody(), NOW);

    expect(Object.keys(result).sort()).toEqual(['report_id', 'status']);
    expect(result).not.toHaveProperty('reporter_id');
    expect(JSON.stringify(result)).not.toContain(REPORTER_ID.toString());
  });

  it('契约字段别名兼容：type/desc/evidence 与 category/content/evidence_urls 等价', async () => {
    const { prisma, service } = setup();
    mockTargetExists(prisma, 'product');
    prisma.report.findFirst.mockResolvedValue(null);
    prisma.report.create.mockResolvedValue(makeReportRow());

    const result = await service.submitReport(
      REPORTER_ID,
      {
        target_type: 'product',
        target_id: TARGET_ID.toString(),
        type: 'fraud',
        desc: '诱导线下转账',
        evidence: ['https://img.example.com/e1.png'],
      },
      NOW,
    );
    expect(result.status).toBe('pending');
    const created = prisma.report.create.mock.calls[0][0].data;
    expect(created.category).toBe('fraud');
    expect(created.content).toBe('诱导线下转账');
  });

  it.each(['user', 'order', 'want_buy', 'message'])('target_type=%s 存在性校验命中对应表可提交', async (t) => {
    const { prisma, service } = setup();
    mockTargetExists(prisma, t);
    prisma.report.findFirst.mockResolvedValue(null);
    prisma.report.create.mockResolvedValue(makeReportRow({ target_type: t }));

    const result = await service.submitReport(REPORTER_ID, validBody({ target_type: t }), NOW);
    expect(result.report_id).toBe(REPORT_ID.toString());
  });
});

// ---------- 9001 参数校验 ----------

describe('POST /reports 参数校验（9001）', () => {
  it.each(['merchant', 'chat', 'goods', '', 'PRODUCT'])('target_type 越界 %s → 9001', (t) => {
    expectValidatorError(validBody({ target_type: t }), ERROR_CODES.PARAM_VALIDATION_FAILED);
  });

  it.each(['harassment', 'offline_risk', 'spam', ''])('理由枚举越界 %s → 9001', (c) => {
    expectValidatorError(validBody({ category: c }), ERROR_CODES.PARAM_VALIDATION_FAILED);
  });

  it('凭证图 >9 张 → 9001', () => {
    const ten = Array.from({ length: 10 }, (_, i) => `https://img.example.com/e${i}.png`);
    expectValidatorError(validBody({ evidence_urls: ten }), ERROR_CODES.PARAM_VALIDATION_FAILED);
  });

  it('凭证可缺省（undefined/null → 空数组）', () => {
    expect(validateSubmitReport(validBody({ evidence_urls: undefined })).evidenceUrls).toEqual([]);
    expect(validateSubmitReport(validBody({ evidence_urls: null })).evidenceUrls).toEqual([]);
  });

  it('凭证非数组 → 9001', () => {
    expectValidatorError(validBody({ evidence_urls: 'x' }), ERROR_CODES.PARAM_VALIDATION_FAILED);
  });

  it('target_id 支持 number 类型正整数', () => {
    expect(validateSubmitReport(validBody({ target_id: 1001 })).targetId).toBe(TARGET_ID);
  });

  it('凭证含非字符串/空串 → 9001', () => {
    expectValidatorError(validBody({ evidence_urls: ['ok', 123] }), ERROR_CODES.PARAM_VALIDATION_FAILED);
    expectValidatorError(validBody({ evidence_urls: ['  '] }), ERROR_CODES.PARAM_VALIDATION_FAILED);
  });

  it('content 缺失/空串/超 500 字 → 9001', () => {
    const b = validBody();
    delete (b as Record<string, unknown>).content;
    expectValidatorError(b, ERROR_CODES.PARAM_VALIDATION_FAILED);
    expectValidatorError(validBody({ content: '   ' }), ERROR_CODES.PARAM_VALIDATION_FAILED);
    expectValidatorError(validBody({ content: 'x'.repeat(501) }), ERROR_CODES.PARAM_VALIDATION_FAILED);
  });

  it('target_id 缺失/非正整数 → 9001', () => {
    expectValidatorError(validBody({ target_id: 'abc' }), ERROR_CODES.PARAM_VALIDATION_FAILED);
    expectValidatorError(validBody({ target_id: '0' }), ERROR_CODES.PARAM_VALIDATION_FAILED);
    const b = validBody();
    delete (b as Record<string, unknown>).target_id;
    expectValidatorError(b, ERROR_CODES.PARAM_VALIDATION_FAILED);
  });

  it('请求体非对象 → 9001', () => {
    expectValidatorError(null, ERROR_CODES.PARAM_VALIDATION_FAILED);
    expectValidatorError('x', ERROR_CODES.PARAM_VALIDATION_FAILED);
  });
});

// ---------- 目标不存在 ----------

describe('POST /reports 目标存在性校验（9001）', () => {
  it.each([
    ['product', 'product'],
    ['user', 'user'],
    ['order', 'tradeOrder'],
    ['want_buy', 'wantBuy'],
    ['message', 'message'],
  ])('target_type=%s 目标不存在 → 9001 且不落库', async (targetType, table) => {
    const { prisma, service } = setup();
    (prisma as unknown as Record<string, { findUnique: jest.Mock }>)[table].findUnique.mockResolvedValue(null);

    await expectBizError(
      service.submitReport(REPORTER_ID, validBody({ target_type: targetType }), NOW),
      ERROR_CODES.PARAM_VALIDATION_FAILED,
    );
    expect(prisma.report.create).not.toHaveBeenCalled();
  });
});

// ---------- 24h 防刷 ----------

describe('POST /reports 防刷（EV-13：同举报人同对象 24h 限 1 次）', () => {
  it('24h 内已有同对象举报 → 9002 且不落库', async () => {
    const { prisma, service } = setup();
    mockTargetExists(prisma, 'product');
    prisma.report.findFirst.mockResolvedValue(makeReportRow({ created_at: new Date(NOW.getTime() - 3600 * 1000) }));

    await expectBizError(service.submitReport(REPORTER_ID, validBody(), NOW), ERROR_CODES.RATE_LIMITED);
    expect(prisma.report.create).not.toHaveBeenCalled();
    // 防刷查询口径：同举报人 + 同 target_type + 同 target_id + created_at ≥ now-24h
    const where = prisma.report.findFirst.mock.calls[0][0].where;
    expect(where.reporter_id).toBe(REPORTER_ID);
    expect(where.target_type).toBe('product');
    expect(where.target_id).toBe(TARGET_ID);
    expect(where.created_at.gte).toEqual(new Date(NOW.getTime() - 24 * 3600 * 1000));
  });

  it('24h 前旧举报不拦截（findFirst 返回 null）→ 可再次提交', async () => {
    const { prisma, service } = setup();
    mockTargetExists(prisma, 'product');
    prisma.report.findFirst.mockResolvedValue(null);
    prisma.report.create.mockResolvedValue(makeReportRow());

    const result = await service.submitReport(REPORTER_ID, validBody(), NOW);
    expect(result.status).toBe('pending');
  });
});

// ---------- Controller ----------

describe('ReportController POST /reports', () => {
  it('成功：统一包络 code=0，data 仅 report_id+status', async () => {
    const { prisma, service } = setup();
    mockTargetExists(prisma, 'product');
    prisma.report.findFirst.mockResolvedValue(null);
    prisma.report.create.mockResolvedValue(makeReportRow());
    const controller = new ReportController(service);

    const res = await controller.submit(validBody(), { user: { uid: REPORTER_ID.toString() } });

    expect(res.code).toBe(0);
    expect(res.data).toEqual({ report_id: REPORT_ID.toString(), status: 'pending' });
    expect(JSON.stringify(res)).not.toContain('"reporter_id"');
  });

  it('未登录 → 1001', async () => {
    const { service } = setup();
    const controller = new ReportController(service);
    await expectBizError(controller.submit(validBody(), { user: undefined }), ERROR_CODES.AUTH_TOKEN_INVALID);
    await expectBizError(controller.submit(validBody(), { user: {} }), ERROR_CODES.AUTH_TOKEN_INVALID);
  });
});
