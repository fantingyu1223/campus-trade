/**
 * wantbuy.validator.ts —— 求购发布入参聚合式字段校验 + 模块自含词快照
 *
 * @module PIM-BC-02 商品与供给（求购子域）
 * @model PIM-AG-04 求购聚合
 * @rule CIM-R-08 违禁/违规词硬拦截（scene=want_buy 快照；词表冻结，运行时不可篡改）
 * @api §5.2 #20 POST /want-buys
 *
 * 说明：词快照为模块自含实现（隔离要求：禁止 import product 模块），
 * 思路仿 product/infra-snapshot/word-snapshot.ts 的 Trie 扫描去重命中。
 */
// BusinessError 自 service 导入（循环安全：service → validator 仅值引用 BusinessError 类本身）
import { BusinessError } from './wantbuy.service';

// ==================== 模块自含词快照（scene=want_buy，@rule CIM-R-08） ====================

/** 违禁品词表（求购场景硬拦截） */
export const WANT_BUY_PROHIBITED_WORDS: readonly string[] = Object.freeze([
  '代考',
  '枪支',
  '毒品',
  '管制刀具',
  '假币',
  '香烟',
  '处方药',
  '毕业证代办',
]);

/** 违规行为词表（引流/灰产，求购场景硬拦截） */
export const WANT_BUY_VIOLATION_WORDS: readonly string[] = Object.freeze([
  '加微信',
  '加V',
  '刷单',
  '兼职',
  '代购',
  '私下交易',
  '先款',
  'vx',
]);

type TrieNode = Map<string, TrieNode | true>;

const buildTrie = (words: readonly string[]): TrieNode => {
  const root: TrieNode = new Map();
  for (const word of words) {
    let node = root;
    for (const ch of word) {
      let next = node.get(ch);
      if (!next || next === true) {
        next = new Map();
        node.set(ch, next);
      }
      node = next;
    }
    node.set('', true); // 终止标记
  }
  return root;
};

const WORD_TRIE_ROOT: TrieNode = buildTrie([...WANT_BUY_PROHIBITED_WORDS, ...WANT_BUY_VIOLATION_WORDS]);

/** Trie 扫描文本，返回去重后的命中词（词表原词）；未命中返回空数组 */
export function findHitWords(text: string): string[] {
  const hits = new Set<string>();
  if (!text) return [];
  for (let i = 0; i < text.length; i++) {
    let node: TrieNode | true | undefined = WORD_TRIE_ROOT;
    let j = i;
    while (j < text.length && node instanceof Map) {
      const next: TrieNode | true | undefined = node.get(text[j]);
      if (next === undefined || next === true) break;
      node = next;
      j++;
      if (node instanceof Map && node.get('') === true) {
        hits.add(text.slice(i, j));
      }
    }
  }
  return [...hits];
}

// ==================== 发布字段完整性校验（9001 聚合缺失） ====================

const CONDITION_VALUES: readonly string[] = ['new', 'like_new', 'good', 'fair', 'poor'];
const PRICE_RE = /^\d{1,8}(\.\d{1,2})?$/;

/** 规范化后的发布入参 */
export interface PublishWantBuyInput {
  title: string;
  desc: string;
  categoryId: bigint;
  priceMin: string | null;
  priceMax: string | null;
  conditionLevel: string | null;
}

const asBody = (raw: unknown): Record<string, unknown> => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BusinessError(9001, '缺少必填字段：请求体');
  }
  return raw as Record<string, unknown>;
};

const isBlank = (v: unknown): v is undefined | null | '' =>
  v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

const isValidPrice = (v: unknown): v is string =>
  typeof v === 'string' && PRICE_RE.test(v) && Number(v) > 0;

/**
 * 聚合式校验发布字段（@ac F9-AC1）：
 * 必填：标题（1-128 字）/ 描述（1-1000 字）/ 品类 id（正整数）；
 * 可选：max_price（→price_max）/ price_min（合法价格）、condition_level（成色枚举）。
 * 缺失/非法逐项聚合后抛 9001。
 */
export function validatePublishFields(raw: unknown): PublishWantBuyInput {
  const body = asBody(raw);
  const missing: string[] = [];

  // 标题：1-128 字必填
  const title = body.title;
  if (isBlank(title)) missing.push('标题');
  else if (typeof title !== 'string' || title.length > 128) missing.push('标题');

  // 描述：必填，≤1000 字
  const desc = body.desc;
  if (isBlank(desc)) missing.push('描述');
  else if (typeof desc !== 'string' || desc.length > 1000) missing.push('描述');

  // 品类 id：可转正整数（可为非叶子，存在性由 service 校验）
  const categoryIdRaw = body.category_id;
  let categoryId: bigint | null = null;
  if (isBlank(categoryIdRaw)) missing.push('品类');
  else if (!/^\d+$/.test(String(categoryIdRaw)) || BigInt(String(categoryIdRaw)) <= BigInt(0)) {
    missing.push('品类');
  } else {
    categoryId = BigInt(String(categoryIdRaw));
  }

  // 可选：max_price（契约 #20 字段，落 price_max）须为合法价格
  const maxPriceRaw = body.max_price;
  if (!isBlank(maxPriceRaw) && !isValidPrice(maxPriceRaw)) missing.push('预期价位上限');

  // 可选：price_min 须为合法价格
  const priceMinRaw = body.price_min;
  if (!isBlank(priceMinRaw) && !isValidPrice(priceMinRaw)) missing.push('预期价位下限');

  // 可选：condition_level 须在成色枚举内
  const conditionRaw = body.condition_level;
  if (!isBlank(conditionRaw)) {
    if (typeof conditionRaw !== 'string' || !CONDITION_VALUES.includes(conditionRaw)) {
      missing.push('成色要求');
    }
  }

  if (missing.length > 0) {
    throw new BusinessError(9001, '缺少必填字段：' + missing.join('、'));
  }

  return {
    title: (title as string).trim(),
    desc: desc as string,
    categoryId: categoryId as bigint,
    priceMin: isBlank(priceMinRaw) ? null : (priceMinRaw as string),
    priceMax: isBlank(maxPriceRaw) ? null : (maxPriceRaw as string),
    conditionLevel: isBlank(conditionRaw) ? null : (conditionRaw as string),
  };
}
