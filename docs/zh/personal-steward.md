# 个人管家：产品方向与首轮范围

状态：2026-10-13 起为 Chrona 的**现行产品方向**。用户已明确授权按全新重构处理。
本文与旧文档冲突时以本文为准：[product-architecture](product-architecture.md) 的
「执行者无关的工作与成果」降为成果层的设计依据；
[proactive-personal-assistant-plan](../en/proactive-personal-assistant-plan.md)
中的阶段顺序、兼容性优先、禁止大改条款不再适用，其安全要求继续有效。

## 定位

聊天里随时能找的个人管家 + 网页可掌控的事务中心 + 后台可靠事件服务。
不是聊天客户端，不是 workflow 编辑器，不只是成果仓库。

> 交代一次，记得住；授权范围内的变化，看得见；需要行动，知道边界；
> 回来查看，清楚发生了什么、还欠什么。

产品中心从「任务如何执行」转为「我的事务是否被妥善照看」。

## 授权范围

可以：大改内部架构、页面、领域模型、API、开发库 schema；退役重型托管编排
（AI 生成 DAG、节点分配、Provider 会话控制台）；不为旧内部接口保留兼容壳。

不可以（需另行授权）：删除或迁移真实用户数据、覆盖未知未提交改动、改线上库、
部署/发布/push、改主机网络与服务、接入私人账号、发送真实外部消息、扩大账号权限、
关闭审批或秘密脱敏。认证、最小权限、可靠性不因重构取消。

旧 Plan/Run/成果数据：不伪造、不删除。旧页面可降为次级只读入口。

## 职责分工

- **Chrona**：持久事务、承诺、持续委托、可强制执行的权限、事件与处理记录、
  成果版本、审阅、通知策略与回执。唯一的调度与投递权威。
- **外部 Agent**：可替换的理解与处理者（`Assessor` 端口）。理解消息、查证、
  建议处置；不持有权限，不负责重试投递。
- **来源适配器**（`SourceAdapter`）：只负责读取；轮询与 Webhook 各自声明，
  工具可调用不代表事件可订阅。
- **投递适配器**（`DeliveryAdapter`）：只负责一次发送并如实回报
  accepted / rejected / uncertain。

## 领域模型

共享契约：`packages/contracts/src/steward/index.ts`（主管维护，worker 不得改动；
需要变更时在回执中提出）。

| 概念 | 模型 | 要点 |
| --- | --- | --- |
| 事务 | `Affair` | 持续存在的一件事；聚合消息、进展、成果、待决定、跟进 |
| 连接 | `SourceConnection` | 来源、读/写范围、模式、基线、最近成功/失败、覆盖说明 |
| 事件 | `InboundEvent` | 持久接收；`(connectionId, externalId)` 唯一去重；基线事件不触发处理 |
| 判断 | `EventAssessment` | Assessor 的处置建议 + 确定性权限判定结果 |
| 委托 | `Delegation` | 目的、原话、频率、允许/需确认行动、通知策略、限额、修订号 |
| 待处理 | `AttentionItem` | 决定/变化/承诺/建议/成果/故障；`dedupeKey` 去重，冷却与暂后 |
| 通知 | `StewardNotification` | 发件箱；生成≠发送≠确认；幂等键；重试退避 |
| 跟进 | `FollowUp` | 到期后生成承诺类待处理 |
| 工具 | `ManagedTool` | 脚本/面板；生成≠验证≠授权≠启用；选择理由可追溯 |
| 审计 | `StewardAudit` | 追加式；权限判定、状态迁移、用户决定 |

## 事件闭环

```text
授权来源事件 / 定时检查
  → 持久接收 + 去重（首次同步只建基线）
  → 关联事务（确定性规则；不确定 → suggested，等用户确认）
  → Assessor 理解（不可用 → 事件保持 pending，积压可见，退避重试）
  → 确定性权限校验（Delegation ∩ 试点硬性拒绝清单）
  → retain / digest / notify_now / await_decision / act
  → 待处理事项 + 通知发件箱 + 后续跟进 + 审计
```

硬性规则：

1. 外部文本只是数据，不能授予权限、改变委托或目的地。
2. 权限判定是纯函数：无 active 委托 → `denied`；`askFirstActions` → `ask_first`；
   `reply_external` / `mark_read_external` / `delete_external` 在只读试点中恒为
   `denied`，无论委托如何书写。
