/**
 * wantbuy.service.ts —— 求购应用服务（发布/列表/续期/关闭/已买到）
 *
 * @module PIM-BC-02 商品与供给（求购子域）
 * @model PIM-AG-04 求购聚合
 * @statemachine PIM-SM-03 求购状态机：
 *   [*] → active（发布）；active → closed（#22）/ bought（#23）终态，不可复活；
 *   active → expired（到期，由 cron 处置，本服务不含）；active 续期保持 active（#21）。
 * @rule CIM-R-33 续期重置 expire_at=now+30 天（口径 PSM-INC-02，非契约错标的 7 天）
 * @rule CIM-R-08 违禁/违规词硬拦截（scene=want_buy 快照，留痕后 9001）
 * @api §5.2 #20 POST /want-buys、#24 GET /want-buys、#21 renew、#22 close、#23 bought
 * @ac F9-AC1 发布成功且仅 active 进入撮合面 / F9-AC2 30 天有效期 + 续期重置 /
 *     F9-AC3 关闭/已买到立即停撮合且不再出现于列表
 *
 * 偏离说明：契约 #20/#21 有效期/续期错标 7 天，本实现按裁决口径 30 天（PSM-INC-02）；
 * 契约 #21-23 仅列 1003，终态再操作/非 active 续期的状态冲突按任务口径报 4002
 * （ORDER_STATUS_CONFLICT 数值复用为「状态不允许该操作」语义）。
 */
import { Injectable } from '@nestjs/common';
import { ERROR_CODES, WantBuyStatus } from '@contract/index';
import { WantBuyRepository } from './wantbuy.repository';
import { findHitWords, validatePublishFields } from './wantbuy.validator';
import type {
  BoughtWantBuyResult,
  CloseWantBuyResult,
  PublishWantBuyResult,
  RenewWantBuyResult,
  WantBuyListItem,
  WantBuyListRawQuery,
  WantBuyListResult,
  WantBuyStatusValue,
} from './dto/wantbuy.dto';

/** 业务错误：code/message/details，由全局过滤器统一包装为响应包络（模块自含，不复用 product） */
export class BusinessError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'BusinessError';
  }
}

/** 用户上下文（控制器由 req.user 转换而来） */
export interface UserContext {
  id: bigint;
  schoolId: bigint;
}

/** @rule CIM-R-33 / F9：求购有效期固定 30 天（PSM-INC-02） */
export const WANT_BUY_VALIDITY_DAYS = 30;
const DAY_MS = 24 * 3600 * 1000;
const MAX_PAGE_SIZE = 50;

@Injectable()
export class WantBuyService {
  constructor(private readonly repo: WantBuyRepository) {}

  /**
   * 发布求购：字段完整性（9001）→ 品类存在性（9001）→ 词硬拦截（留痕+9001）→ 落库。
   * @statemachine PIM-SM-03 [*] → active（status=active，expire_at=now+30 天）
   * @api §5.2 #20 @ac F9-AC1
   */
  async publish(user: UserContext, raw: unknown): Promise<PublishWantBuyResult> {
    // ① 字段完整性校验（逐项聚合 9001）
    const dto = validatePublishFields(raw);

    // ② 品类存在性校验（求购允许非叶子品类，§4.11；不存在/停用 → 9001）
    const category = await this.repo.findCategoryById(dto.categoryId);
    if (!category || category.status !== 'active') {
      throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, '品类不存在或未开放');
    }

    // ③ @rule CIM-R-08：标题+描述合并扫描（scene=want_buy 快照），命中逐词留痕后 9001
    await this.assertNoHitWords(user, dto.title, dto.desc);

    // ④ PIM-SM-03 [*]→active：expire_at = now + 30 天
    const expireAt = new Date(Date.now() + WANT_BUY_VALIDITY_DAYS * DAY_MS);
    const row = await this.repo.createWantBuy({
      user_id: user.id,
      school_id: user.schoolId,
      category_id: dto.categoryId,
      title: dto.title,
      description: dto.desc,
      price_min: dto.priceMin,
      price_max: dto.priceMax,
      condition_level: dto.conditionLevel as never,
      status: 'active',
      expire_at: expireAt,
    });

