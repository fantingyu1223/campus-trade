/**
 * merchant-apply.spec.ts —— T-305 商家入驻申请提交（F32 提交侧）
 * （PRD F32-AC1；契约 §5.2 merchant #7-9；模型 PIM-BC-01/AG-10；状态机 PIM-SM-04；规则 CIM-R-25/26）
 *
 * 覆盖验收点：
 *  - #7 POST /merchant/apply：提交成功（pending + sla_deadline=submitted_at+2天，MVP 简化口径）
 *  - 缺资质图（license_image_url 必填）→ 9001
 *  - 已是商家（identity_type=merchant）→ 拦截 9001
 *  - 已有 pending 申请 → 拦截 9001
 *  - 冷却期拦截：最近一次 rejected 且 reviewed_at+30 天>now → 9001 带 cooldown_until
 *    （口径 PIM-C-4：驳回后冷却 30 天，自审核完成时刻 reviewed_at 起算）
 *  - 冷却过期（reviewed_at+30 天≤now）→ 可再提交
 *  - #8 GET /merchant/apply/status：最近一条申请状态，cooldown_until 派生
 *  - #9 GET /merchant/apply/cooldown：冷却期内返回 cooldown_until，否则 null
 *  - 无申请记录 → status 返回 none
 *
 * 无真实 MySQL：PrismaService 一律 jest mock。
 */
import { ERROR_CODES, MerchantApplicationStatus } from '@contract/index';
import { MerchantApplyController } from '../../src/modules/auth/merchant-apply.controller';
import {
  MerchantApplyService,
  MerchantCooldownError,
} from '../../src/modules/auth/merchant-apply.service';
import { MerchantApplyRepository } from '../../src/modules/auth/merchant-apply.repository';
import { validateMerchantApplyDto } from '../../src/modules/auth/merchant-apply.validator';
import { BusinessError } from '../../src/modules/auth/auth.service';
import { PrismaService } from '../../src/infra/prisma.service';

// ---------- 测试夹具 ----------

const UID = '1001';
const DAY_MS = 24 * 3600 * 1000;
const NOW = Date.now();

const makeUser = (over: Record<string, unknown> = {}) => ({
  id: BigInt(UID),
  identity_type: 'student',
  ...over,
});

const makeApplication = (over: Record<string, unknown> = {}) => ({
  id: BigInt(900),
  user_id: BigInt(UID),
  shop_name: '校内书店',
  license_image_url: 'https://img.example.com/license.jpg',
  shop_proof_image_url: null,
  contact_phone: '13800001111',
  shop_address: '学生公寓 3 号楼底商',
  status: MerchantApplicationStatus.PENDING,
  reject_reason_code: null,
  reject_reason_detail: null,
  submitted_at: new Date(NOW),
  sla_deadline: new Date(NOW + 2 * DAY_MS),
  reviewed_at: null,
  reviewer_id: null,
  cooldown_until: null,
  ...over,
});

const VALID_BODY = {
  shop_name: '校内书店',
  contact_phone: '13800001111',
  shop_address: '学生公寓 3 号楼底商',
  license_image_url: 'https://img.example.com/license.jpg',
  shop_proof_image_url: 'https://img.example.com/shop.jpg',
};

const makePrismaMock = () =>
  ({
    user: { findUnique: jest.fn() },
    merchantApplication: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    // 黑名单前置校验（T-308 起 auth 模块自含直查）：默认未命中放行
    merchantBanList: { findFirst: jest.fn().mockResolvedValue(null) },
  }) as unknown as PrismaService & {
    user: { findUnique: jest.Mock };
    merchantApplication: { findFirst: jest.Mock; create: jest.Mock };
    merchantBanList: { findFirst: jest.Mock };
  };

const setup = () => {
  const prisma = makePrismaMock();
  const repo = new MerchantApplyRepository(prisma);
  const service = new MerchantApplyService(repo);
  const controller = new MerchantApplyController(service);
  return { prisma, repo, service, controller };
};

// ---------- §5.2 #7 POST /merchant/apply ----------

