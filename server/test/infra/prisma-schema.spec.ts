/**
 * Prisma schema 结构断言（T-001 收尾验收）
 * 直接读取 prisma/schema.prisma 文本，校验：
 * - 28 个 model 块 / 28 个 @@map 表名
 * - 关键唯一索引与业务索引存在
 * - 每个 model 块均有 @table 注释（聚合映射标注）
 */
import * as fs from 'fs';
import * as path from 'path';

const schemaPath = path.resolve(__dirname, '../../prisma/schema.prisma');
const schema = fs.readFileSync(schemaPath, 'utf-8');

/** 按 model 块切分，返回 { header, body } 列表（header 含模型上方注释） */
function modelBlocks(): Array<{ name: string; header: string; body: string }> {
  const regex = /((?:\/\/[^\n]*\n|\/\/\/[^\n]*\n|\s)*)\bmodel\s+(\w+)\s*\{([\s\S]*?)\n\}/g;
  const blocks: Array<{ name: string; header: string; body: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(schema)) !== null) {
    blocks.push({ name: m[2], header: m[1], body: m[3] });
  }
  return blocks;
}

describe('prisma/schema.prisma 结构断言', () => {
  const blocks = modelBlocks();

  it('包含 28 个 model 块', () => {
    expect(blocks).toHaveLength(28);
  });

  it('包含 28 个 @@map 表名映射', () => {
    const maps = schema.match(/@@map\("/g);
    expect(maps).toHaveLength(28);
  });

  it.each([
    'uk_openid',
    'uk_user_school',
    'uk_user_product',
    'uk_pair_product',
    'uk_order_no',
    'uk_external_txn',
    'uk_order_reviewer',
    'uk_word_type',
    'uk_username',
  ])('唯一索引 %s 存在', (name) => {
    expect(schema).toContain(`"${name}"`);
  });

  it.each([
    'idx_status_deadline',
    'idx_cancel_deadline',
    'idx_status_sla',
    'idx_status_expire',
  ])('业务索引 %s 存在', (name) => {
    expect(schema).toContain(`"${name}"`);
  });

  it('每个 model 块上方均有 @table 注释（聚合映射标注）', () => {
    for (const block of blocks) {
      expect(block.header).toMatch(/@table\s+\w+/);
    }
  });

  it('每个 model 块上方均有 @schema 注释（逻辑归属标注）', () => {
    for (const block of blocks) {
      expect(block.header).toMatch(/@schema\s+(auth|product|chat|trade)/);
    }
  });
});
