# 个人管家：产品方向与首轮范围

状态：2026-10-13 起为 Chrona 的**现行产品方向**。用户已明确授权按全新重构处理。
本文与旧文档冲突时以本文为准：[product-architecture](product-architecture.md) 的
「执行者无关的工作与成果」降为成果层的设计依据；
[proactive-personal-assistant-plan](../en/proactive-personal-assistant-plan.md)
中的阶段顺序、兼容性优先、禁止大改条款不再适用，其安全要求继续有效。
产品目标以 [steward-goals](steward-goals.md)（2026-10-15 定稿）为最高依据，本文记录实现与现状。

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
- `in_app` 本地通知回执、显式确认及失败可见；发送不等于已读，也不关闭待处理事项。单个 steward tick 串联轮询、评估、跟进、建议、摘要与投递；旧执行调度器仍保留。
- 自动轮询要求覆盖连接（或工作区范围）的 active、未过期委托，且 `read_source` 为 allowed；暂停/撤销最后一条此类委托后，下次 tick 清空 nextCheckAt，通过 coverage 显示空闲原因，不记为失败。手动 Sync now 不要求委托。连接到期时间与委托 cadence 共同约束轮询；覆盖委托记录最近检查/成功/脱敏失败，工作区评估批次采用覆盖委托最小 `maxEventsPerCheck`。
- 直接提议、建议批准及管理工具创建委托时，省略 policy 也显式保存契约默认 `digest` / `in_app`，不依赖 Prisma 的测试通道默认值。
- `digest.ts` 每个获准通知的委托每本地日最多创建一条摘要，汇总上次摘要后创建的开放变化（最多列出 10 个标题）；时区取 quietHours 或 UTC，无变化则静默，正常投递仍检查权限与策略。
- 批准带 dueAt 的 decision 时，幂等创建一条关联 FollowUp；note 使用 nextStep 或 title。拒绝不创建，消息中的日期本身不是承诺。以上新增闭环由 `digest.bun.test.ts` 覆盖。

### 已实现但仅测试适配器

- `local_test` 来源是进程内追加日志，不是真实来源；重启测试需重放来源日志，数据库记录保持持久。
- 可脚本化 accepted/rejected/uncertain 的测试投递及 assessor 不可用开关，通过 `CHRONA_E2E_TEST_ROUTES=1`（或 `true`）的测试 seam 暴露；正常运行不注册测试投递通道。
- Reddit 收件箱的只读映射/游标/错误边界只有注入式模拟测试；运行时未注入凭据或网络传输，没有真实账号验证。

### 已接入真实来源与真实 Agent（2026-10-14）

- `chino_service_health`：只读轮询 Chino 仪表盘 `GET http://127.0.0.1:8082/api/dashboard`（由宿主经 `CHRONA_STEWARD_CHINO_DASHBOARD_URL` 配置，仅限回环、无凭据）。只读取服务 id/名称/分类/状态/HTTP 状态/检查时间与网络状态，不读 `facts`/`insight` 等详情。按状态类别（正常 ↔ 异常）变迁产生事件；首次同步时正常状态只建基线，**当前仍在的异常**以 `SourceItem.current` 标记作为现状处理而非历史。两次轮询之间的短暂故障会漏掉，覆盖说明如实写明。
- `pi-assessor-v1`：`CHRONA_STEWARD_ASSESSOR=pi` 时，每个待评估事件调用一次主机既有 `pi -p`（禁用工具、会话、扩展、技能、上下文文件），只传有界上下文，并声明其为不可信数据。输出经服务端 schema 严格校验；未知动作即无效，affair 猜测不在候选中则置空。Pi 只有评估权：权限仍由确定性判定决定，`reply_external` 等试点动作恒拒。进程失败/超时 → 事件保持 pending、健康页显示不可用；输出无效 → 计一次失败，五次后进入故障待处理。
- 唯一调度权威仍是 Chrona 的 steward tick；Pi 不重试、不调度、不执行动作。tick 只把数据库阶段放进服务的串行队列，模型调用期间释放队列，因此慢模型不会阻塞今日页等请求。
- 默认（未设置环境变量）仍是确定性的 `rule-assessor-v1`，界面标注为「规则评估（非 AI）」。
- **通用事务 Agent**（2026-10-14 晚）：`/chrona <任何需求>` 或网页「交给管家」成为一件工作（`StewardWork`），`CHRONA_STEWARD_AGENT=pi` 时由真实 Pi 通过 Chrona 受限工具多步处理（检索、进展、澄清、发布成果、提议跟进/持续委托、建议、脚本/面板草稿、请求授权）。Chrona 持有状态、租约、预算与权限。见 [steward-agent-work](steward-agent-work.md)。
- 已部署到 Chino 生产（`https://chrona.saya.love`），备份、恢复演练、迁移演练与上线验收见部署回执 `/var/lib/chrona-pi/deployment/20261014-steward/receipt.json`。

### 未实现或被阻塞

- Reddit 真实读取：阻塞于**明确账号授权**，连接显示 `needs_authorization`；没有接入私人账号、没有 live verification。
- 聊天闭环（QQ 私聊交代委托、回复码确认/暂停、`hermes_qqbot` 投递）已实现并部署，见 [steward-chat-loop](steward-chat-loop.md)；仅限服务端白名单中的一个私聊，真实聊天轮次的端到端仍需用户在 QQ 中亲自完成。其他外部通道未实现。
- 旧托管 workflow（Plan/Run/编排）尚未在代码中退役，仍在「旧版工作台」二级导航下运行；只完成了旧运行包与旧启动入口的停用归档。
- 共享契约中的 membership 注释并非实际多用户权限：路由是单一本地 owner + workspace 数据范围。
- 工具是声明式规则/表格，不是任意脚本执行环境。Today 的「已完成成果」只读列出已有成果版本，发布不等于验收。

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
| `CHRONA_STEWARD_ASSESSOR` | `pi` 使用主机 Pi 模型；其他值或未设置使用规则评估器 |
| `CHRONA_STEWARD_PI_COMMAND` / `CHRONA_STEWARD_PI_MODEL` | 可选：Pi 可执行文件与模型；默认 `pi` 与 Pi 已配置的默认模型 |
| `CHRONA_STEWARD_AGENT` / `CHRONA_STEWARD_PI_WEB_EXTENSION` / `CHRONA_STEWARD_PI_AGENT_EXTENSION` / `CHRONA_STEWARD_AGENT_POLL_SECONDS` | `pi` 启用事务 Agent 运行循环（每服务同时 1 个 Pi 进程）；可选宿主 pi-web-access 扩展路径（未设置则无检索工具）；Chrona 工具扩展路径（默认随包资源）；轮询间隔（默认 15 秒） |
| `CHRONA_STEWARD_CHINO_DASHBOARD_URL` | 仅 Chino 宿主配置；回环 HTTP，未配置时该来源为 unsupported |
| `CHRONA_STEWARD_CHAT_RECIPIENTS` / `CHRONA_PUBLIC_URL` / `CHRONA_STEWARD_HERMES_COMMAND` | 聊天闭环：允许的 `qqbot:<openid>`、通知中的详情链接源、`hermes` 路径；见 [steward-chat-loop](steward-chat-loop.md) |
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
