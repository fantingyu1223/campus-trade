/**
 * word-snapshot.ts —— 违禁/违规词本地只读快照
 *
 * @rule CIM-R-08 发布前置敏感词硬拦截（标题/描述命中即 blocked 并留痕）
 * @module PIM-BC-02 商品与供给
 * @table word_list → PIM-AG-03
 *
 * 词表以 Object.freeze 冻结，运行时不可篡改；Trie（Map 树）索引，findHits 扫描去重命中。
 */
import { Injectable } from '@nestjs/common';

/** 违禁品词表（硬拦截） */
export const PROHIBITED_WORDS: readonly string[] = Object.freeze([
  '代考',
  '枪支',
  '毒品',
  '管制刀具',
  '假币',
  '香烟',
  '处方药',
  '毕业证代办',
]);

/** 违规行为词表（引流/灰产，硬拦截） */
export const VIOLATION_WORDS: readonly string[] = Object.freeze([
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

@Injectable()
export class WordSnapshot {
  private readonly root: TrieNode = new Map();

  constructor() {
    for (const word of [...PROHIBITED_WORDS, ...VIOLATION_WORDS]) {
      this.insert(word);
    }
  }

  private insert(word: string): void {
    let node = this.root;
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

  /** Trie 扫描文本，返回去重后的命中词（词表原词） */
  findHits(text: string): string[] {
    const hits = new Set<string>();
    if (!text) return [];
    for (let i = 0; i < text.length; i++) {
      let node: TrieNode | true | undefined = this.root;
      let j = i;
      while (j < text.length && node instanceof Map) {
        const next: TrieNode | true | undefined = node.get(text[j]);
        if (next === undefined) break;
        if (next === true) break;
        node = next;
        j++;
        if (node instanceof Map && node.get('') === true) {
          hits.add(text.slice(i, j));
        }
      }
    }
    return [...hits];
  }
}
