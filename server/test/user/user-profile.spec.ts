/**
 * user-profile.spec.ts —— T-108 个人/商家主页公开档案（PRD F2 / N6；契约 §5.2 user #46）
 *
 * 覆盖验收点：
 *  - F2-AC1：主页返回昵称/头像/身份标识/学校/在售已售列表/评价摘要占位，
 *            学号、资质材料等实名信息不出现（N6）
 *  - F2-AC2：商家账号返回「认证商家」标识（is_merchant=true，与 F33 全链路亮标一致）
 *  - N6：响应 JSON 全文不含 student_no / license / openid / real_name 等实名与凭证字段
 *  - 契约 #46 错误码：用户不存在/已注销 → 1001；id 非法 → 9001
 *  - 实名不出站守卫 assertNoRealNameLeak：白名单之外的敏感键一旦出现即抛错
 *
 * 无真实 MySQL：PrismaService 一律 jest mock（同 wx-login.spec.ts 口径）。
 */
import { ERROR_CODES, UserIdentityType, UserStatus } from '@contract/index';
import { UserController } from '../../src/modules/user/user.controller';
import { UserService, BusinessError, assertNoRealNameLeak } from '../../src/modules/user/user.service';
import { UserRepository } from '../../src/modules/user/user.repository';
import { validateUserIdParam, validateUpdateProfileFields } from '../../src/modules/user/user.validator';
import { PrismaService } from '../../src/infra/prisma.service';

// ---------- 测试夹具 ----------

/** 模拟 user 表记录（Prisma User 形态，id/school_id 为 BigInt） */
const makeUser = (over: Record<string, unknown> = {}) => ({
  id: BigInt(1),
  openid: 'openid-secret',
  unionid: 'union-secret',
  nickname: '小明',
  avatar_url: 'https://cdn/x/a.png',
  bio: '出闲置教材',
  is_anonymous: false,
  identity_type: UserIdentityType.STUDENT,
  school_id: BigInt(7),
  status: UserStatus.NORMAL,
  banned_reason: null,
  banned_at: null,
  last_login_at: null,
  graduation_at: null,
  clearance_started_at: null,
  logout_requested_at: null,
  postpone_until: null,
  cancelled_at: null,
  real_name_masked: '张*明',
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-02T00:00:00.000Z'),
  ...over,
});

/** 模拟 product 表记录 */
const makeProduct = (over: Record<string, unknown> = {}) => ({
  id: BigInt(101),
  seller_id: BigInt(1),
  school_id: BigInt(7),
  category_id: BigInt(3),
  title: '高等数学（下）',
  description: '八成新',
  condition_level: 'good',
  price: { toString: () => '25.00' },
  original_price: null,
  trade_mode: 'both',
  meet_location: '图书馆门口',
  available_time: null,
  status: 'on_sale',
  is_urgent: false,
  view_count: 10,
  favorite_count: 2,
  sold_buyer_id: null,
  sold_at: null,
  off_sale_at: null,
  published_at: new Date('2026-02-01T00:00:00.000Z'),
  created_at: new Date('2026-02-01T00:00:00.000Z'),
  updated_at: new Date('2026-02-01T00:00:00.000Z'),
  ...over,
});

const makePrismaMock = () =>
  ({
    user: { findUnique: jest.fn(), update: jest.fn() },
    school: { findUnique: jest.fn() },
    product: { findMany: jest.fn(), count: jest.fn() },
  }) as unknown as PrismaService & {
    user: { findUnique: jest.Mock; update: jest.Mock };
    school: { findUnique: jest.Mock };
    product: { findMany: jest.Mock; count: jest.Mock };
  };

const setup = () => {
  const prisma = makePrismaMock();
  const repo = new UserRepository(prisma);
  const service = new UserService(repo);
  return { prisma, repo, service };
};

/** 标准就绪态：一个 student 用户 + 1 在售 + 1 已售 */
const mockHappyPath = (prisma: ReturnType<typeof makePrismaMock>, userOver: Record<string, unknown> = {}) => {
  prisma.user.findUnique.mockResolvedValue(makeUser(userOver));
  prisma.school.findUnique.mockResolvedValue({ id: BigInt(7), name: '示例大学' });
  prisma.product.findMany.mockImplementation(({ where }: { where: { status: string } }) =>
    Promise.resolve(
      where.status === 'on_sale'
        ? [makeProduct()]
        : [makeProduct({ id: BigInt(102), status: 'sold', sold_at: new Date('2026-03-01T00:00:00.000Z') })],
    ),
  );
  prisma.product.count.mockImplementation(({ where }: { where: { status: string } }) =>
    Promise.resolve(where.status === 'on_sale' ? 3 : 5),
  );
};