describe('MerchantApplyService.apply（@api §5.2 #7，@ac F32-AC1）', () => {
  it('提交成功：创建 pending 记录，sla_deadline = submitted_at + 2 天（MVP 简化口径）', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(makeUser());
    prisma.merchantApplication.findFirst.mockResolvedValue(null);
    prisma.merchantApplication.create.mockImplementation(({ data }) =>
      Promise.resolve(makeApplication({ ...data, id: BigInt(900) })),
    );

    const res = await service.apply(UID, VALID_BODY);

    expect(res.id).toBe('900');
    expect(res.status).toBe(MerchantApplicationStatus.PENDING);
    const created = prisma.merchantApplication.create.mock.calls[0][0].data;
    expect(created.status).toBe(MerchantApplicationStatus.PENDING);
    expect(created.user_id).toBe(BigInt(UID));
    expect(created.shop_name).toBe('校内书店');
    expect(created.license_image_url).toBe(VALID_BODY.license_image_url);
    expect(created.shop_proof_image_url).toBe(VALID_BODY.shop_proof_image_url);
    expect(created.sla_deadline.getTime() - created.submitted_at.getTime()).toBe(2 * DAY_MS);
    expect(new Date(res.sla_deadline).getTime() - new Date(res.submitted_at).getTime()).toBe(
      2 * DAY_MS,
    );
  });

  it('shop_proof_image_url 可选：缺省提交成功', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(makeUser());
    prisma.merchantApplication.findFirst.mockResolvedValue(null);
    prisma.merchantApplication.create.mockImplementation(({ data }) =>
      Promise.resolve(makeApplication({ ...data })),
    );
    const body = { ...VALID_BODY } as Record<string, unknown>;
    delete body.shop_proof_image_url;

    const res = await service.apply(UID, body);
    expect(res.status).toBe(MerchantApplicationStatus.PENDING);
    expect(prisma.merchantApplication.create.mock.calls[0][0].data.shop_proof_image_url).toBeNull();
  });

  it('shop_address 可选：缺省提交成功（落库 null）', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(makeUser());
    prisma.merchantApplication.findFirst.mockResolvedValue(null);
    prisma.merchantApplication.create.mockImplementation(({ data }) =>
      Promise.resolve(makeApplication({ ...data })),
    );
    const body = { ...VALID_BODY } as Record<string, unknown>;
    delete body.shop_address;

    const res = await service.apply(UID, body);
    expect(res.status).toBe(MerchantApplicationStatus.PENDING);
    expect(prisma.merchantApplication.create.mock.calls[0][0].data.shop_address).toBeNull();
  });

  it('缺资质图 license_image_url → 9001', async () => {
    const { service } = setup();
    const body = { ...VALID_BODY } as Record<string, unknown>;
    delete body.license_image_url;

    await expect(service.apply(UID, body)).rejects.toMatchObject({
      code: ERROR_CODES.PARAM_VALIDATION_FAILED,
    });
  });

  it('用户不存在 → 1001', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.apply(UID, VALID_BODY)).rejects.toMatchObject({ code: 1001 });
  });

  it('已是商家（identity_type=merchant）→ 拦截 9001', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(makeUser({ identity_type: 'merchant' }));

    await expect(service.apply(UID, VALID_BODY)).rejects.toMatchObject({
      code: ERROR_CODES.PARAM_VALIDATION_FAILED,
    });
    expect(prisma.merchantApplication.create).not.toHaveBeenCalled();
  });

  it('已有 pending 申请 → 拦截 9001（重复提交）', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(makeUser());
    prisma.merchantApplication.findFirst.mockResolvedValue(makeApplication());

    await expect(service.apply(UID, VALID_BODY)).rejects.toMatchObject({
      code: ERROR_CODES.PARAM_VALIDATION_FAILED,
    });
    expect(prisma.merchantApplication.create).not.toHaveBeenCalled();
  });

  it('冷却期拦截：最近一次 rejected 且 reviewed_at+30 天>now → 9001 带 cooldown_until', async () => {
    const { prisma, service } = setup();
    const reviewedAt = new Date(NOW - 10 * DAY_MS); // 10 天前驳回
    prisma.user.findUnique.mockResolvedValue(makeUser());
    prisma.merchantApplication.findFirst.mockResolvedValue(
      makeApplication({
        status: MerchantApplicationStatus.REJECTED,
        reviewed_at: reviewedAt,
        reject_reason_code: 'license_unclear',
      }),
    );

    const err = (await service.apply(UID, VALID_BODY).catch((e: unknown) => e)) as MerchantCooldownError;
    expect(err).toBeInstanceOf(BusinessError);
    expect(err.code).toBe(ERROR_CODES.PARAM_VALIDATION_FAILED);
    expect(err.cooldown_until).toBe(new Date(reviewedAt.getTime() + 30 * DAY_MS).toISOString());
    expect(prisma.merchantApplication.create).not.toHaveBeenCalled();
  });

  it('冷却过期：rejected 且 reviewed_at+30 天≤now → 可再提交', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(makeUser());
    prisma.merchantApplication.findFirst.mockResolvedValue(
      makeApplication({
        status: MerchantApplicationStatus.REJECTED,
        reviewed_at: new Date(NOW - 31 * DAY_MS), // 31 天前驳回
      }),
    );
    prisma.merchantApplication.create.mockImplementation(({ data }) =>
      Promise.resolve(makeApplication({ ...data })),
    );

    const res = await service.apply(UID, VALID_BODY);
    expect(res.status).toBe(MerchantApplicationStatus.PENDING);
    expect(prisma.merchantApplication.create).toHaveBeenCalledTimes(1);
  });

  it('rejected 但 reviewed_at 为空（数据异常兜底）→ 不触发冷却，可再提交', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(makeUser());
    prisma.merchantApplication.findFirst.mockResolvedValue(
      makeApplication({ status: MerchantApplicationStatus.REJECTED, reviewed_at: null }),
    );
    prisma.merchantApplication.create.mockImplementation(({ data }) =>
      Promise.resolve(makeApplication({ ...data })),
    );

    const res = await service.apply(UID, VALID_BODY);
    expect(res.status).toBe(MerchantApplicationStatus.PENDING);
  });
});