3. 暂停/撤销立即阻止新的检查和待发通知；已发生的外部效果只记录不回滚。
4. 投递重试不重新评估事件；评估重试不重复创建待处理事项。
5. 发送成功不等于已读，不自动关闭事项。
6. 不是每条消息都变任务，不是每个任务都自动执行。

## 页面

| 页面 | 路径 | 内容 |
| --- | --- | --- |
| 今日 | `/:lang/today`（首页） | 需要决定 · 值得关注的变化 · 临近承诺 · 建议 · 已完成成果；每项含发生了什么/为何重要/证据/状态/下一步 |
| 事务 | `/:lang/affairs`、`/:lang/affairs/:id` | 目标、背景、相关消息、待确认关联、委托、跟进、工具 |
| 日程 | `/:lang/schedule` | 区分约会/截止、管家检查时间、未确认的安排建议 |
| 委托 | `/:lang/delegations` | 每条委托的范围、频率、最近检查、暂停/撤销 |
| 连接与权限 | `/:lang/connections` | 来源、范围、模式、同步状态、遗漏风险；原始收件箱与投递记录为次级入口 |

旧的任务/目标/工作台页面保留为次级导航，不再是首页。

## 按需选择工具

先用最轻方式，必要时升级（`chooseHandling`，`packages/domain/src/steward/handling.ts`）：
一次性问题直接回答 → 有价值的研究出成果页 → 重复且规则稳定复用或生成脚本 →
长期观察用委托 → 反复比较/填写用面板 → 模糊目标由 Agent 迭代。
选择理由持久保存，可纠正、降级、停止。脚本/面板的权限、验收、生命周期控件由
确定性应用拥有。

## 首轮验收闭环

本地测试来源 `local_test` + 测试投递适配器，**明确标记为测试数据**，不冒充真实
Reddit/QQ。Reddit 收件箱只实现只读适配边界；未获账号授权时为
`needs_authorization`，是 blocker 而非已接入。

必须由真实运行的测试证明：历史基线 · 新消息去重 · 重启恢复 · 模型不可用积压 ·
投递失败重试 · 权限拒绝 · 暂停/撤销 · 来源证据与用户决定 · 工具选择策略及
生成/验证/启用的区分。

## 现状与差距

以下按本 checkout 源码核对；「有测试」指仓库有对应测试，不表示本文维护时重新运行了全部测试。[英文版与逐步实现说明](../en/personal-steward.md)列出实现文件、权限、投递、工具与建议阈值。

### 已实现并有测试

- 持久接收、首次基线、事件去重、重启后读取同一库、评估积压/退避、权限拒绝、连接暂停/撤销、通知重试与幂等、用户决定、工作区隔离：`apps/server/src/__tests__/api/steward-loop.bun.test.ts` 和 `packages/engine/src/modules/steward/*.bun.test.ts`。
- 今日/事务/委托/连接页面与日程投影；证据、错误、加载、未确认状态和明确的下一步：`features/steward` 的模型及 UI 测试。旧 Plan/Run/托管执行代码和数据保留，仍从次级导航可达；没有将旧入口改成只读。
- 确定性内置 `rule-assessor-v1`；权限纯函数；生成→验证→授权→启用的声明式工具；建议检测与克制策略：`packages/domain/src/steward`、`packages/integrations/src/steward`、engine steward 测试。
- `in_app` 本地通知回执、显式确认及失败可见；发送不等于已读，也不关闭待处理事项。单个 steward tick 串联轮询、评估、跟进、建议与投递；旧执行调度器仍保留。

### 已实现但仅测试适配器

- `local_test` 来源是进程内追加日志，不是真实 Reddit/QQ；重启测试需重放来源日志，数据库记录保持持久。
- 可脚本化 accepted/rejected/uncertain 的测试投递及 assessor 不可用开关，通过 `CHRONA_E2E_TEST_ROUTES=1`（或 `true`）的测试 seam 暴露；正常运行不注册测试投递通道。
- Reddit 收件箱的只读映射/游标/错误边界只有注入式模拟测试；运行时未注入凭据或网络传输，没有真实账号验证。

### 未实现或被阻塞

