/**
 * product-status.service.ts —— 商品状态管理应用服务（下架/重新上架/标记已售/我的商品/买家候选）
 *
 * @module PIM-BC-02 商品与供给
 * @model PIM-AG-03 商品聚合
 * @statemachine PIM-SM-02 商品状态机（on_sale ↔ off_sale；on_sale → sold 终态不可逆）
 * @rule CIM-R-13 标记已售必须指定买家（从该商品会话买家列表中选择）
 * @api §5.2 #12 POST /products/{id}/offline、#13 POST /products/{id}/sold、#16 GET /products/mine
 *      补充接口（本批次声明）：POST /products/{id}/relist、GET /products/{id}/buyer-candidates（U13 配套）
 * @ac F7-AC1 下架/重新上架状态迁移与守卫 / F7-AC2 标记已售须选会话买家 / F7-AC3 我的商品分栏与过滤
 *
 * 偏离说明：契约 #13 响应含 order_id（自动生成线下订单），订单模块本批次未就绪，
 * 暂以 order_id=null 占位返回（形状见 dto/status.dto.ts#MarkSoldResult），待订单批次回填。
 */
import { Injectable } from '@nestjs/common';
import { ERROR_CODES, ProductStatus } from '@contract/index';
import { ProductRepository } from './product.repository';
import { BusinessError } from './product-publish.service';
import type {
  BuyerCandidateItem,
  MarkSoldResult,
  MineListResult,
  MineProductItem,
  MineTabsResult,
  OfflineResult,
  RelistResult,
} from './dto/status.dto';

/** GET /products/mine 查询参数（控制器透传的原始字符串形态） */
export interface MineQuery {
  status?: string;
  page?: string;
  pageSize?: string;
}

/** status 过滤参数映射：契约口径 'offline' → 存储口径 'off_sale' */
const MINE_STATUS_MAP: Record<string, string> = {
  on_sale: 'on_sale',
  trading: 'trading',
  sold: 'sold',
  off_sale: 'off_sale',
  offline: 'off_sale',
};

const MAX_PAGE_SIZE = 50;

@Injectable()
export class ProductStatusService {
  constructor(private readonly repo: ProductRepository) {}

  /**
   * 下架：on_sale → off_sale（写入 off_sale_at 留痕）。
   * @statemachine PIM-SM-02 @api §5.2 #12 @ac F7-AC1
   */
  async offline(sellerId: bigint, id: string): Promise<OfflineResult> {
    const product = await this.loadOwnedProduct(sellerId, id);
    if (product.status !== ProductStatus.ON_SALE) {
      throw new BusinessError(ERROR_CODES.PRODUCT_OFF_SHELF, '当前状态不允许下架');
    }
    await this.repo.transitionToOffSale(product.id, new Date());
    return { status: ProductStatus.OFF_SALE };
  }

  /**
   * 重新上架：off_sale → on_sale（sold 终态由状态守卫拦截，不可逆）。
   * @statemachine PIM-SM-02 @ac F7-AC1（补充接口，本批次声明）
   */
  async relist(sellerId: bigint, id: string): Promise<RelistResult> {
    const product = await this.loadOwnedProduct(sellerId, id);
    if (product.status !== ProductStatus.OFF_SALE) {
      throw new BusinessError(ERROR_CODES.PRODUCT_OFF_SHELF, '当前状态不允许重新上架');
    }
    await this.repo.transitionToOnSale(product.id);
    return { status: ProductStatus.ON_SALE };
  }

