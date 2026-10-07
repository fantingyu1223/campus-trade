/**
 * contract 三端同步校验（T-003）。
 *
 * 校验项：
 * 1. server/src/contract 与 miniprogram/types/contract.ts、admin-web/src/types/contract.ts
 *    三处的枚举键集合、错误码键值完全一致；
 * 2. 错误码无重复值（同一数值全站语义唯一）；
 * 3. 枚举值无魔法字符串（全部为小写 snake_case，且抽查订单五态取值）；
 * 4. contract 层纪律：server/src/contract/*.ts 中不出现 function / =>（注释除外）。
 */
import * as fs from 'fs';
import * as path from 'path';
import * as serverContract from '@contract/index';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const FRONTEND_CONTRACT_FILES = [
  path.join(ROOT, 'miniprogram', 'types', 'contract.ts'),
  path.join(ROOT, 'admin-web', 'src', 'types', 'contract.ts'),
];
const SERVER_CONTRACT_DIR = path.resolve(__dirname, '..', '..', 'src', 'contract');

/** 剥离 TS 源码中的行注释与块注释（本层无字符串模板嵌套注释，简单正则够用） */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** 从源码文本提取全部 `export enum Xxx { ... }` 的 { 枚举名: 成员键集合 } */
function extractEnumKeys(source: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  const enumRe = /export\s+enum\s+(\w+)\s*\{([^}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = enumRe.exec(source)) !== null) {
    const [, name, body] = match;
    const keys: string[] = [];
    const memberRe = /^\s*(\w+)\s*=/gm;
    let m: RegExpExecArray | null;
    while ((m = memberRe.exec(body)) !== null) {
      keys.push(m[1]);
    }
    result[name] = keys;
  }
  return result;
}

/** 从源码文本提取 `export const ERROR_CODES = { ... } as const` 的键值对 */
function extractErrorCodes(source: string): Record<string, number> {
  const re = /export\s+const\s+ERROR_CODES\s*=\s*\{([\s\S]*?)\}\s*as\s+const/;
  const match = re.exec(source);
  if (!match) {
    throw new Error('未找到 ERROR_CODES 常量声明');
  }
  const result: Record<string, number> = {};
  const kvRe = /(\w+)\s*:\s*(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = kvRe.exec(match[1])) !== null) {
    result[m[1]] = Number(m[2]);
  }
  return result;
}

// 服务端契约（编译期导入，作为基准）
const serverEnums: Record<string, Record<string, string>> = {};
for (const [name, value] of Object.entries(serverContract)) {
  if (name === 'ERROR_CODES') continue;
  if (typeof value === 'object' && value !== null) {
    serverEnums[name] = value as Record<string, string>;
  }
}
const serverErrorCodes: Record<string, number> = { ...serverContract.ERROR_CODES };

describe('contract 层自身规范性', () => {
  it('基准枚举数量与错误码数量符合 T-003 交付口径', () => {
    expect(Object.keys(serverEnums).length).toBe(23);
    expect(Object.keys(serverErrorCodes).length).toBe(30);
  });

  it('错误码无重复值（同一数值全站语义唯一）', () => {
    const values = Object.values(serverErrorCodes);
    expect(new Set(values).size).toBe(values.length);
  });

  it('枚举值无魔法字符串：全部为小写 snake_case', () => {
    for (const [enumName, members] of Object.entries(serverEnums)) {
      for (const [key, value] of Object.entries(members)) {
        expect({ enumName, key, value }).toEqual({
          enumName,
          key,
          value: expect.stringMatching(/^[a-z][a-z0-9_]*$/) as unknown as string,
        });
      }
    }
  });

  it('枚举取值抽查：订单五态与文档 §4.17 一致', () => {
    expect(Object.values(serverContract.OrderStatus)).toEqual([
      'pending_delivery',
      'pending_confirm',
      'completed',
      'cancelled',
      'appealing',
    ]);
  });

  it('枚举取值抽查：商品四态与 PIM-SM-02 一致', () => {
    expect(Object.values(serverContract.ProductStatus)).toEqual([
      'on_sale',
      'off_sale',
      'trading',
      'sold',
    ]);
  });

  it('错误码分段抽查：成功/认证/商品/订单/系统', () => {
    expect(serverContract.ERROR_CODES.SUCCESS).toBe(0);
    expect(serverContract.ERROR_CODES.AUTH_TOKEN_INVALID).toBe(1001);
    expect(serverContract.ERROR_CODES.PRODUCT_NOT_FOUND).toBe(2001);
    expect(serverContract.ERROR_CODES.ORDER_NOT_FOUND).toBe(4001);
    expect(serverContract.ERROR_CODES.INTERNAL_ERROR).toBe(9999);
  });
});

describe('contract 层纪律：仅限声明', () => {
  it('server/src/contract/*.ts 中不出现 function / =>（注释除外）', () => {
    const files = fs
      .readdirSync(SERVER_CONTRACT_DIR)
      .filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = fs.readFileSync(path.join(SERVER_CONTRACT_DIR, file), 'utf8');
      const code = stripComments(source);
      expect({ file, hit: /function/.test(code) }).toEqual({ file, hit: false });
      expect({ file, hit: /=>/.test(code) }).toEqual({ file, hit: false });
    }
  });
});

describe('三端拷贝同步', () => {
  for (const file of FRONTEND_CONTRACT_FILES) {
    describe(path.relative(ROOT, file), () => {
      const source = fs.readFileSync(file, 'utf8');

      it('文件头含「由 server/src/contract 同步，仅声明，勿手改」标识', () => {
        expect(source).toContain('由 server/src/contract 同步');
        expect(source).toContain('勿手改');
      });

      it('枚举名称集合与 server 端一致', () => {
        const frontendEnums = extractEnumKeys(source);
        expect(Object.keys(frontendEnums).sort()).toEqual(
          Object.keys(serverEnums).sort(),
        );
      });

      it('每个枚举的成员键集合与 server 端一致', () => {
        const frontendEnums = extractEnumKeys(source);
        for (const [name, members] of Object.entries(serverEnums)) {
          expect({ name, keys: frontendEnums[name] ?? [] }).toEqual({
            name,
            keys: Object.keys(members),
          });
        }
      });

      it('错误码键值与 server 端完全一致', () => {
        const frontendCodes = extractErrorCodes(source);
        expect(frontendCodes).toEqual(serverErrorCodes);
      });

      it('拷贝自身也不含 function / =>（注释除外）', () => {
        const code = stripComments(source);
        expect(/function/.test(code)).toBe(false);
        expect(/=>/.test(code)).toBe(false);
      });
    });
  }
});
