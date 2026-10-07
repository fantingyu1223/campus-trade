/**
 * infra-snapshot/word-snapshot.ts —— chat 模块自含风险词快照（隔离纪律：禁止 import product 模块）
 *
 * @module PIM-BC-03 沟通与协商
 * @model PIM-AG-05 会话与消息聚合（RiskWordHit 词命中值来源）
 * @table word_list → PIM-AG-05（type=risk 风险词库的运行期冻结快照，@ac F13-AC3 常驻安全提示同源）
 *
 * 说明：PRD §8.1 风险词表首期词集。词库后台可配（§4.24 word_list），
 * 本快照为模块自含冻结基线，运行期词库接入后由快照注入替换（构造注入词表）。
 */

/** 首期风险词冻结数组（PRD §8.1，高危/中危各取代表词，共 10 个） */
export const RISK_WORDS: readonly string[] = Object.freeze([
  '先转账',
  '先打款',
  '加微信',
  '加QQ',
  '保证金',
  '押金',
  '手续费',
  '解冻费',
  '代付',
  '扫码付款',
]);

/**
 * 词快照：对一段文本做包含匹配，返回全部命中词（按词表顺序去重前的原始序）。
 * 词表默认取 RISK_WORDS 冻结基线，可注入自定义词表（运行期词库快照隔离）。
 */
export class WordSnapshot {
  constructor(private readonly words: readonly string[] = RISK_WORDS) {}

  /** 返回文本中命中的全部风险词；空文本/null/undefined → 空数组 */
  findHits(text: string | null | undefined): string[] {
    if (!text) {
      return [];
    }
    return this.words.filter((w) => text.includes(w));
  }
}
