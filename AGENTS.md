# AGENTS.md —— 校园二手交易平台（campus-trade）

> 本文件面向 AI 编码代理，描述本仓库的结构、约定与工作方式。阅读前无需任何先验知识。
> 项目文档与注释以中文为主，本文件同样使用中文。

## 1. 项目概览

校园二手交易平台，monorepo「三端一仓」，单人开发、模块化单体架构（设计决策见 `docs/design/2026-02-06-技术选型与总体方案.md`，架构形态 B：模块化单体，单体部署）。

| 目录 | 说明 |
|---|---|
| `miniprogram/` | 用户端微信小程序（原生小程序 + TypeScript），**不进 npm workspaces**，用微信开发者工具导入开发 |
| `admin-web/` | 运营管理后台（Vue 3 + Vite + Element Plus + Pinia + vue-router） |
| `server/` | 后端（NestJS 10 + TypeScript + Prisma 5 + MySQL 8） |
| `deploy/` | `docker-compose.yml`，仅含 MySQL 8.0 容器（root/campus123，库 `campus_trade`，utf8mb4） |
| `docs/` | 全套文档：`prd/` 需求（PRD 已冻结）、`design/` 设计、`tasks/` 任务清单、`qa/` 验收用例、`ops/` 运行指南、`meeting/` 会议纪要、`agent-team.md` 团队协作规范 |
| `Modeling/` | 建模文档（cim/ontology/pim/psm 分层 + traceability 追溯） |
| `scripts/` | `check-cross-module-imports.sh`（模块边界扫描）、`sign-admin-token.py`（签发本地调试用 admin JWT） |

环境要求：Node.js >= 20、npm >= 10、微信开发者工具（仅小程序端）。

## 2. 构建与运行命令

根 package.json 的 workspaces 只有 `server` 和 `admin-web`（小程序独立）。

```bash
npm install                        # 根目录统一安装 server + admin-web
npm run build:server               # 后端 tsc 构建（等价于 cd server && npm run build）
npm run test:server                # 后端 jest 测试
npm run lint:server                # eslint 全量（src + test）
npm run lint-boundary              # 只扫 server/src/modules/**，模块边界检查
npm run dev --workspace admin-web  # 后台前端 vite dev（端口 5173）
npm run build --workspace admin-web# admin-web 构建（vue-tsc --noEmit && vite build）
```

server 内部（`cd server`）：

```bash
npm run dev                # ts-node 直跑 src/main.ts（非 watch，改代码需重启），端口 3000
npm run prisma:generate    # 生成 Prisma Client（CI 中必须显式执行，否则 tsc 失败）
npm run prisma:migrate     # prisma migrate dev
```

本地全链路启动详见 `docs/ops/2026-02-06-本地运行指南.md`：docker compose 起 MySQL → `prisma migrate deploy` + 导入 `prisma/seed.sql`（必须带 `--default-character-set=utf8mb4`）→ server dev → admin-web vite → 微信开发者工具导入 miniprogram。

**已知遗留**：`npm run build && npm start`（生产构建）不可用——tsc 不重写 `@infra/*`、`@contract/*` 路径别名导致 MODULE_NOT_FOUND，需接入 `tsc-alias` 后方可生产部署；本地开发走 `npm run dev`（ts-node + tsconfig-paths）不受影响。

## 3. 服务端架构与路由口径

- 全局前缀：业务接口统一 `api/v1`（控制器 path 不含前缀）；admin 控制器自带 `admin/v1` 前缀并豁免全局前缀（`main.ts` 中 exclude 配置，path-to-regexp 3.x 通配写法是 `(.*)`）；`/health` 健康检查同样豁免。
- 全局过滤器 `BusinessErrorFilter`：BusinessError 包络为 `{code, message, data}`，HttpException 按原生语义透传。
- CORS 开发期全放开；`/static/*` 映射 `server/public/*`（COS 未开通前的图片本地占位）。
- admin-web 的 vite dev 将 `/api` 与 `/admin` 代理到 `http://localhost:3000`。

### 目录分层（server/src）