- Reddit 真实读取：阻塞于**明确账号授权**，连接显示 `needs_authorization`；没有接入私人账号、没有 live verification。
- 真实外部通知通道未实现；非测试通道只有 `in_app`。外部 Agent 的 `Assessor` 端口存在，但未接线；当前并非模型在理解消息。日常聊天接入不是本 steward 已实现能力。
- 未迁移真实用户数据；本次 steward 重构没有部署或发布。旧成果层的历史部署记录不代表管家已上线。
- 方向与实现差距：委托暂停/撤销阻止其动作与发送，但不停止仍 active 的连接轮询；轮询本身没有 active 委托或 `read_source` 权限检查；tick 按连接间隔而非委托 cadence/`maxEventsPerCheck` 调度。`digest` 目前生成待处理变化，并无定时聚合摘要投递。
- 共享契约中的 membership 注释并非实际多用户权限：路由是单一本地 owner + workspace 数据范围。通知契约的 policy channel 默认 `in_app`，但省略整个 policy 时 Prisma 默认仍是 `local_test`（建议创建的委托亦如此）；需显式提供 `in_app` policy。
- 内置规则的日期是建议；批准该决定不会自动创建 FollowUp。Today 的成果分组尚未接上旧成果版本；工具是声明式规则/表格，不是任意脚本执行环境。

## 如何运行

从仓库根目录运行，先选择独立开发数据目录/数据库，**不要指向真实用户库**。以下是操作说明，本文维护未启动服务、迁移或部署。

```sh
bun run dev          # scripts/dev.ts：Vite + Bun API
bun run server:start # 只启动 API/server
bun run dev:web      # 只启动 Vite
```

`bun run dev` 的 Vite 子进程使用 `--host 0.0.0.0`；不要把它当作仅回环访问的安全承诺。已有依赖与 Prisma 生成产物不足时先按开发环境要求处理，不要对真实数据库执行 reset。

| 环境变量 | 本实现用途 |
| --- | --- |
| `DATABASE_URL` / `CHRONA_DATA_DIR` | 选择独立开发 SQLite 与数据目录；不填真实账号凭据 |
| `API_KEY` | 本地 owner Bearer 密钥；未配置时 steward 仅接受无 Authorization header 的请求，拒绝 scoped bearer |
| `CHRONA_STEWARD_TICK_SECONDS` | 默认 60 秒；非正数或非有限数禁用自动 tick |
| `CHRONA_E2E_TEST_ROUTES` | 仅隔离测试设置 `1`/`true`；启用 `/api/test/steward/*` 和 `local_test` 投递，正常开发/生产勿开 |
| `NODE_ENV=test` / `BUN_ENV=test` | 不自动启动 steward 定时器；测试显式 tick |
| `CHRONA_WEB_PORT` / `CHRONA_SERVER_WATCH=false` | 开发脚本的 Vite 端口 / 禁用 server watch |

`package.json` 的 `test:bun` runner 为每个文件创建 `.tmp` 下的独立测试库；不要裸跑需要数据库的 API 测试指向开发库：

```sh
bun run test:bun apps/server/src/__tests__/api/steward-loop.bun.test.ts
bun run test:bun packages/domain/src/steward/*.bun.test.ts packages/engine/src/modules/steward/*.bun.test.ts packages/integrations/src/steward/*.bun.test.ts
bunx vitest run features/steward
```

更广检查：`bun run test:api` 包含 steward API suite；`bun run test:bun` 收集所有 `*.bun.test.ts`；`bun run test` 为总入口。测试注入来源与投递，不需要真实账号。精确脚本见 `package.json`、`scripts/run-bun-tests.ts`、`scripts/run-api-tests.ts`。

## 实施分线

| 线 | 范围 | 目录 |
| --- | --- | --- |
| A 核心 | schema/迁移、事件管线、权限、委托、发件箱、HTTP 路由 | `prisma/`、`packages/db`、`packages/domain/src/steward/`（除 `handling*`）、`packages/engine/src/modules/steward/`、`apps/server` |
| B 界面 | 今日/事务/委托/连接页面、导航、文案 | `features/steward/`、`apps/web`、`packages/i18n` |
| C 适配 | 来源/投递适配器、确定性 Assessor、工具选择策略 | `packages/integrations/src/steward/`、`packages/domain/src/steward/handling*` |
