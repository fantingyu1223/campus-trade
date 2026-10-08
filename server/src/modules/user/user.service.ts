/**
 * user/user.service.ts —— user 模块应用服务（模块自含，§3.1）。
 *
 * @module PIM-BC-01 身份与准入
 * @model PIM-AG-02 用户档案聚合（PublicProfile）
 * @rule CIM-R-28 认证商家全链路亮标（is_merchant 由 identity_type 派生，不可关闭）
 * @api §5.2 #46 GET /users/{id}，@ac F2-AC1 / F2-AC2
 *
 * 纪律（N6 / PIM-AG-02 不变量）：学号、资质材料、openid、real_name 等实名与凭证
 * 字段一律不出站；所有公开档案响应出站前必须经过 assertNoRealNameLeak 守卫。
 * N6 匿名保护（仿 @rule CIM-R-28 身份标识化口径）：user.is_anonymous=true 时，
 * 公开档案昵称展示为「匿名用户」、头像置空；本人视角接口（PATCH /users/me）不脱敏。
 */
import { Injectable } from '@nestjs/common';
import { ApiResponse, ERROR_CODES, ErrorCode, UserIdentityType, UserStatus } from '@contract/index';
import {
  ProfileProductItem,
  ReviewSummaryPlaceholder,
  UpdateProfileResponse,
  UserProfileResponse,
} from './dto/profile.dto';
import { ProductRow, UserRepository, UserRow } from './user.repository';
import { validateUpdateProfileFields } from './user.validator';

/**
 * 业务错误：携带契约错误码（§5.1），由全局过滤器翻译为统一响应包络。
 */
export class BusinessError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BusinessError';
  }
}

/** 实名/凭证敏感键黑名单（N6）：响应 JSON 任一层级出现即视为泄漏 */
const REAL_NAME_FORBIDDEN_KEYS = ['student_no', 'license', 'openid', 'unionid', 'real_name'];

/**
 * 实名不出站守卫：深度扫描出站对象的键名（含嵌套对象与数组），
 * 命中黑名单即抛错。仅扫描键名不扫描值，避免昵称等文本误伤。
 * @throws Error 出现敏感键（属服务端缺陷，按 9999 处理）
 */
export function assertNoRealNameLeak(payload: unknown): void {
  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    if (node !== null && typeof node === 'object') {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (REAL_NAME_FORBIDDEN_KEYS.some((forbidden) => key.includes(forbidden))) {
          throw new BusinessError(
            ERROR_CODES.INTERNAL_ERROR,
            `实名敏感键泄漏：${path ? `${path}.` : ''}${key}`,
          );
        }
        walk(value, path ? `${path}.${key}` : key);
      }
    }
  };
  walk(payload, '');
}

/** 主页商品列表条数上限（契约 §5.2 #46 默认值） */
const PROFILE_LIST_TAKE = 20;

/** N6 匿名保护：匿名用户的公开昵称占位 */
const ANONYMOUS_NICKNAME = '匿名用户';

@Injectable()
export class UserService {
  constructor(private readonly repo: UserRepository) {}

  /**
   * 个人/商家主页公开档案。
   * @api §5.2 #46，@ac F2-AC1（公开档案）/ F2-AC2（认证商家亮标）
   * N6 匿名保护（仿 @rule CIM-R-28 口径）：is_anonymous=true 时
   * nickname →「匿名用户」、avatar → ''（其余公开字段不受影响）。
   * @param id 用户 id（十进制字符串，已在 controller 层校验）
   * @throws BusinessError(1001) 用户不存在或已注销（F26-AC1：注销后主页不可访问）
   */
  async getPublicProfile(id: string): Promise<UserProfileResponse> {
    const user = await this.repo.findPublicUserById(BigInt(id));
    if (!user || user.status === UserStatus.CANCELLED) {
      throw new BusinessError(ERROR_CODES.AUTH_TOKEN_INVALID, '用户不存在或已注销');
    }

    const schoolName = user.school_id !== null ? await this.repo.findSchoolNameById(user.school_id) : null;

    const [onSaleRows, soldRows, onSaleCount, soldCount] = await Promise.all([
      this.repo.findProductsBySeller(user.id, 'on_sale', PROFILE_LIST_TAKE),
      this.repo.findProductsBySeller(user.id, 'sold', PROFILE_LIST_TAKE),
      this.repo.countProductsBySeller(user.id, 'on_sale'),
      this.repo.countProductsBySeller(user.id, 'sold'),
    ]);

    const reviewSummary: ReviewSummaryPlaceholder = { avg_rating: null, total: 0 };

    const profile: UserProfileResponse = {
      user: {
        id: user.id.toString(),
        // N6 匿名保护：匿名开启时公开档案昵称/头像脱敏
        nickname: user.is_anonymous ? ANONYMOUS_NICKNAME : user.nickname,
        avatar: user.is_anonymous ? '' : user.avatar_url,
        bio: user.bio,
        role: user.identity_type as UserIdentityType,
        // @rule CIM-R-28：标识派生自身份，不可关闭
        is_merchant: user.identity_type === UserIdentityType.MERCHANT,
        school_id: user.school_id !== null ? user.school_id.toString() : null,
        school_name: schoolName,
        credit_score: null,
        join_at: user.created_at.toISOString(),
      },
      on_sale_count: onSaleCount,
      sold_count: soldCount,
      on_sale_list: onSaleRows.map((row) => toProfileProductItem(row, false)),
      sold_list: soldRows.map((row) => toProfileProductItem(row, true)),
      review_summary: reviewSummary,
    };

    // N6：实名不出站守卫（PIM-AG-02 不变量）
    assertNoRealNameLeak(profile);
    return profile;
  }

  /**
   * 资料编辑（@api 补充接口 PATCH /users/me）：白名单四字段部分更新，
   * 返回更新后的本人档案（本人视角不脱敏；实名字段本就不在白名单内）。
   * @throws BusinessError(9001) 空 body / 字段非法（落点 user.validator.ts）
   */
  async updateMyProfile(userId: bigint, raw: unknown): Promise<UpdateProfileResponse> {
    const fields = validateUpdateProfileFields(raw);
    const user = await this.repo.updateProfileById(userId, fields);

    const profile: UpdateProfileResponse = {
      id: user.id.toString(),
      nickname: user.nickname,
      avatar: user.avatar_url,
      bio: user.bio,
      is_anonymous: user.is_anonymous,
      role: user.identity_type as UserIdentityType,
      school_id: user.school_id !== null ? user.school_id.toString() : null,
      join_at: user.created_at.toISOString(),
    };

    // N6：实名不出站守卫（与公开档案同一不变量）
    assertNoRealNameLeak(profile);
    return profile;
  }
}

/** product 行 → 主页列表项；sold_at 仅在已售列表出现 */
function toProfileProductItem(row: ProductRow, withSoldAt: boolean): ProfileProductItem {
  const item: ProfileProductItem = {
    id: row.id.toString(),
    title: row.title,
    price: row.price.toString(),
    status: row.status,
    published_at: row.published_at !== null ? row.published_at.toISOString() : null,
  };
  if (withSoldAt) {
    item.sold_at = row.sold_at !== null ? row.sold_at.toISOString() : null;
  }
  return item;
}

/** 统一响应包络构造（§5.1）：code=0 / message=ok */
export function ok<T>(data: T): ApiResponse<T> {
  return { code: ERROR_CODES.SUCCESS, message: 'ok', data };
}

/** 保持 UserRow 类型在本文件的引用完整性（repository 导出的公开档案数据源行型） */
export type { UserRow };