```
src/
├── main.ts / app.module.ts / health.controller.ts
├── contract/     # 契约层：DTO + 枚举 + 错误码，唯一事实源，只允许声明，禁止任何逻辑函数
├── infra/        # 纯技术设施：auth（JWT guard、wx code2session）、http（异常过滤）、
│                 #   prisma.service、word-interceptor（违禁词拦截）、notify-sender、admin-log
├── jobs/
└── modules/      # 业务模块：auth / user / product / wantbuy / chat / order / review /
                  #   report / notify / admin（admin 内再分 governance 与 support 两个子模块）
```

模块内部惯例：`*.controller.ts`（路由）、`*.service.ts`（业务）、`*.repository.ts`（Prisma 数据访问）、`*.validator.ts`（入参校验）、`dto/`、`*.module.ts`；定时任务为 `*.cron.ts`（如订单超时、求购过期、举报 SLA、风控扫描）。

### 模块解耦纪律（docs/design §3.1，强制，违反即 CI 红）

- `server/src/modules/<m>/**` 内只允许 import：**本模块相对路径（`./`）**、**`@contract/*` 别名**、**`@infra/*` 别名**、**node_modules 裸包名**。
- **禁止任何 `../` 上溢导入**（即禁止跨模块 import 其他模块的 service/repository/entity/dto 等一切文件）。
- 强制执行方式有三层，修改模块代码后必须通过：
  1. `server/.eslintrc.js` 的 `no-restricted-imports`（`group: ['../**']`）；
  2. `scripts/check-cross-module-imports.sh`（grep 扫描，CI 步骤）；
  3. `server/test/infra/eslint-boundary.spec.ts`（守护 ESLint 规则持续生效）。
- 注意实现细节：`no-restricted-imports` 的否定模式对 `../` 不生效，因此 contract/infra **必须经别名引入**（写 `../../contract/...` 会被拦截）。别名三处保持一致：`tsconfig.json` / `tsconfig.build.json` 的 paths、jest `moduleNameMapper`、运行时 `tsconfig-paths/register`。
- contract 层纪律由 `server/test/contract/contract-sync.spec.ts` 强制：该文件还校验 `server/src/contract` 与 `miniprogram/types/contract.ts`、`admin-web/src/types/contract.ts` **三端拷贝同步**（枚举键集合、错误码键值完全一致）。**修改契约时必须三端同步修改，否则测试失败。**

### 数据库（server/prisma/schema.prisma，单一事实源，28 张表）

已定决策（schema 头部注释明确「禁止偏离」）：

1. 单物理库 + 每模型 `@schema` 注释标注逻辑归属（auth/product/trade/chat），不用 Prisma multiSchema；
2. **不设物理外键**，FK 关系用字段注释「FK→」标注，一致性由应用层事务保证；
3. 枚举用 Prisma enum（英文值 + 中文注释），落为 MySQL ENUM；
4. 模型名 PascalCase + `@@map` 映射原表名；字段名 snake_case 与列同名；
5. 时间一律 `DATETIME(0)`（`@db.DateTime(0)`）；金额 `DECIMAL(10,2)`；BIGINT 用 `BigInt @db.UnsignedBigInt`；
6. product 表 FULLTEXT 索引（ngram parser）Prisma 不支持声明，在 migration.sql 末尾手工追加。

## 4. 前端两端约定

### admin-web（Vue 3 + Vite + TS）

- `src/api/*.ts` 按业务域分文件（auth/account/appeal/governance/school/word-list）；`src/views/` 按 `governance/`、`school/` 分目录；`src/router/index.ts` 单路由表。
- 路径别名 `@` → `./src`。
- 后台管理员 token 存 `localStorage('admin_token')`；本地联调可用 `python scripts/sign-admin-token.py [admin_id] [role] [ttl_days]` 手工签发注入。
- 构建命令含 `vue-tsc --noEmit`，类型错误会阻塞构建。

### miniprogram（原生小程序 + TS）

