/**
 * eslint-boundary.spec.ts —— 模块解耦纪律（docs/design §3.1 import 规则）的守护测试
 *
 * 验证两件事：
 *  1. server/.eslintrc.js 存在且配置了 no-restricted-imports 边界规则；
 *  2. 该规则实际生效：对「import 其他模块 service」的违例样本报错，
 *     对合法样本（本模块相对路径 / contract / infra / node_modules）不报错。
 *
 * 违例样本为内存中的临时 fixture（lintText + 虚拟 filePath），不落盘、不污染 src。
 */
import * as fs from 'fs';
import * as path from 'path';
import { ESLint } from 'eslint';

const serverRoot = path.resolve(__dirname, '../..');
const eslintrcPath = path.join(serverRoot, '.eslintrc.js');

const lintSource = (code: string, moduleFile: string): Promise<ESLint.LintResult[]> => {
  const eslint = new ESLint({ cwd: serverRoot, useEslintrc: true });
  return eslint.lintText(code, {
    filePath: path.join(serverRoot, 'src/modules', moduleFile),
  });
};

const boundaryErrors = (results: ESLint.LintResult[]) =>
  results.flatMap((r) => r.messages).filter((m) => m.ruleId === 'no-restricted-imports');

describe('模块边界 ESLint 规则（no-restricted-imports）', () => {
  it('.eslintrc.js 存在且配置了 no-restricted-imports', () => {
    expect(fs.existsSync(eslintrcPath)).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const config = require(eslintrcPath);
    const moduleOverride = (config.overrides ?? []).find(
      (o: { files?: string[] }) =>
        Array.isArray(o.files) && o.files.some((f: string) => f.includes('src/modules')),
    );
    expect(moduleOverride).toBeDefined();
    const rule = moduleOverride.rules['no-restricted-imports'];
    expect(rule).toBeDefined();
    expect(JSON.stringify(rule)).toContain('@contract/');
    expect(JSON.stringify(rule)).toContain('@infra/');
  });

  it('违例样本：import 其他模块的 service 必须报错', async () => {
    // 临时 fixture：auth 模块内的文件 import user 模块的 service —— 违反 §3.1
    const results = await lintSource(
      "import { UserService } from '../user/user.service';\nexport const x = UserService;\n",
      'auth/auth.controller.ts',
    );
    expect(boundaryErrors(results).length).toBeGreaterThan(0);
  });

  it('违例样本：经 ../../ 绕行跨模块 import 同样报错', async () => {
    const results = await lintSource(
      "import { OrderService } from '../../modules/order/order.service';\nexport const x = OrderService;\n",
      'auth/auth.service.ts',
    );
    expect(boundaryErrors(results).length).toBeGreaterThan(0);
  });

  it('合法样本：本模块相对路径 / contract / infra / node_modules 不报错', async () => {
    const results = await lintSource(
      [
        "import { NestFactory } from '@nestjs/common';",
        "import { AuthService } from './auth.service';",
        "import { ErrorCode } from '@contract/index';",
        "import { PrismaClient } from '@infra/index';",
        'export const ok = [NestFactory, AuthService, ErrorCode, PrismaClient];',
        '',
      ].join('\n'),
      'auth/auth.controller.ts',
    );
    expect(boundaryErrors(results)).toHaveLength(0);
  });

  it('modules 之外的文件（src/contract 等）不受边界规则限制', async () => {
    const eslint = new ESLint({ cwd: serverRoot, useEslintrc: true });
    const results = await eslint.lintText(
      "import { something } from '../modules/auth/auth.service';\nexport const y = something;\n",
      { filePath: path.join(serverRoot, 'src/contract/index.ts') },
    );
    expect(boundaryErrors(results)).toHaveLength(0);
  });
});
