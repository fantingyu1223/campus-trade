# 双向可追溯矩阵（Traceability Matrix）

- **模型层级**：追溯层（Traceability，贯穿 本体/CIM/PIM/PSM 四层，非独立模型层，是四层之间的映射索引）
- **版本**：v1.0
- **作者**：mda-engineer
- **日期**：2026-10-06
- **状态**：已发布（CEO 审核通过 2026-02-06）
- **输入来源**：
  - `docs/prd/2026-02-06-校园二手平台完整PRD.md` v1.0（冻结）：§5 功能需求 F1-F39（共 40 条目，含 F10a/F10b），P0 共 18 项
  - `Modeling/ontology/领域本体.md` v1.0（ONT-01~20）
  - `Modeling/cim/业务领域模型.md` v1.0（CIM-E-01~10）、`Modeling/cim/业务流程与规则.md` v1.0（CIM-P-01~05、CIM-R-01~36）
  - `Modeling/pim/限界上下文与聚合.md` v1.0（PIM-BC-01~06、PIM-AG-01~10）、`Modeling/pim/领域事件与状态机.md` v1.0（PIM-SM-01~05、PIM-EV-01~15）
  - `Modeling/psm/平台映射模型.md` v1.0（PSM-01~06 映射、28 表、PSM-INC-01~05）
- **转换留痕**：本文件不做新取舍，仅把四层已有元素按 PRD 功能编号对齐成矩阵；各层取舍分别留痕于各模型文件头部与章节内。填写口径：每格填编号，一格可多编号，无对应填"—"；PSM 列格式为"表 / 接口（§5 编号）/ 模块"。

---

## 1. 正向追溯主表（PRD 功能 → 本体 → CIM → PIM → PSM，40 行全覆盖）