// ---------- §5.2 #46 GET /users/{id}：F2-AC1 公开档案 ----------

describe('UserService.getPublicProfile（@api §5.2 #46，@ac F2-AC1）', () => {
  it('返回昵称/头像/身份标识/学校/在售已售列表/评价摘要占位', async () => {
    const { prisma, service } = setup();
    mockHappyPath(prisma);

    const profile = await service.getPublicProfile('1');

    expect(profile.user).toEqual({
      id: '1',
      nickname: '小明',
      avatar: 'https://cdn/x/a.png',
      bio: '出闲置教材',
      role: 'student',
      is_merchant: false,
      school_id: '7',
      school_name: '示例大学',
      credit_score: null,
      join_at: '2026-01-01T00:00:00.000Z',
    });
    expect(profile.on_sale_count).toBe(3);
    expect(profile.sold_count).toBe(5);
    expect(profile.on_sale_list).toHaveLength(1);
    expect(profile.on_sale_list[0]).toEqual({
      id: '101',
      title: '高等数学（下）',
      price: '25.00',
      status: 'on_sale',
      published_at: '2026-02-01T00:00:00.000Z',
    });
    expect(profile.sold_list).toHaveLength(1);
    expect(profile.sold_list[0]).toEqual({
      id: '102',
      title: '高等数学（下）',
      price: '25.00',
      status: 'sold',
      published_at: '2026-02-01T00:00:00.000Z',
      sold_at: '2026-03-01T00:00:00.000Z',
    });
    // 评价摘要占位（F17 落地前为空摘要）
    expect(profile.review_summary).toEqual({ avg_rating: null, total: 0 });
  });

  it('无学校（school_id=null）时 school_id/school_name 为 null，不查 school 表', async () => {
    const { prisma, service } = setup();
    mockHappyPath(prisma, { school_id: null });

    const profile = await service.getPublicProfile('1');

    expect(profile.user.school_id).toBeNull();
    expect(profile.user.school_name).toBeNull();
    expect(prisma.school.findUnique).not.toHaveBeenCalled();
  });

  it('guest 身份同样返回主页（浏览零门槛，N1）', async () => {
    const { prisma, service } = setup();
    mockHappyPath(prisma, { identity_type: UserIdentityType.GUEST, school_id: null });

    const profile = await service.getPublicProfile('1');

    expect(profile.user.role).toBe('guest');
    expect(profile.user.is_merchant).toBe(false);
  });

  it('用户不存在 → 业务错误 1001（契约 #46 关键错误码）', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.getPublicProfile('999')).rejects.toMatchObject({
      code: ERROR_CODES.AUTH_TOKEN_INVALID,
    });
  });

  it('用户已注销（cancelled）→ 主页不可访问，按 1001 处理（F26-AC1）', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(makeUser({ status: UserStatus.CANCELLED }));

    await expect(service.getPublicProfile('1')).rejects.toMatchObject({
      code: ERROR_CODES.AUTH_TOKEN_INVALID,
    });
  });
});

// ---------- F2-AC2：商家「认证商家」标识 ----------

describe('UserService.getPublicProfile（@ac F2-AC2，@rule CIM-R-28 全链路亮标）', () => {
  it('商家账号：role=merchant 且 is_merchant=true（标识派生自身份，不可关闭）', async () => {
    const { prisma, service } = setup();
    mockHappyPath(prisma, { identity_type: UserIdentityType.MERCHANT });

    const profile = await service.getPublicProfile('1');

    expect(profile.user.role).toBe('merchant');
    expect(profile.user.is_merchant).toBe(true);
  });

  it.each([UserIdentityType.STUDENT, UserIdentityType.STAFF, UserIdentityType.GUEST])(
    '非商家身份 %s：is_merchant=false',
    async (identity) => {
      const { prisma, service } = setup();
      mockHappyPath(prisma, { identity_type: identity });

      const profile = await service.getPublicProfile('1');

      expect(profile.user.is_merchant).toBe(false);
    },
  );
});

// ---------- N6：实名信息不出站 ----------

