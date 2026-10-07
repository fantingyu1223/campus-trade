/**
 * admin-auth.spec.ts —— 后台管理员登录单元测试（§5.3 #51，技术方案 §2.6）
 *
 * @module PIM-BC-05
 * 覆盖：bcrypt 校验成功签发 JWT（payload 含 admin_id/role，access 2h）、
 * 账号不存在/密码错误 → 1001、账号停用 → 1003、参数校验 → 9001、
 * 签发 token 与 AdminJwtGuard 校验口径（verifyToken）互通。
 */
import * as bcrypt from 'bcryptjs';
import { AdminAuthService, BusinessError } from '../../src/modules/admin/governance/admin-auth.service';
import { AdminAuthRepository } from '../../src/modules/admin/governance/admin-auth.repository';
import { validateAdminLoginBody } from '../../src/modules/admin/governance/admin-auth.validator';
import { verifyToken } from '../../src/infra/auth/jwt.guard';

const PASSWORD = 'Admin@2026';
const HASH = bcrypt.hashSync(PASSWORD, 10);

function makeAdmin(overrides: Record<string, unknown> = {}) {
  return {
    id: 1n,
    username: 'admin',
    password_hash: HASH,
    role: 'admin',
    status: 'active',
    last_login_at: null,
    ...overrides,
  };
}

function makePrisma() {
  return {
    adminUser: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };
}

function setup() {
  const prisma = makePrisma();
  const repo = new AdminAuthRepository(prisma as never);
  const service = new AdminAuthService(repo);
  return { prisma, repo, service };
}

describe('validateAdminLoginBody（§5.3 #51 入参校验）', () => {
  it('username/password 缺失或空串抛 9001', () => {
    const errOf = (fn: () => unknown) => {
      try {
        fn();
        return null;
      } catch (e) {
        return e;
      }
    };
    expect(errOf(() => validateAdminLoginBody({}))).toMatchObject({ code: 9001 });
    expect(errOf(() => validateAdminLoginBody({ username: 'admin' }))).toMatchObject({ code: 9001 });
    expect(errOf(() => validateAdminLoginBody({ username: '', password: 'x' }))).toMatchObject({
      code: 9001,
    });
  });

  it('合法入参归一化返回', () => {
    expect(validateAdminLoginBody({ username: ' admin ', password: 'Admin@2026' })).toEqual({
      username: 'admin',
      password: 'Admin@2026',
    });
  });
});

describe('AdminAuthService.login（§5.3 #51）', () => {
  it('登录成功：签发 access_token（2h）+ refresh_token + operator，回写 last_login_at', async () => {
    const { prisma, service } = setup();
    prisma.adminUser.findFirst.mockResolvedValue(makeAdmin());
    prisma.adminUser.update.mockResolvedValue(makeAdmin());

    const res = await service.login({ username: 'admin', password: PASSWORD });

    expect(res.operator).toEqual({ id: '1', role: 'admin', name: 'admin' });
    expect(res.expires_in).toBe(7200);
    expect(typeof res.access_token).toBe('string');
    expect(typeof res.refresh_token).toBe('string');

    // access_token 可被 guard 同款 verifyToken 校验，payload 含 admin_id 与 role
    const payload = verifyToken(res.access_token);
    expect(payload.admin_id).toBe('1');
    expect(payload.role).toBe('admin');
    expect(typeof payload.exp).toBe('number');
    expect((payload.exp as number) - (payload.iat as number)).toBe(7200);

    // refresh_token 标记 token_type=refresh，TTL 长于 access
    const refresh = verifyToken(res.refresh_token);
    expect(refresh.token_type).toBe('refresh');
    expect((refresh.exp as number) - (refresh.iat as number)).toBeGreaterThan(7200);

    expect(prisma.adminUser.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1n } }),
    );
  });

  it('auditor 角色签发 role=auditor', async () => {
    const { prisma, service } = setup();
    prisma.adminUser.findFirst.mockResolvedValue(makeAdmin({ id: 2n, role: 'auditor' }));
    prisma.adminUser.update.mockResolvedValue(makeAdmin());

    const res = await service.login({ username: 'auditor1', password: PASSWORD });

    expect(res.operator.role).toBe('auditor');
    expect(verifyToken(res.access_token).role).toBe('auditor');
  });

  it('账号不存在抛 1001（不泄露账号是否存在）', async () => {
    const { prisma, service } = setup();
    prisma.adminUser.findFirst.mockResolvedValue(null);

    await expect(service.login({ username: 'ghost', password: 'x' })).rejects.toMatchObject({
      code: 1001,
    });
  });

  it('密码错误抛 1001', async () => {
    const { prisma, service } = setup();
    prisma.adminUser.findFirst.mockResolvedValue(makeAdmin());

    await expect(
      service.login({ username: 'admin', password: 'wrong-pass' }),
    ).rejects.toMatchObject({ code: 1001 });
    expect(prisma.adminUser.update).not.toHaveBeenCalled();
  });

  it('账号停用抛 1003（契约 #51：账号停用）', async () => {
    const { prisma, service } = setup();
    prisma.adminUser.findFirst.mockResolvedValue(makeAdmin({ status: 'disabled' }));

    await expect(
      service.login({ username: 'admin', password: PASSWORD }),
    ).rejects.toMatchObject({ code: 1003 });
  });

  it('占位哈希（非合法 bcrypt）视为密码错误 → 1001', async () => {
    const { prisma, service } = setup();
    prisma.adminUser.findFirst.mockResolvedValue(
      makeAdmin({ password_hash: 'placeholder-not-bcrypt' }),
    );

    await expect(
      service.login({ username: 'admin', password: PASSWORD }),
    ).rejects.toMatchObject({ code: 1001 });
  });

  it('BusinessError 类型可用（全局过滤器按 name 映射包络）', () => {
    const err = new BusinessError(1001, 'x');
    expect(err.name).toBe('BusinessError');
  });
});
