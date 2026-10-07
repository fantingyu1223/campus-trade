/**
 * notify-sender.service.ts —— 站内通知写入服务（infra 层，PIM-C-3 暂定口径）
 *
 * @model PIM-BC-06 通知触达（消费 PIM-EV-01~15）
 * @table notification → 无聚合 BC-06
 * @ac F15-AC1 求购匹配等事件触达落库（前端按 type+payload 跳转详情）
 *
 * 说明：notify 无聚合，写入口按 PIM-C-3 暂定口径下沉 infra。
 * wantbuy/order/review 等各模块经 contract 事件触发后，通过
 * `@infra/notify-sender/notify-sender.service` 别名调用本服务（§3.1 合法依赖方向），
 * 本服务只做技术写入，不含业务触发规则（触发规则由事件发布方模块自含）。
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { NotificationType } from '@contract/index';
import { NotificationRepository } from './notification.repository';

/** 发送入参：user_id 兼容 string/bigint（事件载荷多为字符串序列化） */
export interface SendNotificationInput {
  /** 接收用户ID */
  user_id: string | bigint;
  /** 通知类型（contract NotificationType，值与 Prisma 枚举一致） */
  type: NotificationType;
  /** 通知标题（≤128 字，截断/生成规则由调用方负责） */
  title: string;
  /** 跳转负载：仅存 ID 引用（如 {"order_id":"1"}），前端按 type 解析路由 */
  payload?: Record<string, unknown>;
}

/** 发送结果：新通知ID（字符串序列化，避免 BigInt JSON 问题） */
export interface SendNotificationResult {
  id: string;
}

@Injectable()
export class NotifySenderService {
  constructor(private readonly repo: NotificationRepository) {}

  /**
   * 写入一条站内通知（is_read=false，created_at 由 DB 默认生成）。
   * 同步落库口径：§4.28 说明的 MQ/本地事件表异步化由后续批次接入，
   * 本服务保持同步写入语义，事件订阅侧异步化不改变本接口契约。
   */
  async send(input: SendNotificationInput): Promise<SendNotificationResult> {
    const created = await this.repo.create({
      user_id: BigInt(input.user_id),
      // contract 枚举值与 Prisma NotificationType 字符串完全一致（契约层唯一事实源）
      type: input.type as Prisma.NotificationCreateInput['type'],
      title: input.title,
      payload: input.payload === undefined ? undefined : (input.payload as Prisma.InputJsonValue),
    });
    return { id: created.id.toString() };
  }
}
