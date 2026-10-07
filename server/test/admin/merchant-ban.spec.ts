/**
 * merchant-ban.spec.ts —— T-308 商家违禁品加重处置三件套 + 申请侧黑名单前置校验
 * （@rule CIM-R-23；模型 PIM-BC-01）
 *
 * 覆盖验收点：
 *  - executeBan 成功：商品全量下架 + 撤销 merchant 身份 + 写入 active 黑名单，
 *    三表调用齐全，返回 { banned: true, off_shelf_count }
 *  - reason 缺失/空白 → 9001
 *  - 非 merchant 用户：跳过身份撤销（user.update 不调用），下架+黑名单照常
 *  - 入驻申请前置拦截：findActiveBanByUser 命中 → 9001「该主体在禁入驻名单内，禁止入驻」
 *  - 入驻申请前置拦截：findActiveBanByPhone 命中 → 9001
 *  - 黑名单未命中 → 放行（正常创建 pending 申请）
 *
 * 无真实 MySQL：PrismaService 一律 jest mock（构造模式复用 test/auth/merchant-apply.spec.ts）。
 */
import { ERROR_CODES, MerchantApplicationStatus } from '@contract/index';
import {
  BusinessError,
  MerchantBanService,
} from '../../src/modules/admin/governance/merchant-ban.service';
import { MerchantBanRepository } from '../../src/modules/admin/governance/merchant-ban.repository';
import { MerchantApplyService } from '../../src/modules/auth/merchant-apply.service';
import { MerchantApplyRepository } from '../../src/modules/auth/merchant-apply.repository';
import { PrismaService } from '../../src/infra/prisma.service';

// ---------- 测试夹具 ----------

const ADMIN_ID = '5001';
const UID = '1001';
const NOW = Date.now();

const makePrismaMock = () =>
  ({
    product: { findMany: jest.fn(), updateMany: jest.fn() },
    user: { findUnique: jest.fn(), update: jest.fn() },
    merchantBanList: { findFirst: jest.fn(), create: jest.fn() },
    merchantApplication: { findFirst: jest.fn(), create: jest.fn() },
  }) as unknown as PrismaService & {
    product: { findMany: jest.Mock; updateMany: jest.Mock };
    user: { findUnique: jest.Mock; update: jest.Mock };
    merchantBanList: { findFirst: jest.Mock; create: jest.Mock };
    merchantApplication: { findFirst: jest.Mock; create: jest.Mock };
  };

const setupBan = () => {
  const prisma = makePrismaMock();
  const repo = new MerchantBanRepository(prisma);
  const service = new MerchantBanService(repo);
  return { prisma, repo, service };
};

const setupApply = () => {
  const prisma = makePrismaMock();
  const applyRepo = new MerchantApplyRepository(prisma);
  // 黑名单前置校验已改为 auth 模块自含直查（merchant_ban_list 属 auth schema），单参构造
  const service = new MerchantApplyService(applyRepo);
  return { prisma, service };
};

const VALID_BAN_INPUT = {
  user_id: UID,
  license_no: 'LIC-2026-0001',
  phone: '13800001111',
  reason: '售卖违禁品（管制刀具），加重处置',
};

const VALID_APPLY_BODY = {
  shop_name: '校内书店',
  contact_phone: '13800001111',
  shop_address: '学生公寓 3 号楼底商',
  license_image_url: 'https://img.example.com/license.jpg',
  shop_proof_image_url: 'https://img.example.com/shop.jpg',
};

const makeBanRow = (over: Record<string, unknown> = {}) => ({
  id: BigInt(700),
  user_id: BigInt(UID),
  license_no: 'LIC-2026-0001',
  phone: '13800001111',
  reason: '售卖违禁品',
  banned_by: BigInt(ADMIN_ID),
  status: 'active',
  created_at: new Date(NOW),
  ...over,
});

// ---------- MerchantBanService.executeBan（三件套） ----------