describe('N6 实名不出站（@rule CIM-R-28 守卫 + PIM-AG-02 不变量）', () => {
  it('响应 JSON 全文不含 student_no/license/openid/unionid/real_name 等字段', async () => {
    const { prisma, service } = setup();
    mockHappyPath(prisma, { identity_type: UserIdentityType.MERCHANT });

    const profile = await service.getPublicProfile('1');
    const json = JSON.stringify(profile);

    for (const forbidden of ['student_no', 'license', 'openid', 'unionid', 'real_name', 'banned_reason']) {
      expect(json).not.toContain(forbidden);
    }
  });

  it('assertNoRealNameLeak：干净 DTO 放行', () => {
    expect(() => assertNoRealNameLeak({ user: { nickname: 'x' }, list: [{ id: '1' }] })).not.toThrow();
  });

  it.each(['student_no', 'license', 'license_url', 'openid', 'real_name', 'real_name_masked'])(
    'assertNoRealNameLeak：出现敏感键 %s（含嵌套）即抛错',
    (key) => {
      expect(() => assertNoRealNameLeak({ user: { nested: { [key]: 'x' } } })).toThrow();
    },
  );

  it('assertNoRealNameLeak：数组内对象同样深扫', () => {
    expect(() => assertNoRealNameLeak({ list: [{ id: '1' }, { student_no: '2024' }] })).toThrow();
  });
});

// ---------- UserController：统一响应包络与游客路径 ----------

describe('UserController（统一响应包络 §5.1）', () => {
  it('成功返回 { code:0, message:"ok", data }', async () => {
    const service = { getPublicProfile: jest.fn().mockResolvedValue({ user: { id: '1' } }) };
    const controller = new UserController(service as unknown as UserService);

    const res = await controller.getProfile('1');

    expect(res.code).toBe(0);
    expect(res.message).toBe('ok');
    expect(res.data).toEqual({ user: { id: '1' } });
    expect(service.getPublicProfile).toHaveBeenCalledWith('1');
  });

  it('游客路径：getProfile 不挂 JwtAuthGuard（主页公开可浏览，N1/F2-AC2）', () => {
    const guards = Reflect.getMetadata('__guards__', UserController.prototype.getProfile);
    expect(guards).toBeUndefined();
  });

  it('非法 id → 9001，且不透传 service', async () => {
    const service = { getPublicProfile: jest.fn() };
    const controller = new UserController(service as unknown as UserService);

    await expect(controller.getProfile('abc')).rejects.toMatchObject({
      code: ERROR_CODES.PARAM_VALIDATION_FAILED,
    });
    expect(service.getPublicProfile).not.toHaveBeenCalled();
  });
});

// ---------- UserRepository（@table user/product → PIM-AG-02，mock Prisma） ----------

describe('UserRepository（@table user → PIM-AG-02；product 同 schema 读）', () => {
  it('findPublicUserById 走 user 主键', async () => {
    const prisma = makePrismaMock();
    const repo = new UserRepository(prisma);
    prisma.user.findUnique.mockResolvedValue(makeUser());

    await repo.findPublicUserById(BigInt(1));

    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: BigInt(1) } });
  });

  it('findSchoolNameById 走 school 主键', async () => {
    const prisma = makePrismaMock();
    const repo = new UserRepository(prisma);
    prisma.school.findUnique.mockResolvedValue({ id: BigInt(7), name: '示例大学' });

    const name = await repo.findSchoolNameById(BigInt(7));

    expect(prisma.school.findUnique).toHaveBeenCalledWith({ where: { id: BigInt(7) } });
    expect(name).toBe('示例大学');
  });

  it('findSchoolNameById：学校不存在返回 null', async () => {
    const prisma = makePrismaMock();
    const repo = new UserRepository(prisma);
    prisma.school.findUnique.mockResolvedValue(null);

    await expect(repo.findSchoolNameById(BigInt(7))).resolves.toBeNull();
  });

  it('findProductsBySeller 按卖家+状态查询并限量排序', async () => {
    const prisma = makePrismaMock();
    const repo = new UserRepository(prisma);
    prisma.product.findMany.mockResolvedValue([makeProduct()]);

    await repo.findProductsBySeller(BigInt(1), 'on_sale', 20);

    expect(prisma.product.findMany).toHaveBeenCalledWith({
      where: { seller_id: BigInt(1), status: 'on_sale' },
      orderBy: { published_at: 'desc' },
      take: 20,
    });
  });

  it('countProductsBySeller 按卖家+状态计数', async () => {
    const prisma = makePrismaMock();
    const repo = new UserRepository(prisma);
    prisma.product.count.mockResolvedValue(3);

    const n = await repo.countProductsBySeller(BigInt(1), 'sold');

    expect(prisma.product.count).toHaveBeenCalledWith({ where: { seller_id: BigInt(1), status: 'sold' } });
    expect(n).toBe(3);
  });
});

