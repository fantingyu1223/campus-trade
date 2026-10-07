/**
 * wx-login.spec.ts —— T-101 微信登录与 JWT 鉴权（PRD F1 / N1；契约 §5.2 auth #1-2）
 *
 * 覆盖验收点：
 *  - #1 登录成功签发双 token（access 7d / refresh 30d）
 *  - 新用户建档（identity=guest）、老用户更新 last_login_at
 *  - 无效 code 报 1xxx（1001）；参数缺失报 9001
 *  - JwtAuthGuard 每请求校验 user.status，非 normal 拒绝（1005）
 *  - token 缺失/伪造 1001、过期 1002
 *  - 游客路径（wx-login、商品浏览类接口）不需 token（N1）
 *  - WX_MOCK=true 时 code 直接当 openid（无微信环境可测）
 *
 * 无真实 MySQL：PrismaService 一律 jest mock。
 */
import { UnauthorizedException } from '@nestjs/common';
import { ERROR_CODES, UserIdentityType, UserStatus } from '@contract/index';
import { AuthController } from '../../src/modules/auth/auth.controller';
import { AuthService, BusinessError } from '../../src/modules/auth/auth.service';
import { AuthRepository } from '../../src/modules/auth/auth.repository';
import { validateWxLoginDto } from '../../src/modules/auth/auth.validator';
import { JwtAuthGuard, signToken, verifyToken } from '../../src/infra/auth/jwt.guard';
import { WxCode2SessionClient, WxCode2SessionError } from '../../src/infra/auth/wx-code2session.client';
import { PrismaService } from '../../src/infra/prisma.service';

// ---------- 测试夹具 ----------

const JWT_SECRET = 'test-secret';
const ACCESS_TTL = 7 * 24 * 3600;
const REFRESH_TTL = 30 * 24 * 3600;

/** 模拟 user 表记录（Prisma User 形态，id/school_id 为 BigInt） */
const makeUser = (over: Record<string, unknown> = {}) => ({
  id: BigInt(1),
  openid: 'openid-abc',
  unionid: null,
  nickname: '',
  avatar_url: '',
  bio: '',
  identity_type: UserIdentityType.GUEST,
  school_id: null,
  status: UserStatus.NORMAL,
  last_login_at: null,
  ...over,
});

const makePrismaMock = () =>
  ({
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  }) as unknown as PrismaService & {
    user: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
  };

const makeWxClientMock = () =>
  ({ code2session: jest.fn() }) as unknown as WxCode2SessionClient & { code2session: jest.Mock };

const makeContext = (headers: Record<string, string | undefined>) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ headers, user: undefined }),
    }),
  }) as never;

const decodePayload = (token: string): Record<string, unknown> =>
  JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));

beforeEach(() => {
  process.env.JWT_SECRET = JWT_SECRET;
});

// ---------- §5.2 #1 POST /auth/wx-login ----------

describe('AuthService.wxLogin（@api §5.2 #1，@ac F1）', () => {
  const setup = () => {
    const repo = new AuthRepository(makePrismaMock());
    const wx = makeWxClientMock();
    const service = new AuthService(repo, wx);
    return { repo, wx, service };
  };

  it('新用户：code2session 成功 → 建档（guest/normal）并签发双 token', async () => {
    const { repo, wx, service } = setup();
    wx.code2session.mockResolvedValue({ openid: 'openid-new', unionid: 'union-new', session_key: 'sk' });
    (repo as unknown as { prisma: ReturnType<typeof makePrismaMock> }).prisma.user.findUnique.mockResolvedValue(null);
    (repo as unknown as { prisma: ReturnType<typeof makePrismaMock> }).prisma.user.create.mockResolvedValue(
      makeUser({ id: BigInt(42), openid: 'openid-new', unionid: 'union-new' }),
    );

    const result = await service.wxLogin({ code: 'valid-code' });

    expect(wx.code2session).toHaveBeenCalledWith('valid-code');
    const prisma = (repo as unknown as { prisma: ReturnType<typeof makePrismaMock> }).prisma;
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ openid: 'openid-new', unionid: 'union-new' }),
      }),
    );
    expect(result.token).toBeTruthy();
    expect(result.refresh_token).toBeTruthy();
    // access 7 天 / refresh 30 天（§2.6）
    const access = decodePayload(result.token);
    const refresh = decodePayload(result.refresh_token);
    expect(Number(access.exp) - Number(access.iat)).toBe(ACCESS_TTL);
    expect(Number(refresh.exp) - Number(refresh.iat)).toBe(REFRESH_TTL);
    expect(access.uid).toBe('42');
    expect(refresh.type).toBe('refresh');
    // 契约响应字段 user{id, role, verified, school_id}
    expect(result.user).toEqual({ id: '42', role: 'guest', verified: false, school_id: null });
  });

  it('老用户：不重复建档，更新 last_login_at', async () => {
    const { repo, wx, service } = setup();
    wx.code2session.mockResolvedValue({ openid: 'openid-abc', session_key: 'sk' });
    const prisma = (repo as unknown as { prisma: ReturnType<typeof makePrismaMock> }).prisma;
    prisma.user.findUnique.mockResolvedValue(makeUser());
    prisma.user.update.mockResolvedValue(makeUser({ last_login_at: new Date() }));

    const result = await service.wxLogin({ code: 'valid-code' });

    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: BigInt(1) },
        data: expect.objectContaining({ last_login_at: expect.any(Date) }),
      }),
    );
    expect(result.user.id).toBe('1');
  });

  it('无效 code：code2session 失败 → 业务错误 1001', async () => {
    const { wx, service } = setup();
    wx.code2session.mockRejectedValue(new WxCode2SessionError(40029, 'invalid code'));

    await expect(service.wxLogin({ code: 'bad-code' })).rejects.toMatchObject({
      code: ERROR_CODES.AUTH_TOKEN_INVALID,
    });
  });

  it.each([{ code: '' }, { code: '   ' }, {}, { code: 123 }])(
    '参数非法（%j）→ 9001',
    async (body) => {
      const { service } = setup();
      await expect(service.wxLogin(body as { code: string })).rejects.toMatchObject({
        code: ERROR_CODES.PARAM_VALIDATION_FAILED,
      });
    },
  );
});

