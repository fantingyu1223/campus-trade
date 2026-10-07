/**
 * wantbuy-match.service.ts —— 求购撮合（商品上架后匹配检测）
 *
 * @module PIM-BC-02 商品与供给（求购子域）
 * @model PIM-AG-04 求购聚合（撮合匹配为读模型投影，非聚合内实体）
 * @rule CIM-R-33 仅消费 active 且未过期求购；closed/bought/expired 终态停止一切撮合通知
 * @event PIM-EV-11 求购撮合命中（接收商品上架事实后匹配 → BC-06 向求购发布者推送 want_buy_match）
 * @ac F9-AC1 平台出现匹配在售商品时，求购者收到撮合提示通知
 *
 * 匹配要素（技术方案 §4.11）：同品类 + 关键词（求购 title）命中商品 title（求购 title
 * 为空视为不限）+ 商品 price ≤ 求购 price_max（price_max 为 NULL 则无上限通过）。
 *
 * 依赖方向：跨模块通知写入经 `@infra/notify-sender/notify-sender.service` 别名
 * （§3.1 合法通道，PIM-C-3 暂定口径），本服务自含触发规则，notify 侧只做技术写入。
 *
 * 防御口径：where 条件与逐行复核双重保证（active/未过期/价格上限），
 * DB 侧与内存侧口径一致，避免扫描窗口内状态竞态误触达。
 */
import { Injectable } from '@nestjs/common';
import { NotificationType, WantBuyStatus } from '@contract/index';
import { PrismaService } from '@infra/prisma.service';
import { NotifySenderService } from '@infra/notify-sender/notify-sender.service';

/** 撮合触发输入：新上架商品（事件载荷多为字符串序列化，id/category_id 兼容 string/bigint） */
export interface ProductPublishedInput {
  id: string | bigint;
  category_id: string | bigint;
  title: string;
  price: number | string;
}

/** 通知标题上限（notification.title VARCHAR(128)，超出截断商品标题） */
const TITLE_MAX = 128;

@Injectable()
export class WantBuyMatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotifySenderService,
  ) {}

  /**
   * 商品上架撮合：查 active 未过期求购（同品类 + price_max 空或 ≥ 商品价），
   * 逐行复核状态/有效期/价格上限/关键词命中，命中即向求购发布者写撮合通知。
   * @event PIM-EV-11 @ac F9-AC1
   * @returns 命中并通知的求购数
   */
  async matchOnProductPublished(product: ProductPublishedInput): Promise<number> {
    const now = new Date();
    const price = Number(product.price);
    const candidates = await this.prisma.wantBuy.findMany({
      where: {
        status: WantBuyStatus.ACTIVE,
        category_id: BigInt(product.category_id),
        expire_at: { gt: now },
        OR: [{ price_max: null }, { price_max: { gte: price } }],
      },
    });

    let matched = 0;
    for (const wb of candidates) {
      if (!this.isMatch(wb, product, price, now)) continue;
      await this.notify.send({
        user_id: wb.user_id,
        type: NotificationType.WANT_BUY_MATCH,
        title: this.buildTitle(product.title),
        payload: {
          want_buy_id: wb.id.toString(),
          product_id: product.id.toString(),
        },
      });
      matched += 1;
    }
    return matched;
  }

  /** 逐行复核：active + 未过期 + 价格上限 + 关键词命中（求购 title 空白视为不限） */
  private isMatch(
    wb: {
      status: string;
      expire_at: Date;
      price_max: unknown;
      title: string;
    },
    product: ProductPublishedInput,
    price: number,
    now: Date,
  ): boolean {
    if (wb.status !== WantBuyStatus.ACTIVE) return false;
    if (wb.expire_at.getTime() <= now.getTime()) return false;
    if (wb.price_max !== null && Number(wb.price_max) < price) return false;
    const keyword = wb.title.trim();
    if (keyword !== '' && !product.title.includes(keyword)) return false;
    return true;
  }

  /** 通知标题：含商品标题；总长 ≤128（超出截断商品标题部分） */
  private buildTitle(productTitle: string): string {
    const prefix = '求购撮合命中：「';
    const suffix = '」符合你的求购';
    const budget = TITLE_MAX - prefix.length - suffix.length;
    const clipped = productTitle.length > budget ? productTitle.slice(0, budget) : productTitle;
    return `${prefix}${clipped}${suffix}`;
  }
}