// ---------- Validator（参数校验 → 9001） ----------

describe('validateUserIdParam（参数校验 → 9001）', () => {
  it.each(['1', ' 42 ', '9007199254740991'])('合法 id %j 透传（去空白）', (id) => {
    expect(validateUserIdParam(id)).toBe(id.trim());
  });

  it.each(['', '   ', 'abc', '0', '-1', '1.5', '1e3', null, undefined, 1])(
    '非法输入 %j → BusinessError(9001)',
    (input) => {
      try {
        validateUserIdParam(input as string);
        fail('应当抛出 9001');
      } catch (e) {
        expect(e).toBeInstanceOf(BusinessError);
        expect((e as BusinessError).code).toBe(ERROR_CODES.PARAM_VALIDATION_FAILED);
      }
    },
  );
});

// ---------- N6 匿名保护：公开档案脱敏（仿 @rule CIM-R-28 口径） ----------

describe('N6 匿名保护（is_anonymous=true 时公开档案脱敏）', () => {
  it('匿名用户：nickname →「匿名用户」、avatar → 空串，其余公开字段不受影响', async () => {
    const { prisma, service } = setup();
    mockHappyPath(prisma, { is_anonymous: true });

    const profile = await service.getPublicProfile('1');

    expect(profile.user.nickname).toBe('匿名用户');
    expect(profile.user.avatar).toBe('');
    expect(profile.user.bio).toBe('出闲置教材');
    expect(profile.user.role).toBe('student');
    expect(profile.user.school_name).toBe('示例大学');
    expect(JSON.stringify(profile)).not.toContain('小明');
  });

  it('非匿名用户：昵称/头像原样返回', async () => {
    const { prisma, service } = setup();
    mockHappyPath(prisma, { is_anonymous: false });

    const profile = await service.getPublicProfile('1');

    expect(profile.user.nickname).toBe('小明');
    expect(profile.user.avatar).toBe('https://cdn/x/a.png');
  });
});

// ---------- PATCH /users/me：资料编辑 ----------

