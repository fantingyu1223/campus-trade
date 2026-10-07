/**
 * intercept-log.repository.ts —— 违规内容拦截留痕表数据访问（写入 + 查询）
 *
 * @table violation_intercept_log → 无聚合 BC-06（运营支撑；F22 全场景违规拦截留痕，不可变日志）
 * @model PIM-BC-06
 * @rule CIM-R-08 命中违规词一律拦截并留痕，供运营后台复核（F22-AC1）
 *
 * 说明：本表只增不改不删（§4.23），故本仓储仅提供 create 与只读分页，
 * 不提供任何 update/delete 入口。读侧按 idx_user（user_id, created_at）与
 * idx_scene_created（scene, created_at）过滤，created_at 倒序分页。
 *
 * 偏差说明（待架构师裁决）：任务清单 T-303 口径要求留痕五要素含
 * content_hash（sha256 前 16 位，不留原文）；冻结 schema §4.23 仅有
 * content_snapshot TEXT NOT NULL 字段。本批以 content_snapshot 承载
 * content_hash 值（哈希代替原文快照，满足 NOT NULL 且更符 N6 最小化留存），
 * 未改 schema。scene 取值同理：T-303 六场景（product_publish/product_edit/
 * profile_edit/comment/want_buy/message）超出 Prisma ViolationScene 枚举
 * （product_publish/product_edit/chat/want_buy/review），落库按字符串透传，
 * 枚举扩展与否由架构师裁决。
 */
import { Injectable } from '@nestjs/common';
import { Prisma, ViolationInterceptLog } from '@prisma/client';
import { PrismaService } from '../prisma.service';

/** 留痕写入入参（content_hash 为 sha256(text) 前 16 位十六进制串） */
export interface InterceptLogCreateEntry {
  /** 场景（T-303 六场景之一，落库透传至 ViolationScene 枚举列） */
  scene: string;
  /** 触发用户ID */
  user_id: bigint;
  /** 关联对象ID（商品/消息/求购等，拦截未落库则为 null） */
  target_id: bigint | null;
  /** 命中词 */
  hit_word: string;
  /** 内容哈希（sha256 前 16 位，承载于 content_snapshot 列） */
  content_hash: string;
  /** 拦截动作：blocked 硬拦截 / masked 打码放行 / warned 提示后提交 */
  action: 'blocked' | 'masked' | 'warned';
}

/** 留痕查询过滤条件（均可选，组合取交集） */
export interface InterceptLogFilter {
  userId?: bigint;
  scene?: string;
}

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;

@Injectable()
export class InterceptLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 写入一条拦截留痕（created_at 由 DB 默认生成；只增不改不删） */
  create(entry: InterceptLogCreateEntry): Promise<ViolationInterceptLog> {
    return this.prisma.violationInterceptLog.create({
      data: {
        scene: entry.scene as Prisma.ViolationInterceptLogCreateInput['scene'],
        user_id: entry.user_id,
        target_id: entry.target_id,
        hit_word: entry.hit_word,
        // 偏差说明见文件头：content_hash 承载于 content_snapshot 列
        content_snapshot: entry.content_hash,
        action: entry.action as Prisma.ViolationInterceptLogCreateInput['action'],
      },
    });
  }

  /**
   * 留痕分页查询：按 user/scene 可选过滤，created_at 倒序。
   * 供运营后台复核列表（F22-AC1）与同用户违规历史累计（§4.23 说明）使用。
   */
  async findPage(
    filter: InterceptLogFilter,
    page: number = DEFAULT_PAGE,
    pageSize: number = DEFAULT_PAGE_SIZE,
  ): Promise<{ list: ViolationInterceptLog[]; total: number }> {
    const where: Prisma.ViolationInterceptLogWhereInput = {};
    if (filter.userId !== undefined) {
      where.user_id = filter.userId;
    }
    if (filter.scene !== undefined) {
      where.scene = filter.scene as Prisma.ViolationInterceptLogCreateInput['scene'];
    }
    const [list, total] = await Promise.all([
      this.prisma.violationInterceptLog.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.violationInterceptLog.count({ where }),
    ]);
    return { list, total };
  }
}