// ---------- §5.2 #8 GET /merchant/apply/status ----------

describe('MerchantApplyService.getStatus（@api §5.2 #8，@ac F32-AC1）', () => {
  it('无申请记录 → status=none，全字段 null', async () => {
    const { prisma, service } = setup();
    prisma.merchantApplication.findFirst.mockResolvedValue(null);

    const res = await service.getStatus(UID);
    expect(res).toEqual({
      status: 'none',
      reject_reason_code: null,
      reject_reason_detail: null,
      submitted_at: null,
      reviewed_at: null,
      cooldown_until: null,
    });
  });

  it('rejected 申请：返回驳回理由码/说明，cooldown_until 派生 = reviewed_at+30 天', async () => {
    const { prisma, service } = setup();
    const reviewedAt = new Date(NOW - 5 * DAY_MS);
    prisma.merchantApplication.findFirst.mockResolvedValue(
      makeApplication({
        status: MerchantApplicationStatus.REJECTED,
        reviewed_at: reviewedAt,
        reject_reason_code: 'license_invalid',
        reject_reason_detail: '营业执照已过期',
      }),
    );

    const res = await service.getStatus(UID);
    expect(res.status).toBe(MerchantApplicationStatus.REJECTED);
    expect(res.reject_reason_code).toBe('license_invalid');
    expect(res.reject_reason_detail).toBe('营业执照已过期');
    expect(res.reviewed_at).toBe(reviewedAt.toISOString());
    expect(res.cooldown_until).toBe(new Date(reviewedAt.getTime() + 30 * DAY_MS).toISOString());
  });

  it('pending 申请：cooldown_until 为 null', async () => {
    const { prisma, service } = setup();
    prisma.merchantApplication.findFirst.mockResolvedValue(makeApplication());

    const res = await service.getStatus(UID);
    expect(res.status).toBe(MerchantApplicationStatus.PENDING);
    expect(res.cooldown_until).toBeNull();
    expect(res.reviewed_at).toBeNull();
  });
});

// ---------- §5.2 #9 GET /merchant/apply/cooldown ----------

describe('MerchantApplyService.getCooldown（@api §5.2 #9，@ac F32-AC1）', () => {
  it('冷却期内（rejected，reviewed_at+30 天>now）→ 返回 cooldown_until', async () => {
    const { prisma, service } = setup();
    const reviewedAt = new Date(NOW - 1 * DAY_MS);
    prisma.merchantApplication.findFirst.mockResolvedValue(
      makeApplication({ status: MerchantApplicationStatus.REJECTED, reviewed_at: reviewedAt }),
    );

    const res = await service.getCooldown(UID);
    expect(res.cooldown_until).toBe(new Date(reviewedAt.getTime() + 30 * DAY_MS).toISOString());
  });

  it('冷却已过期 → 返回 null', async () => {
    const { prisma, service } = setup();
    prisma.merchantApplication.findFirst.mockResolvedValue(
      makeApplication({
        status: MerchantApplicationStatus.REJECTED,
        reviewed_at: new Date(NOW - 31 * DAY_MS),
      }),
    );

    const res = await service.getCooldown(UID);
    expect(res.cooldown_until).toBeNull();
  });

  it('无申请记录 → 返回 null', async () => {
    const { prisma, service } = setup();
    prisma.merchantApplication.findFirst.mockResolvedValue(null);

    const res = await service.getCooldown(UID);
    expect(res.cooldown_until).toBeNull();
  });

  it('最近申请非 rejected → 返回 null', async () => {
    const { prisma, service } = setup();
    prisma.merchantApplication.findFirst.mockResolvedValue(makeApplication());

    const res = await service.getCooldown(UID);
    expect(res.cooldown_until).toBeNull();
  });
});

