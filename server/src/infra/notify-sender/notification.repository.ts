/**
 * notification.repository.ts —— 站内通知表数据访问（写入 + 查询）
 *
 * @table notification → 无聚合 BC-06（触达支撑；F15 站内通知）
 * @model PIM-BC-06
 *
 * 说明：notify 无聚合，按 PIM-C-3 暂定口径下沉 infra/notify-sender。
 * 本仓储同时服务写入侧（NotifySenderService，供 wantbuy/order/review 等模块
 * 经 contract 事件触发调用）与读侧（modules/notify 的 #44/#45 查询/标记已读）。
 * payload 仅存 ID 引用，不冗余业务数据快照（§4.28 表说明）。
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

/** 通知写入入参（type 取值即 Prisma NotificationType 枚举字符串） */
export interface NotificationCreateEntry {
  user_id: bigint;
  type: Prisma.NotificationCreateInput['type'];
  title: string;
  /** 跳转负载（如 {"product_id":"100"}），省略时落 NULL */
  payload?: Prisma.InputJsonValue;
}

@Injectable()
export class NotificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 写入一条通知（is_read 默认 false，created_at 由 DB 默认值生成） */
  create(entry: NotificationCreateEntry) {
    return this.prisma.notification.create({
      data: {
        user_id: entry.user_id,
        type: entry.type,
        title: entry.title,
        payload: entry.payload,
      },
    });
  }

  /** 本人通知分页：created_at 倒序（idx_user_created）；type 可选过滤 */
  async findPageByUser(
    userId: bigint,
    type: string | null,
    page: number,
    pageSize: number,
  ): Promise<{ list: Prisma.NotificationGetPayload<object>[]; total: number }> {
    const where: Prisma.NotificationWhereInput = { user_id: userId };
    if (type !== null) {
      where.type = type as Prisma.NotificationCreateInput['type'];
    }
    const [list, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.notification.count({ where }),
    ]);
    return { list, total };
  }

  /** 本人未读数（idx_user_read：user_id + is_read） */
  countUnread(userId: bigint): Promise<number> {
    return this.prisma.notification.count({
      where: { user_id: userId, is_read: false },
    });
  }

  /**
   * 标记已读：where 恒限定本人未读（is_read=false 幂等，重复标记不产生副作用）；
   * ids 为空数组时省略 id 过滤 = 全部已读（§5.2 #45 口径）。
   */
  markRead(userId: bigint, ids: bigint[], readAt: Date) {
    const where: Prisma.NotificationWhereInput = { user_id: userId, is_read: false };
    if (ids.length > 0) {
      where.id = { in: ids };
    }
    return this.prisma.notification.updateMany({
      where,
      data: { is_read: true, read_at: readAt },
    });
  }
}