- 独立 package.json（仅 devDependencies：typescript + miniprogram-api-typings），不经过 npm workspaces，无构建脚本——微信开发者工具直接编译 TS。
- `config.ts` 是全局配置单点，`API_BASE` 切换环境（模拟器 localhost / 真机局域网 IP / 生产域名）。
- 结构：`pages/`（20+ 页面，如 index/publish/product-detail/order-detail/chat 等）、`components/`（product-card、want-buy-card、各类 modal 等）、`services/api/`（按业务域封装的请求层）、`utils/session.ts`、`types/contract.ts`（契约拷贝）。
- 登录走微信 `wx-login`，开发期后端 `WX_MOCK=true` 时任意 code 即 openid（自动注册新用户）。
- 无自动化测试；`miniprogram/test/` 与 `admin-web/test/` 下是**人工验收 checklist**（u1-u4.checklist.md 等，对应任务编号）。

## 5. 测试策略

- 后端：Jest + ts-jest，测试全部在 `server/test/` 下，按模块名分目录（auth/product/order/admin/... 与 src/modules 对应），`*.spec.ts`，共 30+ 个；另有 `test/contract/`（三端契约同步）、`test/infra/`（边界规则、schema、违禁词、操作日志）两类横切测试。
- 测试一般为单元/服务级，不依赖真实 MySQL（CI 只跑 prisma generate + tsc + jest，无数据库服务）。
- 前端两端无自动化测试，用 checklist 人工验收；`docs/qa/` 有分批验收用例。
- CI（`.github/workflows/ci.yml`，push/PR 触发，Node 20）：`npm ci` → prisma generate → server build → server test → 跨模块 import 扫描 → admin-web build（**当前 continue-on-error，骨架阶段容忍失败**）。

## 6. 代码风格与开发约定

- TypeScript strict 模式（`tsconfig.base.json`：strict、experimentalDecorators、ES2021、commonjs）；server 用 NestJS 装饰器 + 依赖注入风格。
- 注释与文档一律中文；注释常带契约/设计文档引用（如「契约 §5.3」「裁决 10」「F26」），修改行为时同步更新相关注释。
- ESLint 仅在 server 配置（`server/.eslintrc.js`，flat 前的 eslintrc 格式，规则主体就是模块边界）；admin-web 无 lint 配置。
- 文档驱动的开发流程（见 `docs/agent-team.md`）：PRD 冻结，API 契约（设计文档 §5）冻结后任何变更须走评审并记会议纪要；文档按 `prd/design/tasks/qa/ops/meeting` 分类归档，文件名带日期前缀 `YYYY-MM-DD-主题.md`。

## 7. 安全与配置注意事项

- 密钥一律走环境变量，`.env` 已在 .gitignore，**禁止入库**。server 读取的变量：`DATABASE_URL`、`JWT_SECRET`（缺省 `campus-trade-dev-secret`，仅开发）、`WX_APPID`/`WX_SECRET`、`WX_MOCK=true`（开发期 mock 微信登录）、`PORT`（默认 3000），以及各 cron 开关（`ORDER_TIMEOUT_CRON_ENABLED`、`WANT_BUY_EXPIRE_CRON_ENABLED`、`REVIEW_DEFAULT_CRON_ENABLED`、`MERCHANT_SLA_CRON_ENABLED`、`REPORT_SLA_CRON_ENABLED`、`RISK_SCAN_CRON_ENABLED`，值 `'1'` 才启用）。
- JWT 守卫：`infra/auth/jwt.guard.ts`（用户端）、`admin-jwt.guard.ts`（后台）、`verified.guard.ts`（需校园认证）。
- 实名信息不出站；违禁词拦截（word-interceptor）与举报/风控链路是核心合规机制。
- `deploy/docker-compose.yml` 中的 MySQL 密码 `campus123` 仅为本地开发用途。

## 8. 给代理的速查清单

1. 改 server 模块代码 → 跑 `npm run lint-boundary` 与 `npm run test:server`，确保零边界违规、测试全绿。
2. 改 `server/src/contract/*` → 必须同步 `miniprogram/types/contract.ts` 与 `admin-web/src/types/contract.ts`（`contract-sync.spec.ts` 会拦）。
3. 在 modules 内需要引用共享内容 → 只能经 `@contract/*` 或 `@infra/*` 别名；写 `../` 会被三层机制拦截。
4. 改数据库 → 遵守 schema.prisma 头部 6 条已定决策；`prisma migrate` 后记得 `prisma:generate`。
5. 提交前对照 CI 五步：npm ci → prisma generate → build:server → test:server → check-cross-module-imports.sh。