    return { id: row.id.toString(), expire_at: row.expire_at.toISOString() };
  }

  /**
   * 列表：scope=all/mine + 关键词/品类过滤 + 分页；仅 active（closed/bought/expired 不出现）。
   * @api §5.2 #24 @ac F9-AC1/F9-AC3
   */
  async list(user: UserContext | null, query: WantBuyListRawQuery): Promise<WantBuyListResult> {
    const scope = query.scope ?? 'all';
    if (scope !== 'all' && scope !== 'mine') {
      throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, 'scope 非法');
    }
    if (scope === 'mine' && !user) {
      throw new BusinessError(ERROR_CODES.AUTH_TOKEN_INVALID, '未登录或登录已过期');
    }
    const page = this.parsePage(query.page, 1);
    const pageSize = this.parsePage(query.pageSize, 20, MAX_PAGE_SIZE);

    let categoryId: bigint | undefined;
    if (query.category_id !== undefined) {
      if (!/^\d+$/.test(query.category_id) || BigInt(query.category_id) <= BigInt(0)) {
        throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, '品类 id 非法');
      }
      categoryId = BigInt(query.category_id);
    }

    const keyword = query.keyword?.trim();
    const where = {
      // 仅 active 状态：closed/bought/expired 一律不出现（F9-AC3）
      status: WantBuyStatus.ACTIVE,
      ...(scope === 'mine' ? { user_id: (user as UserContext).id } : {}),
      ...(categoryId !== undefined ? { category_id: categoryId } : {}),
      ...(keyword ? { OR: [{ title: { contains: keyword } }, { description: { contains: keyword } }] } : {}),
    };

    const { list, total } = await this.repo.findPage(where, page, pageSize);
    return { page, pageSize, total, list: list.map(toListItem) };
  }

  /**
   * 续期：本人 + active → expire_at 重置 now+30 天，renewed_count+1、renewed_at 落时。
   * @rule CIM-R-33 @api §5.2 #21 @ac F9-AC2
   */
  async renew(user: UserContext, id: string): Promise<RenewWantBuyResult> {
    const row = await this.loadOwnedWantBuy(user, id);
    if (row.status !== WantBuyStatus.ACTIVE) {
      throw new BusinessError(ERROR_CODES.ORDER_STATUS_CONFLICT, '仅进行中的求购可续期');
    }
    const now = new Date();
    const expireAt = new Date(now.getTime() + WANT_BUY_VALIDITY_DAYS * DAY_MS);
    const updated = await this.repo.renew(row.id, expireAt, row.renewed_count + 1, now);
    return { expire_at: updated.expire_at.toISOString() };
  }

  /**
   * 关闭：active → closed 终态（不可逆）；生效后立即停止一切撮合通知（撮合侧仅消费 active，见 list 口径）。
   * @statemachine PIM-SM-03 @api §5.2 #22 @ac F9-AC3
   */
  async close(user: UserContext, id: string): Promise<CloseWantBuyResult> {
    const row = await this.loadOwnedWantBuy(user, id);
    this.assertActive(row.status);
    const updated = await this.repo.transitionTo(row.id, 'closed', new Date());
    return { status: updated.status as WantBuyStatusValue };
  }

  /**
   * 标记已买到：active → bought 终态（不可逆）；生效后立即停止一切撮合通知（同 close）。
   * @statemachine PIM-SM-03 @api §5.2 #23 @ac F9-AC3
   */
  async markBought(user: UserContext, id: string): Promise<BoughtWantBuyResult> {
    const row = await this.loadOwnedWantBuy(user, id);
    this.assertActive(row.status);
    const updated = await this.repo.transitionTo(row.id, 'bought', new Date());
    return { status: updated.status as WantBuyStatusValue };
  }

  // ---------- 私有守卫 ----------

  /** 归属守卫：id 非法/不存在 → 9001；非本人 → 1003 */
  private async loadOwnedWantBuy(user: UserContext, rawId: string) {
    if (!rawId || !/^\d+$/.test(rawId)) {
      throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, '求购 id 非法');
    }
    const id = BigInt(rawId);
    if (id <= BigInt(0)) {
      throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, '求购 id 非法');
    }
    const row = await this.repo.findById(id);
    if (!row) {
      throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, '求购不存在');
    }
    if (row.user_id !== user.id) {
      throw new BusinessError(ERROR_CODES.PERMISSION_DENIED, '仅发布人可操作该求购');
    }
    return row;
  }

  /** 状态守卫：仅 active 可流转；closed/bought 终态与 expired 一律 4002（终态不可复活） */
  private assertActive(status: string): void {
    if (status !== WantBuyStatus.ACTIVE) {
      throw new BusinessError(ERROR_CODES.ORDER_STATUS_CONFLICT, '求购已结束，终态不可复活');
    }
  }

  /** @rule CIM-R-08 落点：命中即逐词写 violation_intercept_log（scene=want_buy, action=blocked），随后抛 9001 */
  private async assertNoHitWords(user: UserContext, title: string, desc: string): Promise<void> {
    const text = title + '\n' + desc;
    const hits = findHitWords(text);
    if (hits.length === 0) return;
    for (const word of hits) {
      await this.repo.createViolationLog({
        user_id: user.id,
        hit_word: word,
        content_snapshot: text,
      });
    }
    throw new BusinessError(
      ERROR_CODES.PARAM_VALIDATION_FAILED,
      '内容命中违禁/违规词：' + hits.join('、'),
    );
  }

  /** 分页参数解析：正整数；pageSize 超上限 → 9001 */
  private parsePage(raw: string | undefined, fallback: number, max?: number): number {
    if (raw === undefined) return fallback;
    if (!/^\d+$/.test(raw)) {
      throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, '分页参数非法');
    }
    const n = Number(raw);
    if (n < 1 || (max !== undefined && n > max)) {
      throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, '分页参数非法');
    }
    return n;
  }
}

/** 列表项映射：BigInt → string，Decimal → string，时间 → ISO 或 null */
function toListItem(row: {
  id: bigint;
  user_id: bigint;
  category_id: bigint;
  title: string;
  description: string | null;
  price_min: unknown;
  price_max: unknown;
  condition_level: string | null;
  status: string;
  expire_at: Date;
  renewed_count: number;
  created_at: Date;
}): WantBuyListItem {
  return {
    id: row.id.toString(),
    user_id: row.user_id.toString(),
    category_id: row.category_id.toString(),
    title: row.title,
    description: row.description,
    price_min: row.price_min === null ? null : String(row.price_min),
    price_max: row.price_max === null ? null : String(row.price_max),
    condition_level: row.condition_level,
    status: row.status as WantBuyStatusValue,
    expire_at: row.expire_at.toISOString(),
    renewed_count: row.renewed_count,
    created_at: row.created_at.toISOString(),
  };
}