// ---------- 控制器包装（统一响应 {code,message,data}） ----------

describe('MerchantApplyController（@api §5.2 #7-9）', () => {
  const req = { user: { uid: UID } };

  it('POST /merchant/apply 包装 code=0', async () => {
    const { prisma, controller } = setup();
    prisma.user.findUnique.mockResolvedValue(makeUser());
    prisma.merchantApplication.findFirst.mockResolvedValue(null);
    prisma.merchantApplication.create.mockImplementation(({ data }) =>
      Promise.resolve(makeApplication({ ...data })),
    );

    const res = await controller.apply(req, VALID_BODY);
    expect(res.code).toBe(0);
    expect(res.data.status).toBe(MerchantApplicationStatus.PENDING);
  });

  it('GET /merchant/apply/status 包装 code=0', async () => {
    const { prisma, controller } = setup();
    prisma.merchantApplication.findFirst.mockResolvedValue(null);

    const res = await controller.status(req);
    expect(res.code).toBe(0);
    expect(res.data.status).toBe('none');
  });

  it('GET /merchant/apply/cooldown 包装 code=0', async () => {
    const { prisma, controller } = setup();
    prisma.merchantApplication.findFirst.mockResolvedValue(null);

    const res = await controller.cooldown(req);
    expect(res.code).toBe(0);
    expect(res.data.cooldown_until).toBeNull();
  });
});

// ---------- 入参校验器分支 ----------

describe('validateMerchantApplyDto（@rule CIM-R-25，9001 逐项拦截）', () => {
  const fail = (body: unknown) =>
    expect(() => validateMerchantApplyDto(body)).toThrow(BusinessError);

  it('请求体为空 → 9001', () => fail(null));
  it('缺 shop_name → 9001', () => {
    const b = { ...VALID_BODY } as Record<string, unknown>;
    delete b.shop_name;
    fail(b);
  });
  it('shop_name 超长（>128）→ 9001', () =>
    fail({ ...VALID_BODY, shop_name: 'x'.repeat(129) }));
  it('缺 contact_phone → 9001', () => {
    const b = { ...VALID_BODY } as Record<string, unknown>;
    delete b.contact_phone;
    fail(b);
  });
  it('contact_phone 格式非法 → 9001', () =>
    fail({ ...VALID_BODY, contact_phone: 'abc!' }));
  it('contact_phone 超长（>32）→ 9001', () =>
    fail({ ...VALID_BODY, contact_phone: '1'.repeat(33) }));
  it('license_image_url 超长（>512）→ 9001', () =>
    fail({ ...VALID_BODY, license_image_url: `https://x/${'y'.repeat(512)}` }));
  it('shop_proof_image_url 类型非法 → 9001', () =>
    fail({ ...VALID_BODY, shop_proof_image_url: 123 }));
  it('shop_proof_image_url 为空字符串 → 9001', () =>
    fail({ ...VALID_BODY, shop_proof_image_url: '   ' }));
  it('shop_proof_image_url 为 null → 视为缺省，通过', () => {
    const dto = validateMerchantApplyDto({ ...VALID_BODY, shop_proof_image_url: null });
    expect(dto.shop_proof_image_url).toBeUndefined();
  });
  it('shop_proof_image_url 超长（>512）→ 9001', () =>
    fail({ ...VALID_BODY, shop_proof_image_url: `https://x/${'y'.repeat(512)}` }));
  it('shop_address 类型非法 → 9001', () => fail({ ...VALID_BODY, shop_address: 1 }));
  it('shop_address 超长（>255）→ 9001', () =>
    fail({ ...VALID_BODY, shop_address: 'a'.repeat(256) }));

  it('合法入参归一化：trim 且可选字段缺省为 undefined', () => {
    const dto = validateMerchantApplyDto({
      shop_name: ' 校内书店 ',
      contact_phone: ' 13800001111 ',
      license_image_url: ' https://img.example.com/license.jpg ',
    });
    expect(dto.shop_name).toBe('校内书店');
    expect(dto.contact_phone).toBe('13800001111');
    expect(dto.license_image_url).toBe('https://img.example.com/license.jpg');
    expect(dto.shop_address).toBeUndefined();
    expect(dto.shop_proof_image_url).toBeUndefined();
  });
});