// ---------- §5.2 #2 GET /auth/me ----------

describe('AuthService.me（@api §5.2 #2）', () => {
  it('返回当前用户信息（含 credit_score 占位）', async () => {
    const repo = new AuthRepository(makePrismaMock());
    const service = new AuthService(repo, makeWxClientMock());
    const prisma = (repo as unknown as { prisma: ReturnType<typeof makePrismaMock> }).prisma;
    prisma.user.findUnique.mockResolvedValue(
      makeUser({ nickname: '小明', avatar_url: 'https://x/a.png', identity_type: UserIdentityType.STUDENT, school_id: BigInt(7) }),
    );

    const me = await service.me('1');

    expect(me).toEqual({
      id: '1',
      nickname: '小明',
      avatar: 'https://x/a.png',
      role: 'student',
      verified: true,
      school_id: '7',
      credit_score: null,
    });
  });

  it('用户不存在 → 1001', async () => {
    const repo = new AuthRepository(makePrismaMock());
    const service = new AuthService(repo, makeWxClientMock());
    const prisma = (repo as unknown as { prisma: ReturnType<typeof makePrismaMock> }).prisma;
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.me('999')).rejects.toMatchObject({ code: ERROR_CODES.AUTH_TOKEN_INVALID });
  });
});

// ---------- Controller 包络与游客路径（N1） ----------

describe('AuthController（统一响应包络 §5.1）', () => {
  it('wx-login 成功返回 { code:0, message:"ok", data }', async () => {
    const service = { wxLogin: jest.fn().mockResolvedValue({ token: 't', refresh_token: 'r', user: {} }) };
    const controller = new AuthController(service as unknown as AuthService);

    const res = await controller.wxLogin({ code: 'c' });

    expect(res.code).toBe(0);
    expect(res.message).toBe('ok');
    expect(res.data).toEqual({ token: 't', refresh_token: 'r', user: {} });
  });

  it('游客路径：wx-login 不挂 JwtAuthGuard（无需 token 即可调用，N1）', async () => {
    const guards = Reflect.getMetadata('__guards__', AuthController.prototype.wxLogin);
    expect(guards).toBeUndefined();
    const service = { wxLogin: jest.fn().mockResolvedValue({}) };
    const controller = new AuthController(service as unknown as AuthService);
    await expect(controller.wxLogin({ code: 'c' })).resolves.toBeDefined();
  });

  it('/auth/me 挂载 JwtAuthGuard（需 token）', () => {
    const guards = Reflect.getMetadata('__guards__', AuthController.prototype.me);
    expect(guards).toBeDefined();
    expect(JSON.stringify(guards)).toContain('JwtAuthGuard');
  });
});

// ---------- JwtAuthGuard：每请求校验 user.status（§2.6） ----------

