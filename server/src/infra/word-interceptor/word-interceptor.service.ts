/**
 * word-interceptor.service.ts —— 违规词通用拦截器（infra 治理侧，F22）
 *
 * @rule CIM-R-08 发布、资料编辑、留言等文本命中违规词表一律拦截，拦截记录留痕供运营复核
 * @ac F22-AC1 命中违规词提交被拦截并提示违规；该次拦截留痕，运营可在后台查看
 * @table word_list（§4.24 只读快照）/ violation_intercept_log（§4.23 留痕 → PIM-BC-06）
 *
 * 定位：infra 级通用拦截入口（§3.1 contract/infra 口径），product/user/chat/
 * wantbuy 等各模块在各自提交路径本地调用（快照消费，不跨模块 import 业务实现）。
 * 词表读取为本地只读快照缓存：首次使用时惰性加载，词表配置变更事件（admin
 * 词表维护 A9）触发 refresh() 主动刷新，运行期不逐请求查库（§4.24 说明：
 * 应用启动缓存 + 变更失效）。
 *
 * 降级策略：词表为空（未配置或词库异常清空）时放行不拦截——拦截器是
 * 治理增强而非业务主链路，宁可漏放不可因词表故障阻断全站文本提交；
 * 词表恢复后 refresh() 即回归正常拦截。
 *
 * 留痕口径（任务清单 T-303）：每次硬拦截按命中词逐词写 violation_intercept_log，
 * 五要素 scene / hit_word / content_hash(sha256 前 16 位) / user_id /
 * action='blocked'，content_hash 承载于 content_snapshot 列（偏差说明见
 * intercept-log.repository.ts 文件头，待架构师裁决）。
 */
import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@contract/index';
import { PrismaService } from '../prisma.service';
import { InterceptLogRepository } from './intercept-log.repository';

/** 业务错误（沿用各模块 BusinessError 惯例：code + message） */
export class BusinessError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'BusinessError';
  }
}

/** 拦截场景枚举（任务清单 T-303：发布/编辑/资料/留言/求购/聊天统一入口） */
export const INTERCEPT_SCENES = [
  'product_publish',
  'product_edit',
  'profile_edit',
  'comment',
  'want_buy',
  'message',
] as const;
export type InterceptScene = (typeof INTERCEPT_SCENES)[number];

/** 拦截入参 */
export interface InterceptInput {
  /** 场景（越界 → 9001） */
  scene: InterceptScene;
  /** 操作用户ID（兼容 string/bigint） */
  userId: string | bigint;
  /** 待检文本 */
  text: string;
  /** 关联对象ID（商品/消息/求购等，可省略 → 留痕 target_id 落 NULL） */
  targetId?: string | bigint;
}

/** 拦截结果：blocked 是否拦截；hits 命中词列表（未命中为空数组） */
export interface InterceptResult {
  blocked: boolean;
  hits: string[];
}

@Injectable()
export class WordInterceptorService {
  /** 本地只读快照缓存（null = 未加载；空数组 = 词表为空，降级放行） */
  private snapshot: string[] | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly logRepo: InterceptLogRepository,
  ) {}

  /**
   * 通用拦截入口：命中违规词 → 逐词写留痕（action='blocked'）并返回 blocked=true；
   * 未命中 / 词表为空 → 放行。
   */
  async intercept(input: InterceptInput): Promise<InterceptResult> {
    if (!INTERCEPT_SCENES.includes(input.scene)) {
      throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, 'scene 非法');
    }
    const words = await this.ensureSnapshot();
    // 降级：词表为空时放行不拦截（见文件头降级策略说明）
    if (words.length === 0) {
      return { blocked: false, hits: [] };
    }
    const hits = words.filter((w) => w.length > 0 && input.text.includes(w));
    if (hits.length === 0) {
      return { blocked: false, hits: [] };
    }
    // CIM-R-08：命中即硬拦截并留痕（同一内容哈希，逐词一条，供运营复核与累计处罚）
    const contentHash = createHash('sha256')
      .update(input.text, 'utf8')
      .digest('hex')
      .slice(0, 16);
    const userId = BigInt(input.userId);
    const targetId = input.targetId === undefined ? null : BigInt(input.targetId);
    for (const hit of hits) {
      await this.logRepo.create({
        scene: input.scene,
        user_id: userId,
        target_id: targetId,
        hit_word: hit,
        content_hash: contentHash,
        action: 'blocked',
      });
    }
    return { blocked: true, hits };
  }

  /**
   * 刷新词表快照：由词表配置变更事件（admin A9 词表维护）触发，
   * 下次拦截立即使用新词表（§4.24：应用缓存 + 变更失效）。
   */
  async refresh(): Promise<void> {
    this.snapshot = await this.loadWords();
  }

  /** 惰性加载快照：首次拦截时读库，之后命中缓存不重复查询 */
  private async ensureSnapshot(): Promise<string[]> {
    if (this.snapshot === null) {
      this.snapshot = await this.loadWords();
    }
    return this.snapshot;
  }

  /** 从 word_list 读取生效中的违规词（F22 拦截用 type=violation + status=active） */
  private async loadWords(): Promise<string[]> {
    const rows = await this.prisma.wordList.findMany({
      where: { type: 'violation', status: 'active' },
    });
    return rows.map((r) => r.word);
  }
}
