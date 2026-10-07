# 校园二手交易平台（campus-trade）

monorepo，三端一仓：

| 目录 | 说明 |
|---|---|
| `miniprogram/` | 用户端微信小程序（原生 + TypeScript），不进 npm workspaces |
| `admin-web/` | 运营管理后台（Vue3 + Vite + Element Plus） |
| `server/` | 后端（NestJS + TypeScript + Prisma + MySQL） |
| `docs/` | 需求/设计/任务文档 |

## 环境要求

- Node.js >= 20（推荐 20 LTS，开发机实测 v22 可用）
- npm >= 10
- 微信开发者工具（仅小程序端需要）

## 从零跑起来

```bash
# 1. 安装依赖（workspaces 会在根目录统一安装 server + admin-web）
npm install
# 国内网络建议先切换镜像：
# npm config set registry https://registry.npmmirror.com

# 2. 后端构建（等价于 cd server && npm run build）
npm run build:server

# 3. 后端测试（含模块边界 ESLint 规则校验）
npm run test:server

# 4. 模块解耦边界检查（跨模块 import 扫描，结果应为零错误）
npm run lint-boundary

# 5. 后台前端（骨架已就绪，可启动开发服务器）
npm run dev --workspace admin-web
```

小程序端：用微信开发者工具导入 `miniprogram/` 目录即可（页面当前仅有首页占位）。

## 模块解耦纪律（docs/design §3.1，强制）

- `server/src/modules/<m>/` 内只允许 import：**本模块相对路径**、`../../contract/*`、`../../infra/*`、`node_modules`；禁止跨模块 import 任何文件。
- 规则由 `server/.eslintrc.js` 的 `no-restricted-imports` 强制，`npm run lint-boundary` 可随时检查；`server/test/infra/eslint-boundary.spec.ts` 在 CI 中保证该规则持续生效。
- contract 层仅限声明（DTO/枚举/错误码），不含逻辑。

## 环境变量

密钥一律走环境变量（`.env` 已在 .gitignore 中，禁止入库）。