| F 编号+名称（优先级） | 本体 ONT | CIM 元素 | PIM 元素 | PSM 元素（表 / 接口 / 模块） |
|---|---|---|---|---|
| F1 三类身份认证（P0） | ONT-08/09/10/11/12/13 | E-01；R-01/02/03 | BC-01；AG-01 | `user`+`identity_verification` / §5.2 auth 分组 / auth 模块 |
| F2 个人/商家主页（P0） | ONT-08/12 | E-01；R-28 | BC-01；AG-02 | `user`（档案字段组）/ §5.2 user 分组 / user 模块 |
| F3 头像/昵称/简介编辑（P1） | ONT-08 | E-01；R-08 | AG-02（资料编辑经词校验） | `user` / §5.2 user 分组 / user 模块 |
| F4 信用分/等级体系（P2） | ONT-14 | E-06（信用沉淀） | AG-02（CreditSummary 读模型）；EV-15 | —（P2 未排期；读模型投影预留，不落表） |
| F5 商品发布（P0） | ONT-01 | E-02；P-01；R-05/06/07/08 | BC-02；AG-03；SM-02；EV-08 | `product`+`product_image` / #10-11 / product 模块 |
| F6 分类浏览搜索筛选排序（P0） | ONT-01 | E-02 | AG-03（检索读模型） | `product`+`category` / §5.2 product 查询分组 / product 模块 |
| F7 商品状态管理（P0） | ONT-01/20 | E-02；R-13 | AG-03；SM-02；EV-09/10 | `product.status`+`sold_buyer_id` / #12/#13 / product 模块 |
| F8 商品收藏/想要（P1） | ONT-01 | E-02 | AG-03（Favorite 弱实体） | `favorite` / §5.2 favorite 分组 / product 模块 |
| F9 求购专区（P0） | ONT-02 | E-03；R-33 | BC-02；AG-04；SM-03；EV-11/12 | `want_buy` / #20-23 / wantbuy 模块 |
| F10a 急出标签（P1） | ONT-01 | E-02；R-09 | AG-03（UrgentBadge） | `product` 急出字段组 / #10 急出参数 / product 模块 |
| F10b 毕业季专区运营位（P2） | — | — | — | admin/support zone 分组（运营位配置，P2 未排期建模） |
| F11 视频/AI 识物/智能定价（P2） | — | — | — | — |
| F12 站内沟通（P0） | ONT-06/07 | E-04；R-01/04 | BC-03；AG-05 | `conversation`+`message` / §5.2 chat 分组 / chat 模块 |
| F13 防诈骗提示（P0） | ONT-07 | R-10/32 | AG-05（RiskWordHit）；AG-06（付款前明示守卫） | `message_risk_log`+`word_list` / chat 发送链路 + #30 前置校验 / chat、order 模块 |
| F14 交易意向确认（P1） | ONT-06 | E-04；R-14 | AG-05（TradeIntentCard）；EV-01 触发源 | `trade_intent` / #29 / chat 模块 |
| F15 消息通知（P1） | — | — | BC-06（通知触达支撑能力）；EV-01~15 订阅侧 | `notification` / §5.2 通知分组 / infra/notify-sender（暂定） |
| F16 砍价/报价工具（P2） | — | — | — | — |
| F17 交易评价（P0） | ONT-14 | E-06；R-29/30 | BC-05；AG-07；SM-05；EV-15 | `review` / #38-39 / review 模块 |
| F18 举报（P0） | ONT-15 | E-07；P-04；R-20 | BC-05；AG-08；EV-13 | `report` / #40 / report 模块（写） |
| F19 官方验机/鉴定（P2） | — | — | — | — |
| F20 举报处理队列（P0） | ONT-15 | E-07；P-04；R-21/22 | AG-08（SlaDeadline/DisposalResult）；EV-14 | `report` / #54-56 / admin/governance（暂定） |
| F21 商品/用户/商家审核与处置（P0） | ONT-12/15 | R-23 | AG-08（三件套不变量）；EV-14 | `merchant_ban_list`+`violation_intercept_log` / #56/#57-60 / admin/governance（暂定） |
| F22 违禁品/违规词识别拦截（P1） | — | R-08 | BC-05（复核侧）；BC-06（词表管理） | `word_list`+`violation_intercept_log` / infra 拦截器 + config-snapshot（暂定） |
| F23 黄牛/伪装商家识别（P1） | ONT-10/12 | R-36 | BC-05（风控复核） | `risk_warning` / §5.3 风控复核分组 / admin/governance（暂定） |
| F24 运营数据看板（P2） | — | — | BC-06 | admin/support dashboard 分组（P2 未排期建模） |
| F25 商品留言区（P2） | — | — | — | — |
| F26 账号注销与资料删除（P0） | ONT-08 | E-01；R-34 | AG-01（已注销终态不变量） | `user` 注销字段组 / §5.2 auth 分组 / auth 模块 |
| F27 认证有效期与毕业处置（P1） | ONT-09/10 | E-01；R-35 | AG-01（ClearancePeriod） | `user` 清仓字段组 / jobs cron 毕业处置 / auth 模块 |
| F28 商品/平台分享（P1） | — | — | — | —（纯客户端转发，无服务端模型） |
| F29 拉黑用户（P1） | ONT-06/08 | R-04 | AG-02（BlockRelation） | `block` / §5.2 user 分组 / user 模块 |
| F30 纠纷申诉流程（P1） | ONT-16/17/18 | E-08；R-18/31 | BC-05；AG-09；SM-01（申诉中）；EV-06/07 | `appeal` / #42、#67 / report 模块（写）+ admin/governance（裁决，暂定） |
| F31 被处理账号/商家申诉（P1） | ONT-16 | E-08；R-24 | AG-09（AppealWindow 7 天） | `appeal` / #42-43、#67 / report + admin/governance（暂定） |
| F32 商家入驻审核（P0） | ONT-09/12 | E-09；P-05；R-25/26/27 | BC-01；AG-10；SM-04 | `merchant_application` / #7-9、#61-64 / auth（提交侧，暂定）+ admin/governance（审核侧） |
| F33 商家标识与区分展示（P0） | ONT-12 | R-28 | AG-02（标识不可关闭不变量） | `user.identity_type` / 全链路读侧字段 / user、product 模块 |
| F34 双模式交易流程（P0） | ONT-03/04/05/19/20 | E-05；P-02；R-10/11/12/14 | BC-04；AG-06；SM-01；EV-01~04 | `trade_order`+`order_event`+`payment_record` / #29-32、#36 / order 模块 |
| F35 取消/拒收与超时确认（P0） | ONT-17/18/19 | P-03；R-15/16/17/18/19 | SM-01（取消子状态/拒收/超时迁移）；EV-05 | `trade_order` cancel_* 字段组 / #33-35 + jobs cron / order 模块 |
| F36 高校名单管理（P0） | ONT-09 | E-10；R-02 | BC-01（消费）；BC-06（维护） | `school`+`school_join_application` / §5.3 school 分组 / admin/support（写，暂定）+ auth（读） |
| F37 当面自提双向交接确认（P2） | ONT-05 | —（P2，仅留痕不强制，未建流程） | — | — |
| F38 跨校交接安全提示与地点扩展（P1，顺延） | ONT-05 | —（首期顺延） | — | — |
| F39 爽约标记（P2） | — | — | — | — |