describe('MerchantBanService.executeBan（@rule CIM-R-23 三件套）', () => {
  it('处置成功：下架全部商品 + 撤销 merchant 身份 + 写入 active 黑名单，返回 off_shelf_count', async () => {
    const { prisma, service } = setupBan();
    prisma.product.findMany.mockResolvedValue([
      { id: BigInt(11), seller_id: BigInt(UID), status: 'on_sale' },
      { id: BigInt(12), seller_id: BigInt(UID), status: 'on_sale' },
    ]);
    prisma.product.updateMany.mockResolvedValue({ count: 2 });
    prisma.user.findUnique.mockResolvedValue({
      id: BigInt(UID),
      identity_type: 'merchant',
    });
    prisma.user.update.mockResolvedValue({});
    prisma.merchantBanList.create.mockImplementation(({ data }) =>
      Promise.resolve(makeBanRow({ ...data })),
    );

    const res = await service.executeBan(ADMIN_ID, VALID_BAN_INPUT);

    expect(res).toEqual({ banned: true, off_shelf_count: 2 });
    // 三表调用齐全
    expect(prisma.product.findMany).toHaveBeenCalledWith({
      where: { seller_id: BigInt(UID) },
    });
    expect(prisma.product.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [BigInt(11), BigInt(12)] } },
      data: { status: 'off_sale' },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: BigInt(UID) },
      data: { identity_type: 'guest' },
    });
    const created = prisma.merchantBanList.create.mock.calls[0][0].data;
    expect(created.user_id).toBe(BigInt(UID));
    expect(created.license_no).toBe(VALID_BAN_INPUT.license_no);
    expect(created.phone).toBe(VALID_BAN_INPUT.phone);
    expect(created.reason).toBe(VALID_BAN_INPUT.reason);
    expect(created.banned_by).toBe(BigInt(ADMIN_ID));
    expect(created.status).toBe('active');
  });

  it('license_no / phone 缺省 → 落库 null；无在售商品 → off_shelf_count=0 且不调用 updateMany', async () => {
    const { prisma, service } = setupBan();
    prisma.product.findMany.mockResolvedValue([]);
    prisma.user.findUnique.mockResolvedValue({
      id: BigInt(UID),
      identity_type: 'merchant',
    });
    prisma.user.update.mockResolvedValue({});
    prisma.merchantBanList.create.mockImplementation(({ data }) =>
      Promise.resolve(makeBanRow({ ...data })),
    );

    const res = await service.executeBan(ADMIN_ID, {
      user_id: UID,
      reason: '售卖违禁品',
    });

    expect(res).toEqual({ banned: true, off_shelf_count: 0 });
    expect(prisma.product.updateMany).not.toHaveBeenCalled();
    const created = prisma.merchantBanList.create.mock.calls[0][0].data;
    expect(created.license_no).toBeNull();
    expect(created.phone).toBeNull();
  });

  it('非 merchant 用户：跳过身份撤销（user.update 不调用），下架+黑名单照常', async () => {
    const { prisma, service } = setupBan();
    prisma.product.findMany.mockResolvedValue([
      { id: BigInt(11), seller_id: BigInt(UID), status: 'on_sale' },
    ]);
    prisma.product.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.findUnique.mockResolvedValue({
      id: BigInt(UID),
      identity_type: 'student',
    });
    prisma.merchantBanList.create.mockImplementation(({ data }) =>
      Promise.resolve(makeBanRow({ ...data })),
    );

    const res = await service.executeBan(ADMIN_ID, VALID_BAN_INPUT);

    expect(res).toEqual({ banned: true, off_shelf_count: 1 });
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.merchantBanList.create).toHaveBeenCalledTimes(1);
  });

  it('reason 缺失 → 9001', async () => {
    const { prisma, service } = setupBan();
    const input = { ...VALID_BAN_INPUT } as Record<string, unknown>;
    delete input.reason;

    await expect(
      service.executeBan(ADMIN_ID, input as never),
    ).rejects.toMatchObject({
      name: 'BusinessError',
      code: ERROR_CODES.PARAM_VALIDATION_FAILED,
    });
    expect(prisma.product.findMany).not.toHaveBeenCalled();
    expect(prisma.merchantBanList.create).not.toHaveBeenCalled();
  });

  it('reason 为空白字符串 → 9001', async () => {
    const { service } = setupBan();

    await expect(
      service.executeBan(ADMIN_ID, { ...VALID_BAN_INPUT, reason: '   ' }),
    ).rejects.toMatchObject({
      name: 'BusinessError',
      code: ERROR_CODES.PARAM_VALIDATION_FAILED,
    });
  });

  it('BusinessError 可由服务模块直接导入（export class BusinessError）', () => {
    const err = new BusinessError(9001, 'x');
    expect(err.code).toBe(9001);
    expect(err).toBeInstanceOf(Error);
  });
});

