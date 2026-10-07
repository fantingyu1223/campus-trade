/**
 * account-cancel.spec.ts —— T-307 账号注销与资料删除
 * （PRD F26-AC1；模型 PIM-AG-01 已注销终态不变量；规则 CIM-R-34；技术方案 §4.1 user 注销字段组）
 *
 * 覆盖验收点：
 *  - 无在途注销成功：user.status='cancelled' + cancelled_at + 资料匿名化
 *    （nickname='已注销用户'、avatar_url 清空、real_name_masked 清空）+ 名下商品自动下架 off_sale
 *  - 在途订单（pending_delivery/pending_confirm/appealing）拦截 9001（带在途事项清单）
 *  - 未结申诉（pending/processing）拦截 9001（带在途事项清单）
 *  - wxLogin 已注销用户登录拦截 1005，不再签发 token（AG-01 不可逆、不可再登录）
 *  - GET /account/cancel/status 状态查询
 *  - POST /account/cancel 缺少登录态 uid → 1001
 *  - AG-01 不可逆不变量：源码留痕注释断言
 *
 * MVP 临时口径（T-307 任务注明）：在途校验仅覆盖在途订单 + 未结申诉两项，
 * 深度在途校验项（如求购/会话/举报等在途态）延后。
 *
 * 无真实 MySQL：PrismaService 一律 jest mock。
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  AppealStatus,
  ERROR_CODES,
  OrderStatus,
  UserStatus,
} from '@contract/index';
import { AccountCancelController } from '../../src/modules/auth/account-cancel.controller';
import { AccountCancelService } from '../../src/modules/auth/account-cancel.service';
import { AuthService, BusinessError } from '../../src/modules/auth/auth.service';
import { AuthRepository } from '../../src/modules/auth/auth.repository';
import { WxCode2SessionClient } from '../../src/infra/auth/wx-code2session.client';
import { PrismaService } from '../../src/infra/prisma.service';

// ---------- 测试夹具 ----------

const UID = '2001';

const makeUser = (over: Record<string, unknown> = {}) => ({
  id: BigInt(UID),
  openid: 'openid-cancel',
  unionid: null,
  nickname: '旧昵称',
  avatar_url: 'https://img.example.com/a.png',
  bio: '',
  identity_type: 'student',
  school_id: BigInt(10),
  status: UserStatus.NORMAL,
  real_name_masked: '张*',
  logout_requested_at: null,
  cancelled_at: null,
  last_login_at: null,
  ...over,
});

const makeOrder = (over: Record<string, unknown> = {}) => ({
  id: BigInt(9001),
  order_no: 'O20261006001',
  status: OrderStatus.PENDING_CONFIRM,
  ...over,
});

const makeAppeal = (over: Record<string, unknown> = {}) => ({
  id: BigInt(8001),
  appeal_type: 'dispute',
  status: AppealStatus.PENDING,
  ...over,
});

const makePrismaMock = () =>
  ({
    user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    tradeOrder: { findMany: jest.fn() },
    appeal: { findMany: jest.fn() },
    product: { updateMany: jest.fn() },
  }) as unknown as PrismaService & {
    user: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
    tradeOrder: { findMany: jest.Mock };
    appeal: { findMany: jest.Mock };
    product: { updateMany: jest.Mock };
  };

const setup = () => {
  const prisma = makePrismaMock();
  const service = new AccountCancelService(prisma);
  const controller = new AccountCancelController(service);
  return { prisma, service, controller };
};

// ---------- POST /account/cancel 申请注销 ----------

describe('AccountCancelService.cancel（F26-AC1，@model PIM-AG-01，@rule CIM-R-34）', () => {
  it('无在途：注销成功——status=cancelled + cancelled_at + 资料匿名化 + 商品自动下架', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(makeUser());
    prisma.tradeOrder.findMany.mockResolvedValue([]);
    prisma.appeal.findMany.mockResolvedValue([]);
    prisma.product.updateMany.mockResolvedValue({ count: 3 });
    prisma.user.update.mockResolvedValue(
      makeUser({ status: UserStatus.CANCELLED, cancelled_at: new Date() }),
    );

    const result = await service.cancel(UID, { confirm: true, reason: '毕业离校' });

    expect(result.status).toBe('cancelled');
    expect(result.cancelled_at).toBeTruthy();

    // 资料匿名化：昵称重置、头像清空、脱敏实名清空（订单/评价留痕保留，不在此删改——CIM-R-34）
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: BigInt(UID) },
        data: expect.objectContaining({
          status: UserStatus.CANCELLED,
          cancelled_at: expect.any(Date),
          nickname: '已注销用户',
          avatar_url: '',
          real_name_masked: null,
        }),
      }),
    );

    // 名下商品自动下架（跨 schema 写入 product）
    expect(prisma.product.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ seller_id: BigInt(UID) }),
        data: expect.objectContaining({ status: 'off_sale' }),
      }),
    );
  });

  it('在途订单（pending_confirm）拦截：9001 且携带在途事项清单', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(makeUser());
    prisma.tradeOrder.findMany.mockResolvedValue([makeOrder()]);
    prisma.appeal.findMany.mockResolvedValue([]);

    // 9001（MVP 临时口径，任务注明），事项清单提示先完结哪些在途订单
    await expect(service.cancel(UID, { confirm: true })).rejects.toMatchObject({
      name: 'BusinessError',
      code: ERROR_CODES.PARAM_VALIDATION_FAILED,
      data: {
        pending_orders: [
          expect.objectContaining({ order_no: 'O20261006001', status: OrderStatus.PENDING_CONFIRM }),
        ],
      },
    });
    // 拦截时不产生任何注销写入
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.product.updateMany).not.toHaveBeenCalled();
  });

  it('在途申诉（pending）拦截：9001 且携带未结申诉清单', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(makeUser());
    prisma.tradeOrder.findMany.mockResolvedValue([]);
    prisma.appeal.findMany.mockResolvedValue([makeAppeal()]);

    await expect(service.cancel(UID, { confirm: true })).rejects.toMatchObject({
      name: 'BusinessError',
      code: ERROR_CODES.PARAM_VALIDATION_FAILED,
      data: {
        pending_appeals: [expect.objectContaining({ status: AppealStatus.PENDING })],
      },
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('未二次确认（confirm!=true）→ 9001，不查询在途也不写入', async () => {
    const { prisma, service } = setup();
    await expect(service.cancel(UID, { confirm: false })).rejects.toMatchObject({
      name: 'BusinessError',
      code: ERROR_CODES.PARAM_VALIDATION_FAILED,
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('AG-01 终态幂等：已注销账号重复申请不再写入，直接返回已注销状态', async () => {
    const { prisma, service } = setup();
    const cancelledAt = new Date('2026-10-01T00:00:00Z');
    prisma.user.findUnique.mockResolvedValue(
      makeUser({ status: UserStatus.CANCELLED, cancelled_at: cancelledAt, nickname: '已注销用户' }),
    );

    const result = await service.cancel(UID, { confirm: true });

    expect(result.status).toBe('cancelled');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.product.updateMany).not.toHaveBeenCalled();
  });
});

// ---------- GET /account/cancel/status 状态查询 ----------

describe('AccountCancelService.getStatus（F26 注销状态查询）', () => {
  it('正常账号：返回 status=normal、cancelled_at=null', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(makeUser());

    const result = await service.getStatus(UID);
    expect(result.status).toBe(UserStatus.NORMAL);
    expect(result.cancelled_at).toBeNull();
  });

  it('已注销账号：返回 status=cancelled 与 cancelled_at', async () => {
    const { prisma, service } = setup();
    const cancelledAt = new Date('2026-10-01T00:00:00Z');
    prisma.user.findUnique.mockResolvedValue(
      makeUser({ status: UserStatus.CANCELLED, cancelled_at: cancelledAt }),
    );

    const result = await service.getStatus(UID);
    expect(result.status).toBe(UserStatus.CANCELLED);
    expect(result.cancelled_at).toBe(cancelledAt.toISOString());
  });

  it('用户不存在 → 1001', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.getStatus(UID)).rejects.toMatchObject({
      name: 'BusinessError',
      code: ERROR_CODES.AUTH_TOKEN_INVALID,
    });
  });
});

// ---------- 控制器：登录态缺失 ----------

describe('AccountCancelController（登录态守卫）', () => {
  it('POST /account/cancel：req.user.uid 缺失 → 1001', async () => {
    const { controller } = setup();
    await expect(
      controller.cancel({ user: undefined } as never, { confirm: true }),
    ).rejects.toMatchObject({ name: 'BusinessError', code: ERROR_CODES.AUTH_TOKEN_INVALID });
  });

  it('GET /account/cancel/status：req.user.uid 缺失 → 1001', async () => {
    const { controller } = setup();
    await expect(controller.status({ user: {} } as never)).rejects.toMatchObject({
      name: 'BusinessError',
      code: ERROR_CODES.AUTH_TOKEN_INVALID,
    });
  });
});

// ---------- AG-01：已注销终态不可再登录（wxLogin 拦截） ----------

describe('AuthService.wxLogin 已注销拦截（@model PIM-AG-01 终态不变量：不可逆、不可再登录）', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret';
  });

  it('user.status=cancelled → 拒绝登录 1005，不签发 token、不更新 last_login_at', async () => {
    const prisma = makePrismaMock();
    const repo = new AuthRepository(prisma);
    const wx = { code2session: jest.fn() } as unknown as WxCode2SessionClient & {
      code2session: jest.Mock;
    };
    const service = new AuthService(repo, wx);

    wx.code2session.mockResolvedValue({ openid: 'openid-cancel', unionid: null, session_key: 'sk' });
    prisma.user.findUnique.mockResolvedValue(makeUser({ status: UserStatus.CANCELLED }));

    // 1005（T-307 口径，任务注明）
    await expect(service.wxLogin({ code: 'valid-code' })).rejects.toMatchObject({
      name: 'BusinessError',
      code: ERROR_CODES.USER_DISABLED,
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('正常账号不受影响：status=normal 仍签发双 token', async () => {
    const prisma = makePrismaMock();
    const repo = new AuthRepository(prisma);
    const wx = { code2session: jest.fn() } as unknown as WxCode2SessionClient & {
      code2session: jest.Mock;
    };
    const service = new AuthService(repo, wx);

    wx.code2session.mockResolvedValue({ openid: 'openid-cancel', session_key: 'sk' });
    prisma.user.findUnique.mockResolvedValue(makeUser());
    prisma.user.update.mockResolvedValue(makeUser());

    const result = await service.wxLogin({ code: 'valid-code' });
    expect(result.token).toBeTruthy();
    expect(result.refresh_token).toBeTruthy();
  });
});

// ---------- AG-01 不可逆不变量：源码留痕注释断言 ----------

describe('AG-01 已注销终态不变量：源码留痕（不可逆注释断言）', () => {
  it('account-cancel.service.ts 留痕「不可逆」与 CIM-R-34 留痕口径', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../src/modules/auth/account-cancel.service.ts'),
      'utf8',
    );
    expect(src).toContain('不可逆');
    expect(src).toContain('CIM-R-34');
  });

  it('auth.service.ts 的 wxLogin 留痕已注销拦截注释', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../src/modules/auth/auth.service.ts'),
      'utf8',
    );
    expect(src).toContain('不可逆');
    expect(src).toContain('cancelled');
  });
});