describe('JwtAuthGuard（user.status 每请求校验）', () => {
  const setup = () => {
    const prisma = makePrismaMock();
    const guard = new JwtAuthGuard(prisma);
    return { prisma, guard };
  };

  it('normal 用户 + 合法 token → 放行并挂载 req.user', async () => {
    const { prisma, guard } = setup();
    prisma.user.findUnique.mockResolvedValue(makeUser());
    const token = signToken({ uid: '1', role: 'guest', school_id: null }, ACCESS_TTL);
    const req: { headers: Record<string, string>; user?: unknown } = {
      headers: { authorization: `Bearer ${token}` },
    };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as never;

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    // 守卫挂载口径（2026-02-06 集成修复）：uid 之外补充 id 别名与 identity_type，
    // 兼容 product/wantbuy 等 controller 的 req.user.id / req.user.identity_type 读取
    expect(req.user).toEqual({
      uid: '1',
      id: '1',
      role: 'guest',
      school_id: null,
      identity_type: 'guest',
      status: 'normal',
    });
  });

  it.each([UserStatus.BANNED, UserStatus.CANCELLED, UserStatus.READONLY, UserStatus.CLEARANCE])(
    'user.status=%s 非 normal → 拒绝 1005',
    async (status) => {
      const { prisma, guard } = setup();
      prisma.user.findUnique.mockResolvedValue(makeUser({ status }));
      const token = signToken({ uid: '1' }, ACCESS_TTL);

      await expect(guard.canActivate(makeContext({ authorization: `Bearer ${token}` }))).rejects.toMatchObject({
        response: expect.objectContaining({ code: ERROR_CODES.USER_DISABLED }),
      });
    },
  );

  it('无 Authorization 头 / 非 Bearer → 401 + 1001', async () => {
    const { guard } = setup();
    await expect(guard.canActivate(makeContext({}))).rejects.toMatchObject({
      response: expect.objectContaining({ code: ERROR_CODES.AUTH_TOKEN_INVALID }),
    });
    await expect(guard.canActivate(makeContext({ authorization: 'Basic x' }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('伪造签名 token → 1001', async () => {
    const { guard } = setup();
    const token = signToken({ uid: '1' }, ACCESS_TTL);
    const forged = token.slice(0, -2) + 'xx';
    await expect(guard.canActivate(makeContext({ authorization: `Bearer ${forged}` }))).rejects.toMatchObject({
      response: expect.objectContaining({ code: ERROR_CODES.AUTH_TOKEN_INVALID }),
    });
  });

  it('过期 token → 1002', async () => {
    const { guard } = setup();
    const token = signToken({ uid: '1' }, -10);
    await expect(guard.canActivate(makeContext({ authorization: `Bearer ${token}` }))).rejects.toMatchObject({
      response: expect.objectContaining({ code: ERROR_CODES.AUTH_TOKEN_EXPIRED }),
    });
  });

  it('token 合法但用户已不存在（注销后）→ 1001', async () => {
    const { prisma, guard } = setup();
    prisma.user.findUnique.mockResolvedValue(null);
    const token = signToken({ uid: '1' }, ACCESS_TTL);
    await expect(guard.canActivate(makeContext({ authorization: `Bearer ${token}` }))).rejects.toMatchObject({
      response: expect.objectContaining({ code: ERROR_CODES.AUTH_TOKEN_INVALID }),
    });
  });

  it('畸形 token（非三段/坏 base64）→ 1001', async () => {
    const { guard } = setup();
    await expect(guard.canActivate(makeContext({ authorization: 'Bearer not-a-jwt' }))).rejects.toMatchObject({
      response: expect.objectContaining({ code: ERROR_CODES.AUTH_TOKEN_INVALID }),
    });
  });
});

// ---------- JWT 工具 ----------

describe('JWT 工具（HS256，无第三方依赖）', () => {
  it('sign/verify 往返一致，payload 含 iat/exp', () => {
    const token = signToken({ uid: '9', role: 'student' }, 60);
    const payload = verifyToken(token);
    expect(payload.uid).toBe('9');
    expect(Number(payload.exp) - Number(payload.iat)).toBe(60);
  });

  it('密钥不匹配时 verify 失败', () => {
    const token = signToken({ uid: '9' }, 60);
    process.env.JWT_SECRET = 'another-secret';
    expect(() => verifyToken(token)).toThrow();
  });
});

// ---------- WxCode2SessionClient（env 配置 + mock 模式） ----------

describe('WxCode2SessionClient（WX_MOCK / WX_APPID / WX_SECRET）', () => {
  const OLD_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...OLD_ENV };
    jest.restoreAllMocks();
  });

  it('WX_MOCK=true：code 直接当 openid 返回，不发网络请求', async () => {
    process.env.WX_MOCK = 'true';
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const client = new WxCode2SessionClient();
    const session = await client.code2session('mock-code-1');

    expect(session.openid).toBe('mock-code-1');
    expect(session.session_key).toBe('mock-session-key');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('真实模式缺少 WX_APPID/WX_SECRET → 抛配置错误', async () => {
    delete process.env.WX_MOCK;
    delete process.env.WX_APPID;
    delete process.env.WX_SECRET;
    const client = new WxCode2SessionClient();
    await expect(client.code2session('c')).rejects.toThrow(WxCode2SessionError);
  });

  it('真实模式成功：携带 appid/secret/js_code 请求微信并返回 openid/unionid', async () => {
    process.env.WX_APPID = 'wx-appid';
    process.env.WX_SECRET = 'wx-secret';
    delete process.env.WX_MOCK;
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ openid: 'o-real', unionid: 'u-real', session_key: 'sk-real' }),
    }) as unknown as typeof fetch;

    const client = new WxCode2SessionClient();
    const session = await client.code2session('real-code');

    expect(session).toEqual({ openid: 'o-real', unionid: 'u-real', session_key: 'sk-real' });
    const url = String((global.fetch as unknown as jest.Mock).mock.calls[0][0]);
    expect(url).toContain('api.weixin.qq.com/sns/jscode2session');
    expect(url).toContain('appid=wx-appid');
    expect(url).toContain('secret=wx-secret');
    expect(url).toContain('js_code=real-code');
  });

  it('微信返回 errcode≠0 → WxCode2SessionError(errcode)', async () => {
    process.env.WX_APPID = 'wx-appid';
    process.env.WX_SECRET = 'wx-secret';
    delete process.env.WX_MOCK;
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ errcode: 40029, errmsg: 'invalid code' }),
    }) as unknown as typeof fetch;

    const client = new WxCode2SessionClient();
    await expect(client.code2session('bad')).rejects.toMatchObject({ errcode: 40029 });
  });

  it('openid 缺失（异常响应）→ WxCode2SessionError', async () => {
    process.env.WX_APPID = 'wx-appid';
    process.env.WX_SECRET = 'wx-secret';
    delete process.env.WX_MOCK;
    global.fetch = jest.fn().mockResolvedValue({ json: async () => ({}) }) as unknown as typeof fetch;

    const client = new WxCode2SessionClient();
    await expect(client.code2session('c')).rejects.toThrow(WxCode2SessionError);
  });
});

