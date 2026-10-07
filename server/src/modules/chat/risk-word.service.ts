/**
 * risk-word.service.ts —— 聊天风险词评估与留痕（发送链路风控）
 *
 * @module PIM-BC-03 沟通与协商
 * @model PIM-AG-05 会话与消息聚合（RiskWordHit）
 * @rule CIM-R-32 命中风险词：confirm_risk!==true → BusinessError(3002, {hits}) 消息不落库；
 *      confirm_risk===true → 放行但每次命中写 message_risk_log；未命中直接放行不留痕
 * @rule CIM-R-10 留痕字段固定（sender_id/receiver_id/hit_word/content_snapshot/created_at），不得裁剪
 * @table message_risk_log/word_list → PIM-AG-05
 * @api §5.2 #27 POST /conversations/:id/messages（confirm_risk 语义）
 * @ac F13-AC1 命中风险词发送侧警示、用户可确认继续发送（留痕）
 *
 * 落点：
 *  - evaluate：纯函数式评估（同步、无 IO），命中未确认抛 3002 业务错误（details.hits 供前端弹层）
 *  - logHits：确认放行后的留痕写入——每个命中词一条记录，
 *    level=mid（放行但留痕）/ action=warned（提示后放行），message_id 关联已落库消息
 *    （schema message_id NOT NULL，故留痕必须在消息落库之后执行）
 */
import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@contract/index';
import { PrismaService } from '@infra/prisma.service';
import { BusinessError } from './conversation.service';
import { WordSnapshot } from './infra-snapshot/word-snapshot';

/** 留痕写入入参（五字段 + 关联消息 + 等级/处置） */
export interface RiskLogInput {
  conversationId: bigint;
  messageId: bigint;
  senderId: bigint;
  receiverId: bigint;
  content: string;
  hits: string[];
}

@Injectable()
export class RiskWordService {
  /** 模块自含词快照（@table word_list 冻结基线，禁止 import product 模块词表） */
  private readonly snapshot = new WordSnapshot();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * @rule CIM-R-32 评估发送内容：
   *  - 命中且 confirmRisk!==true → 抛 BusinessError(3002, '消息命中风险词需确认', {hits})，调用方不得落库
   *  - 命中且 confirmRisk===true → 返回 hits（放行，调用方落库后须调 logHits 留痕）
   *  - 未命中（含 content=null 的图片消息）→ 返回 []，不留痕
   */
  evaluate(content: string | null, confirmRisk: boolean): string[] {
    const hits = this.snapshot.findHits(content);
    if (hits.length > 0 && confirmRisk !== true) {
      throw new BusinessError(ERROR_CODES.RISK_WORD_HIT, '消息命中风险词，确认无误后可继续发送', {
        hits,
      });
    }
    return hits;
  }

  /**
   * 确认放行后的留痕：每个命中词各写一条 message_risk_log（@rule CIM-R-10 字段不裁剪）。
   * level=mid / action=warned（§4.14：命中不拦截、提示后放行）。
   */
  async logHits(input: RiskLogInput): Promise<void> {
    for (const hitWord of input.hits) {
      await this.prisma.messageRiskLog.create({
        data: {
          conversation_id: input.conversationId,
          message_id: input.messageId,
          sender_id: input.senderId,
          receiver_id: input.receiverId,
          hit_word: hitWord,
          content_snapshot: input.content,
          level: 'mid',
          action: 'warned',
        },
      });
    }
  }
}