// ---------- 申请侧黑名单前置校验（@rule CIM-R-23 后续拦截） ----------

describe('MerchantApplyService.apply 黑名单前置校验（@rule CIM-R-23）', () => {
  it('user_id 命中 active 黑名单 → 9001「该主体在禁入驻名单内，禁止入驻」，不查用户身份', async () => {
    const { prisma, service } = setupApply();
    prisma.merchantBanList.findFirst.mockResolvedValue(makeBanRow());

    await expect(service.apply(UID, VALID_APPLY_BODY)).rejects.toMatchObject({
      code: ERROR_CODES.PARAM_VALIDATION_FAILED,
      message: '该主体在禁入驻名单内，禁止入驻',
    });
    // 前置校验先于用户身份校验：user.findUnique 不应被调用
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.merchantApplication.create).not.toHaveBeenCalled();
  });

  it('user_id 未命中但 contact_phone 命中 active 黑名单 → 9001', async () => {
    const { prisma, service } = setupApply();
    prisma.merchantBanList.findFirst
      .mockResolvedValueOnce(null) // findActiveBanByUser
      .mockResolvedValueOnce(makeBanRow({ user_id: null })); // findActiveBanByPhone

    await expect(service.apply(UID, VALID_APPLY_BODY)).rejects.toMatchObject({
      code: ERROR_CODES.PARAM_VALIDATION_FAILED,
      message: '该主体在禁入驻名单内，禁止入驻',
    });
    expect(prisma.merchantBanList.findFirst).toHaveBeenCalledTimes(2);
    expect(prisma.merchantApplication.create).not.toHaveBeenCalled();
  });

  it('黑名单未命中 → 放行：正常创建 pending 申请', async () => {
    const { prisma, service } = setupApply();
    prisma.merchantBanList.findFirst.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({
      id: BigInt(UID),
      identity_type: 'student',
    });
    prisma.merchantApplication.findFirst.mockResolvedValue(null);
    prisma.merchantApplication.create.mockImplementation(({ data }) =>
      Promise.resolve({
        id: BigInt(900),
        submitted_at: data.submitted_at,
        sla_deadline: data.sla_deadline,
        ...data,
      }),
    );

    const res = await service.apply(UID, VALID_APPLY_BODY);

    expect(res.id).toBe('900');
    expect(res.status).toBe(MerchantApplicationStatus.PENDING);
    // 前置校验两次查询均命中 null 后才继续后续流程
    expect(prisma.merchantBanList.findFirst).toHaveBeenCalledTimes(2);
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.merchantApplication.create).toHaveBeenCalledTimes(1);
  });

  it('黑名单未命中（findFirst 返回 null）→ 前置校验放行，正常提交', async () => {
    const prisma = makePrismaMock();
    const service = new MerchantApplyService(
      new MerchantApplyRepository(prisma),
    );
    prisma.merchantBanList.findFirst.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({
      id: BigInt(UID),
      identity_type: 'student',
    });
    prisma.merchantApplication.findFirst.mockResolvedValue(null);
    prisma.merchantApplication.create.mockImplementation(({ data }) =>
      Promise.resolve({
        id: BigInt(901),
        submitted_at: data.submitted_at,
        sla_deadline: data.sla_deadline,
        ...data,
      }),
    );

    const res = await service.apply(UID, VALID_APPLY_BODY);

    expect(res.id).toBe('901');
    // 自含直查后必调用黑名单查询（命中 null 才放行）
    expect(prisma.merchantBanList.findFirst).toHaveBeenCalledTimes(2);
  });
});