describe('UserService.updateMyProfile（@api 补充接口 PATCH /users/me）', () => {
  it('部分字段更新：仅透传提供项，响应更新后的本人档案（本人视角不脱敏）', async () => {
    const { prisma, service } = setup();
    prisma.user.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve(makeUser(data)),
    );

    const profile = await service.updateMyProfile(BigInt(1), {
      nickname: '阿黄',
      is_anonymous: true,
    });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: BigInt(1) },
      data: { nickname: '阿黄', is_anonymous: true },
    });
    expect(profile).toEqual({
      id: '1',
      nickname: '阿黄',
      avatar: 'https://cdn/x/a.png',
      bio: '出闲置教材',
      is_anonymous: true,
      role: 'student',
      school_id: '7',
      join_at: '2026-01-01T00:00:00.000Z',
    });
  });

  it('匿名开关生效：响应回显 is_anonymous=true 且本人视角昵称不脱敏', async () => {
    const { prisma, service } = setup();
    prisma.user.update.mockResolvedValue(makeUser({ is_anonymous: true }));

    const profile = await service.updateMyProfile(BigInt(1), { is_anonymous: true });

    expect(profile.is_anonymous).toBe(true);
    expect(profile.nickname).toBe('小明');
  });

  it('空 body → 9001，不透传 repository', async () => {
    const { prisma, service } = setup();

    await expect(service.updateMyProfile(BigInt(1), {})).rejects.toMatchObject({
      code: ERROR_CODES.PARAM_VALIDATION_FAILED,
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('非法字段（超长 nickname）→ 9001，不落库', async () => {
    const { prisma, service } = setup();

    await expect(
      service.updateMyProfile(BigInt(1), { nickname: 'x'.repeat(65) }),
    ).rejects.toMatchObject({ code: ERROR_CODES.PARAM_VALIDATION_FAILED });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

// ---------- validateUpdateProfileFields（参数校验 → 9001） ----------

describe('validateUpdateProfileFields（PATCH /users/me 入参校验）', () => {
  it('全字段合法 → 逐项规范化返回', () => {
    expect(
      validateUpdateProfileFields({
        nickname: '阿黄',
        bio: '佛系出闲置',
        avatar_url: '/static/avatar-3.png',
        is_anonymous: true,
      }),
    ).toEqual({ nickname: '阿黄', bio: '佛系出闲置', avatarUrl: '/static/avatar-3.png', isAnonymous: true });
  });

  it.each([{}, null, undefined, [], 'x'])('空 body/非对象 %j → 9001', (input) => {
    try {
      validateUpdateProfileFields(input);
      fail('应当抛出 9001');
    } catch (e) {
      expect(e).toBeInstanceOf(BusinessError);
      expect((e as BusinessError).code).toBe(ERROR_CODES.PARAM_VALIDATION_FAILED);
    }
  });

  it.each([
    ['nickname 超长', { nickname: 'x'.repeat(65) }],
    ['nickname 非字符串', { nickname: 123 }],
    ['bio 超长', { bio: 'x'.repeat(501) }],
    ['avatar_url 超长', { avatar_url: '/static/' + 'x'.repeat(510) }],
    ['avatar_url 前缀非法', { avatar_url: 'ftp://x/a.png' }],
    ['avatar_url 相对路径非 /static/', { avatar_url: 'avatar-1.png' }],
    ['is_anonymous 非布尔', { is_anonymous: 'true' }],
  ])('%s → 9001', (_label, body) => {
    try {
      validateUpdateProfileFields(body);
      fail('应当抛出 9001');
    } catch (e) {
      expect(e).toBeInstanceOf(BusinessError);
      expect((e as BusinessError).code).toBe(ERROR_CODES.PARAM_VALIDATION_FAILED);
    }
  });

  it.each(['/static/avatar-1.png', 'http://cdn/x/a.png', 'https://cdn/x/a.png'])(
    'avatar_url 合法前缀 %j 透传',
    (url) => {
      expect(validateUpdateProfileFields({ avatar_url: url })).toEqual({ avatarUrl: url });
    },
  );

  it('nickname/bio 边界长度（64/500）放行', () => {
    expect(
      validateUpdateProfileFields({ nickname: 'x'.repeat(64), bio: 'y'.repeat(500) }),
    ).toEqual({ nickname: 'x'.repeat(64), bio: 'y'.repeat(500) });
  });
});

// ---------- UserRepository.updateProfileById（写侧白名单组装） ----------

describe('UserRepository.updateProfileById（@table user → PIM-AG-02）', () => {
  it('仅组装提供的字段（avatarUrl→avatar_url / isAnonymous→is_anonymous 列名映射）', async () => {
    const prisma = makePrismaMock();
    const repo = new UserRepository(prisma);
    prisma.user.update.mockResolvedValue(makeUser({ avatar_url: '/static/avatar-2.png' }));

    await repo.updateProfileById(BigInt(1), { avatarUrl: '/static/avatar-2.png' });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: BigInt(1) },
      data: { avatar_url: '/static/avatar-2.png' },
    });
  });
});

// ---------- UserController.updateMe（统一响应包络 + 登录守卫） ----------

describe('UserController.updateMe（PATCH /users/me，统一响应包络 §5.1）', () => {
  it('成功返回 { code:0, message:"ok", data }，uid 转 BigInt 透传 service', async () => {
    const service = { updateMyProfile: jest.fn().mockResolvedValue({ id: '1', is_anonymous: false }) };
    const controller = new UserController(service as unknown as UserService);

    const res = await controller.updateMe({ nickname: '阿黄' }, { user: { id: '1' } });

    expect(res.code).toBe(0);
    expect(res.message).toBe('ok');
    expect(service.updateMyProfile).toHaveBeenCalledWith(BigInt(1), { nickname: '阿黄' });
  });

  it('未登录（req.user 缺失）→ 1001，不透传 service', async () => {
    const service = { updateMyProfile: jest.fn() };
    const controller = new UserController(service as unknown as UserService);

    await expect(controller.updateMe({ nickname: '阿黄' }, {})).rejects.toMatchObject({
      code: ERROR_CODES.AUTH_TOKEN_INVALID,
    });
    expect(service.updateMyProfile).not.toHaveBeenCalled();
  });
});
