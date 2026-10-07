// ESLint 配置（server）
// 核心：用 no-restricted-imports 落地 docs/design §3.1「模块解耦纪律」的 import 规则——
//   src/modules/<m>/** 内的文件只允许 import：
//     1. 本模块内部相对路径（./xxx）
//     2. @contract/* 别名（契约层，仅限声明）
//     3. @infra/* 别名（纯技术设施）
//     4. node_modules（裸包名）
//   禁止 import 其他模块的任何文件（含 service/repository/entity/dto）。
//
// 规则要点：实测结论——no-restricted-imports 的否定模式（'!../../contract/**'）
// 对 ../ 相对路径不生效，故改用「别名方案」：group '../**' 拦截一切「向上一级
// 及以上」的相对导入（含 ../../contract、../../infra 的相对写法）；
// contract/infra 一律经 tsconfig paths 别名 @contract/*、@infra/* 引入，
// 裸导入不被 '../**' 规则匹配，天然放行。
// 别名约定：@contract/* -> src/contract/*，@infra/* -> src/infra/*
// （tsconfig.json / tsconfig.build.json paths + jest moduleNameMapper +
//  运行时 tsconfig-paths/register 三处保持一致）。
//
// 使用说明：
//   npm run lint            # 检查全部 src + test
//   npm run lint-boundary   # 只扫 src/modules/**，跨模块 import 应零错误（CI 检查点）
// 规则有效性由 test/infra/eslint-boundary.spec.ts 守护。
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  env: {
    node: true,
    es2021: true,
    jest: true,
  },
  ignorePatterns: ['dist/', 'node_modules/', 'coverage/'],
  rules: {},
  overrides: [
    {
      files: ['src/modules/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['../**'],
                message:
                  '模块解耦纪律（§3.1）：modules/<m>/ 内只允许 import 本模块相对路径（./）、@contract/*、@infra/* 别名或 node_modules，禁止任何 ../ 上溢导入。',
              },
            ],
          },
        ],
      },
    },
  ],
};