  /**
   * 标记已售：on_sale → sold 终态；买家必须存在于该商品会话列表（CIM-R-13）。
   * @statemachine PIM-SM-02 @rule CIM-R-13 @api §5.2 #13 @ac F7-AC2
   */
  async markSold(sellerId: bigint, id: string, buyerId?: string): Promise<MarkSoldResult> {
    const productId = this.parseId(id, '商品 id 非法');
    const buyer = this.parseId(buyerId, '必须指定买家（buyer_id）');
    const product = await this.loadOwnedProduct(sellerId, productId);
    if (product.status !== ProductStatus.ON_SALE) {
      throw new BusinessError(ERROR_CODES.PRODUCT_OFF_SHELF, '当前状态不允许标记已售');
    }
    // @rule CIM-R-13 落点：买家须来自该商品会话买家列表（跨 schema 只读消费 chat 表）
    const conversations = await this.repo.findConversationsByProductForSeller(product.id, sellerId);
    const allowed = conversations.some((c) => c.buyer_id === buyer);
    if (!allowed) {
      throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, '买家不在该商品会话列表中');
    }
    const at = new Date();
    await this.repo.transitionToSold(product.id, buyer, at);
    return {
      status: ProductStatus.SOLD,
      sold_buyer_id: buyer.toString(),
      sold_at: at.toISOString(),
      order_id: null, // 订单模块未就绪，占位（见头注释偏离说明）
    };
  }

  /**
   * 买家候选列表（U13 配套补充接口）：该商品会话买家按 last_message_at desc，
   * join user 仅取 id/nickname 白名单（防实名泄漏）。
   */
  async listBuyerCandidates(sellerId: bigint, id: string): Promise<BuyerCandidateItem[]> {
    const product = await this.loadOwnedProduct(sellerId, id);
    const conversations = await this.repo.findConversationsByProductForSeller(product.id, sellerId);
    if (conversations.length === 0) return [];
    const buyers = await this.repo.findBuyersPublicByIds(conversations.map((c) => c.buyer_id));
    const nicknameOf = new Map(buyers.map((u) => [u.id.toString(), u.nickname]));
    return conversations.map((c) => ({
      buyer_id: c.buyer_id.toString(),
      nickname: nicknameOf.get(c.buyer_id.toString()) ?? '',
      conversation_id: c.id.toString(),
      last_message_at: c.last_message_at ? c.last_message_at.toISOString() : null,
    }));
  }

  /**
   * 我的商品分页单组（#16 带 status）：'offline' 映射 'off_sale'；
   * page/pageSize 缺省 1/20，pageSize 上限 50。
   * @api §5.2 #16 @ac F7-AC3
   */
  async listMine(sellerId: bigint, query: MineQuery): Promise<MineListResult> {
    const status = this.parseMineStatus(query.status);
    const page = this.parsePage(query.page, 1);
    const pageSize = this.parsePage(query.pageSize, 20, MAX_PAGE_SIZE);
    const { list, total } = await this.repo.findMineBySeller(sellerId, status, page, pageSize);
    return { list: list.map(toMineItem), total, page, pageSize };
  }

  /**
   * 我的商品分栏三组（#16 无 status）：在售组 = on_sale + trading 合并。
   * @api §5.2 #16 @ac F7-AC3
   */
  async listMineTabs(sellerId: bigint): Promise<MineTabsResult> {
    const all = await this.repo.findAllMineBySeller(sellerId);
    const items = all.map(toMineItem);
    return {
      on_sale: items.filter((p) => p.status === ProductStatus.ON_SALE || p.status === ProductStatus.TRADING),
      sold: items.filter((p) => p.status === ProductStatus.SOLD),
      off_sale: items.filter((p) => p.status === ProductStatus.OFF_SALE),
    };
  }

  // ---------- 私有守卫 ----------

  /** id 参数解析：非正整数（空串/非数字/小数/负数）→ 9001 */
  private parseId(raw: string | undefined, message: string): bigint {
    if (!raw || !/^\d+$/.test(raw)) {
      throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, message);
    }
    const id = BigInt(raw);
    if (id <= BigInt(0)) {
      throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, message);
    }
    return id;
  }

  /**
   * 读取商品并完成归属守卫（可接收原始 id 字符串或已解析的 bigint）：
   * 不存在 → 2001；非卖家 → 1003。
   */
  private async loadOwnedProduct(sellerId: bigint, id: string | bigint) {
    const productId = typeof id === 'bigint' ? id : this.parseId(id, '商品 id 非法');
    const product = await this.repo.findProductById(productId);
    if (!product) {
      throw new BusinessError(ERROR_CODES.PRODUCT_NOT_FOUND, '商品不存在');
    }
    if (product.seller_id !== sellerId) {
      throw new BusinessError(ERROR_CODES.PERMISSION_DENIED, '仅卖家可操作该商品');
    }
    return product;
  }

  /** status 过滤参数校验与映射（'offline' → 'off_sale'；非法枚举 → 9001） */
  private parseMineStatus(raw: string | undefined): string | undefined {
    if (raw === undefined) return undefined;
    const mapped = MINE_STATUS_MAP[raw];
    if (!mapped) {
      throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, 'status 非法');
    }
    return mapped;
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

/** 我的商品列表项映射：BigInt → string，时间 → ISO 或 null */
function toMineItem(p: {
  id: bigint;
  title: string;
  price: unknown;
  status: string;
  is_urgent: boolean;
  published_at: Date | null;
  sold_at: Date | null;
  off_sale_at: Date | null;
  sold_buyer_id: bigint | null;
}): MineProductItem {
  return {
    id: p.id.toString(),
    title: p.title,
    price: String(p.price),
    status: p.status,
    is_urgent: p.is_urgent,
    published_at: p.published_at ? p.published_at.toISOString() : null,
    sold_at: p.sold_at ? p.sold_at.toISOString() : null,
    off_sale_at: p.off_sale_at ? p.off_sale_at.toISOString() : null,
    sold_buyer_id: p.sold_buyer_id !== null ? p.sold_buyer_id.toString() : null,
  };
}