**覆盖结论**：
- 主表共 **40 行**（F1-F39 含 F10a/F10b），与 PRD §5 条目一一对应。
- **P0 共 18 项（F1/F2/F5/F6/F7/F9/F12/F13/F17/F18/F20/F21/F26/F32/F33/F34/F35/F36），行行链路完整**（本体→CIM→PIM→PSM 四列无空缺）。
- 全"—"或近全"—"行共 8 条，全部为 P1 顺延/P2 条目（F4、F10b、F11、F16、F19、F24、F25、F28、F37、F38、F39 中按上表所示），符合排期裁决，不构成缺口；F4/F10b/F24 虽有部分列命中，但 PSM 不落库，标注预留。

---

## 2. 反向抽查表（PSM → PRD，10 个关键元素）

| # | PSM 元素 | → PIM | → CIM | → 本体 | → PRD 功能 | 结果 |
|---|---|---|---|---|---|---|
| 1 | `trade_order` 表 | AG-06；SM-01 | E-05；P-02/P-03 | ONT-03 | **F34、F35** | ✅ |
| 2 | `message_risk_log` 表 | AG-05（RiskWordHit） | R-32 | ONT-07 | **F13** | ✅ |
| 3 | `POST /orders`（#30） | EV-01；SM-01 `[*]→待交货` | P-02 | ONT-03/04 | **F34**（含 F13 付款前明示前置校验） | ✅ |
| 4 | `report` 表 | AG-08；EV-13/14 | E-07；P-04 | ONT-15 | **F18、F20、F21** | ✅ |
| 5 | `merchant_application` 表 | AG-10；SM-04 | E-09；P-05 | ONT-09/12 | **F32**（联动 F21/F31） | ✅ |
| 6 | `word_list` 表 | BC-06（词表管理）→ 各 BC 快照消费 | R-08、R-32 | —（配置对象，ONT 未单列） | **F13、F22** | ✅ |
| 7 | `notification` 表 | BC-06；EV-01~15 订阅侧 | —（通知无独立 CIM 实体） | — | **F15**（承载 F9/F17/F20/F30 等触达） | ✅ |
| 8 | `want_buy` 表 | AG-04；SM-03；EV-11/12 | E-03；R-33 | ONT-02 | **F9** | ✅ |
| 9 | `review` 表 | AG-07；SM-05；EV-15 | E-06；R-29/30 | ONT-14 | **F17** | ✅ |
| 10 | `admin_operation_log` 表 | BC-06（操作留痕支撑） | R-34（调阅留痕） | — | **间接支撑 F20/F21/F32**（处置操作审计，N9 口径）；无直接功能行 | ✅（间接，已标注） |

**反向抽查通过率：10/10**（9 条直接反查到功能行，1 条 admin_operation_log 为治理操作审计留痕，属间接支撑，已在正向表 F20/F21/F32 行的 PSM 列经 admin/governance 覆盖，不构成断链）。

---

## 3. 追溯维护规则

1. **变更同步点**：
   - PRD 功能变更（新增/修改/降级 F 条目）→ 改本文件 §1 对应行，并顺链检查该行 ONT→CIM→PIM→PSM 各列是否需要联动修改；每格改动须回写对应模型文件并在其"转换留痕"标注。
   - 本体概念变更（ONT-xx 语义/口径常量）→ 用本矩阵反查所有引用该 ONT 的行，逐行评估 CIM/PIM/PSM 影响面；口径常量（24h/48h/7 天/30 天/2 工作日）同步改本体 §5 与各层守卫。
   - CIM 元素变更（E/P/R 增改）→ 顺链改 PIM 聚合/状态机对应编号与本矩阵该行；规则编号"不复用不改号"，废止只标注不删号。
   - PIM 元素变更（BC/AG/SM/EV）→ 顺链改 PSM 映射表（PSM-01~04）与本矩阵 PSM 列；新增事件必须先入 PIM-EV 清单再走 PSM-04 映射。
   - PSM 元素变更（表/接口/模块）→ 反向更新本矩阵 §1 的 PSM 列，并核查 §2 反向抽查表是否仍成立；表结构改动回指 `prisma/schema.prisma` 单一事实源。