// ---------- AuthRepository（@table user，mock Prisma） ----------

describe('AuthRepository（@table user → PIM-AG-01）', () => {
  it('findByOpenid / findById 走 user 表唯一键/主键', async () => {
    const prisma = makePrismaMock();
    const repo = new AuthRepository(prisma);
    prisma.user.findUnique.mockResolvedValue(makeUser());

    await repo.findByOpenid('openid-abc');
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { openid: 'openid-abc' } });

    await repo.findById('1');
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: BigInt(1) } });
  });

  it('createUser 默认 identity=guest、status=normal、写入 last_login_at', async () => {
    const prisma = makePrismaMock();
    const repo = new AuthRepository(prisma);
    prisma.user.create.mockResolvedValue(makeUser());

    await repo.createUser('openid-new', 'union-new');

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        openid: 'openid-new',
        unionid: 'union-new',
        identity_type: 'guest',
        status: 'normal',
        last_login_at: expect.any(Date),
      }),
    });
  });

  it('unionid 缺省时写 null', async () => {
    const prisma = makePrismaMock();
    const repo = new AuthRepository(prisma);
    prisma.user.create.mockResolvedValue(makeUser());

    await repo.createUser('openid-new');

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ unionid: null }),
    });
  });

  it('updateLastLogin 按主键更新', async () => {
    const prisma = makePrismaMock();
    const repo = new AuthRepository(prisma);
    prisma.user.update.mockResolvedValue(makeUser());

    await repo.updateLastLogin(BigInt(1), new Date('2026-10-06T00:00:00Z'));

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: BigInt(1) },
      data: { last_login_at: new Date('2026-10-06T00:00:00Z') },
    });
  });
});

// ---------- Validator ----------

describe('validateWxLoginDto（参数校验 → 9001）', () => {
  it('合法 code 透传（去空白）', () => {
    expect(validateWxLoginDto({ code: '  abc  ' })).toEqual({ code: 'abc' });
  });

  it.each([null, undefined, {}, { code: '' }, { code: '  ' }, { code: 1 }, 'x'])(
    '非法输入 %j → BusinessError(9001)',
    (input) => {
      try {
        validateWxLoginDto(input as { code: string });
        fail('应当抛出 9001');
      } catch (e) {
        expect(e).toBeInstanceOf(BusinessError);
        expect((e as BusinessError).code).toBe(ERROR_CODES.PARAM_VALIDATION_FAILED);
      }
    },
  );
});