2. **每批开发交付核实口径（CEO 用）**：① 实现的每个功能在本矩阵 §1 中有行；② 该行 ONT/CIM/PIM/PSM 四列无意外空缺（P1 顺延/P2 行的"—"须与排期裁决一致）；③ 实现的表/接口能按 §2 方式反查到功能行，反查不到即为"无来源实现"，须退回补模或走变更。
3. **编号纪律**：ONT/CIM-E/P/R/PIM-BC/AG/SM/EV/PSM-INC 各序列编号一经发布不复用、不改号；废弃元素保留编号并标注"已废止"。
4. **不一致处理**：发现 PRD/契约/实现三方不一致时，登记到 §4，本角色只上报不裁决；裁决结果回填对应模型层与本矩阵。

---

## 4. 未闭环问题登记（汇总各层上报，共 13 条）

| 编号 | 来源层 | 问题 | 临时口径 | 状态 |
|---|---|---|---|---|
| CIM-U-1 | CIM | `业务流程与规则.md` CIM-P-05 流程图中驳回申诉节点自引用"走 CIM-P-05 申诉环节"，而申诉实际无独立 CIM 流程（并入 P-04 衔接），指向含糊 | — | **已裁决（2026-02-06 CEO）**：确认系笔误，已修正为指向举报处置后申诉救济衔接（R-24/R-31），不存在独立申诉 CIM 流程 |
| PIM-C-1 | PIM | admin 模块按角色聚合了 BC-05 治理与 BC-06 支撑两类语义职能（一对二） | PSM 按"admin 模块内 governance/support 两子域目录"落地 | 已确认临时口径，转契约评审会 |
| PIM-C-2 | PIM | config 被 BC-02/BC-05 横切只读依赖 | PSM 下沉 `infra/config-snapshot` 只读快照分发 | 已确认临时口径，转契约评审会 |
| PIM-C-3 | PIM | notify 无业务不变量、服务全部 BC | PIM 不建聚合；PSM 下沉 `infra/notify-sender` | 已确认临时口径，转契约评审会 |
| PIM-C-4 | PIM | 商家入驻用户侧提交入口在十一模块中未明确归属 | PSM 暂定归 auth 模块（#7-9） | 已确认临时口径，转契约评审会 |
| PIM-C-5 | PIM | report 写、admin 改状态的跨模块状态推进通道 | PSM 经 contract 声明接口 + 进程内事件，禁直查直改 | 已确认临时口径，转契约评审会 |
| PIM-D-1 | PIM | F30"错标已售"申诉对象多为已完成订单，与裁决 8"已完成不可逆"存在张力 | — | **已裁决（2026-02-06 CEO）**：已完成订单的申诉不进入申诉中状态，仅走运营裁决与信用处置留痕，已完成不可逆保持成立 |
| PIM-D-2 | PIM | 评价入口因申诉冻结后 7 天窗口是否顺延，PRD 未规定 | — | **已裁决（2026-02-06 CEO）**：窗口不顺延，自订单完成起连续计时 7 天固定；申诉冻结只冻结公开展示动作，不改窗口计时 |
| PSM-INC-01 | PSM | 订单五态三方口径不一（§5.2 #31 注 vs §4.17 表枚举 vs PRD F34 AC3），且 `rejected` 无表落点 | 以 §4.17 + PRD 为准 | 已确认临时口径，转契约评审会 |
| PSM-INC-02 | PSM | 求购有效期 §5.2 #20/#21 默认 7 天 vs §4.11 与 PRD 30 天 | 以 30 天为准 | 已确认临时口径，转契约评审会 |
| PSM-INC-03 | PSM | 商家入驻：表枚举含 cancelled（撤回）PIM 未建模；缺"审核中"值；驳回理由数字码 vs 字符串码 | — | **已裁决（2026-02-06 CEO，部分）**：入驻申请增加已撤回（cancelled）终态（申请方主动撤回）；审核中不单列枚举，受理留痕由运营操作日志承载；驳回理由编码转契约评审会 |
| PSM-INC-04 | PSM | notification.type 无"商品恢复上架"类，EV-10 无通知落点 | MVP 不触达；如需触达须扩枚举走变更流程 | **已裁决（2026-02-06 CEO）**：维持 MVP 不触达口径，转契约评审会确认 |
| PSM-INC-05 | PSM | 承前未关闭项汇总（D-1/D-2、C-1/C-4 暂定裁决） | 见各对应章节 | 已确认临时口径，转契约评审会 |

> 登记口径：C-3 虽在 PIM 标注"同 C-2 处理"，因其 PSM 落地（notify 下沉 infra）仍属四条暂定裁决之一，计入未闭环；CIM-U-1、PIM-D-1、PIM-D-2、PSM-INC-03、PSM-INC-04 五条已于 2026-02-06 CEO 裁决并回填各层模型文件与本矩阵，其余 8 条维持临时口径待契约评审会确认后回填。
