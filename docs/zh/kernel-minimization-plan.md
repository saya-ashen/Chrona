# 内核最小保留实施方案

状态：2026-11-08 起草，待执行。本文是交给实施 Agent 的工作说明，不表示改动已完成。旧的阶段性审查见 [内核与系统模块职责审查](kernel-responsibility-audit.md)；两者冲突时以本文为准，但每一步落地前都必须对照源码复核。

## 1. 目标与判定标准

目标：让随发行冻结的部分（内核接口、运行能力、必须预装的应用）尽量少，**用户以后尽量少地需要更新这些东西**。

任何一项留在内核，只能有一个理由：**普通模块经路由调用无法安全做到**（真实调用方身份、隔离、事务、凭据、生命周期、停止证据）。以下都**不是**保留理由：

- “某个模块在用它”——调用方可以改为调用拥有该数据的应用。
- “内核在调用它”——内核调用应用是需要拆掉的耦合，不是预装依据。
- “很通用”——见 `AGENTS.md`：复用本身不构成提升层级的理由。

第二条判断：保留项里**会经常变**的部分（模型/Provider、展示文案、业务策略、第三方服务清单、文件名约定）也要拆出去，否则冻结区仍会频繁更新。

## 2. 目标终态

### 2.1 内核接口（`steward/system/*`）

| 接口 | 终态 | 动作 |
|---|---|---|
| `modules` | 保留，收窄 | 删除 `overview`、`system`（页面聚合，由 web 用 `list/permissions/diagnostics` 等自行组合）。其余生命周期、发现、`contributions`、健康报告工具保留 |
| `approvals` | 保留，扩充 | 接收 `settings.grants/revoke-grant`。修正描述里过时的“先分级并经 AI 复核”（架构文档 §11：审批不分级） |
| `secrets` | 保留，改造 | `oauth.ts:9-10` 写死的 Google/Microsoft 端点改为模块 manifest 声明（仅 https，内核校验）；内核只留 PKCE、state、refresh 机制 |
| `schedules` | 保留 | 不动 |
| `projects` | 保留，收窄 | 保留 `list/register`；`default`（自动建默认项目）的策略移给 coding，内核最多保留“按路径登记”本身 |
| `activity` | 保留，收窄 | 保留 `runtime/runs/records`；删除 `list` 及其转发 `notify.activity` 的代码 |
| `settings` | 收窄为预算 | 只留模型档位、额度、预算等治理设置。`notifications`→notify，`builds`→随构建治理留在 modules 或迁出（见 §4 决策点 B），`memory`/`sessions`→入口应用自己的设置，`preferences/forget`→记忆应用，`grants`→approvals，`theme`→web |
| `content` | 删除 | 见阶段 3 |
| `memory` | 删除 | 见阶段 4 |
| `history` | 删除 | 见阶段 5 |
| `system/chat.ts`、`provider.ts`、`executions.ts` | 删除 | 已不在注册表，仅测试引用 |

### 2.2 运行能力（`steward/local-*`，visibility 均为 `kernel`）

| 能力 | 终态 |
|---|---|
| `runtime-callback` | 保留 |
| `workspace-local` | 保留 `prepare/release/cleanup`；`rules`（`local-workspace.ts:24` 写死读 `AGENTS.md`）移给 coding，由 coding 决定读哪些规则文件并作为任务输入传入；`capture/result` 见决策点 C |
| `content-local` | 删除 `mount/put/read`（对话附件遗留）；`reference` 退化为运行准入内部检查；`capture` 并入 `workspace-local` |
| 进程内 `agent`（`local-provider.ts` 的 `registerProviderModule` / `registerInjectedProvider`） | 移入测试 fixture，不进发行代码 |

### 2.3 内置应用

| 应用 | 终态 |
|---|---|
| `agent` | **唯一必须预装**（没有 Provider 就无法构建任何应用）。保持现有不可动态替换规则，只走可信发行更新；接口保持 `start/status/inject/abort/release` 级别的窄面 |
| `web` | 默认预装、可受检定制，但内核不依赖它：删除 `today.ts` 对 `web.today` 的调用和 `chat.today` 兼容入口 |
| `notify` | 默认预装、可受检定制，但内核不依赖它：内核把审批/生命周期事实写入自己的持久事实队列，由声明通知贡献的模块拉取或订阅；没有通知应用时审批仍可经 `approvals.list` 在任何入口处理 |
| `mcp`、`files`、`events` | 迁到 `steward/external/`，成为官方可选外置应用（可删除、可重装） |

### 2.4 内核其他入口

- `apps/server/src/rescue.ts:41` 仍调用内核旧对话 `chat.handleMessage`。终态：rescue 只保留审批列表/决定，加暂停与回滚应用；对话能力删除，深度修复走宿主 `chrona admin`。删除后内核 chat 服务（`steward/chat.ts` 及相关）应能整体移除。

## 3. 必须遵守的约束

- 读 `AGENTS.md`、`docs/zh/architecture.md`、`docs/zh/steward-goals.md`。
- **删除遗留**：每移除或替换一个机制，grep 代码、测试、文档、提示词、manifest、契约字段，同一提交内删干净；不留兼容层。只有已存数据仍需解析时才保留，并加一行注释说明。
- **数据不丢**：删除 `history`、`memory`、`content-local` 的附件存储前，必须先有迁移或导出步骤，并在部署机（chino）实际数据上演练过。
- 不新增特权应用、通用策略钩子、事件注册中心或第二套队列。
- Agent 身份与 Agent 更新规则不变。
- 改变 2026-11-08 已确认的“web/mcp/files/notify/events 为内置”决策（mcp/files/events 外迁）需要同步修改 `AGENTS.md` 与 `docs/zh/architecture.md` §2。
- 提交：在 `platform-v2` 分支上按阶段提交；可以 push，**不要 push 到 main**；不部署，部署由用户决定。
- 重型检查串行执行并加内存上限，例如：
  `systemd-run --user --scope --quiet -p MemoryMax=10G -p MemorySwapMax=1G -p CPUQuota=300% nice -n 15 bun run lint`
  （tsc/typecheck 需加 `-E NODE_OPTIONS=--max-old-space-size=6144`）。先跑定向 `bun test <paths>`，全量 `typecheck / lint / test:bun / test:api` 每阶段末跑一次。
- 测试只用临时数据库，不调用真实模型或 QQ。

## 4. 实施阶段

每阶段独立提交，阶段末全量检查通过后再进入下一阶段。先做纯删除，再做有迁移的。

### 阶段 1：删除死代码（无行为变化）

1. 删除 `system/chat.ts`、`system/provider.ts`、`system/executions.ts` 及只服务它们的测试（`system-chat.bun.test.ts`、`system/executions.bun.test.ts`，以及 `module-model`、`module-tools`、`module-executor`、`execution-v2-tools`、`builtin/web/test.ts`、`builtin/web/lifecycle.bun.test.ts` 中对它们的引用——改为测试现行接口或删除该用例）。
2. 删除空目录 `builtin/{qq,remind,mind,memory-local}`。
3. 进程内 `agent` 注册移入测试 fixture；`apps/server/src/steward-runtime.ts` 的 `registerInjectedProvider` 只在测试注入路径存在。
4. 修正 `approvals` 描述文字。

验收：注册表输出（`modules.system`）不变；全量检查通过。

### 阶段 2：拆掉内核对应用的反向调用

1. `steward/today.ts` 删除对 `web.today` 的调用；删除 `chat.today` 兼容入口；所有调用方改为直接调用 `web.today`。
2. `steward/activity.ts:53` 删除转发 `notify.activity`；删除 `activity.list` 工具；web/mcp 中的 `activity.list` 调用改为 `notify.activity` 或 `activity.records`。
3. `notify-user.ts`、`approvals` 生命周期中对 `notify.approval/lifecycle/send` 的调用：改为内核在状态事务中写入持久事实（已有幂等排队可复用），通知应用经现有路由读取/订阅。**先读源码确认现有排队机制，复用它，不新造队列。**
4. 删除 `modules.overview`、`modules.system`，web 页面改为自行组合。

验收：停用 web 与 notify 后，内核启动、审批创建与 rescue 审批处理仍正常（写一个 API 测试覆盖）。

### 阶段 3：删除 `content`

1. 对话附件归入口应用：web、qq（以及仍上传附件的 mcp）把附件存进自己的内容区（manifest `content: true`），自行读取；删除 `content.read` 调用（`builtin/web/index.ts:204`、`external/qq/conversations.ts:55` 等）。
2. 跨应用读取文件改为调用归属应用自己的工具（例如 `image-generation` 已有读取工具）；文件归属方决定可见性。
3. 运行准入（`agent-context-read.ts:15`、`tools.ts:65`）改为：引用必须属于发起方自己的内容区，否则拒绝。
4. 删除 `system/content.ts`、`content-local` 的 `mount/put/read`；`capture` 并入 `workspace-local`；`contentRefSchema` 中的 `chat/` 前缀删除。
5. 迁移：现有 `chat/` 附件按消息归属复制到对应入口应用的内容区，并改写引用；在 chino 数据副本上演练。

### 阶段 4：删除 `memory`

1. 入口应用（web/qq/mcp）经 `modules.contributions({ section: "memory" })` 发现记忆应用并直接调用其工具；自动召回/保存的时机由入口应用或记忆应用决定。
2. 删除 `steward/memory.ts`（含 `autoRetain`、`memoryInput`）及 `settings.memory`；`memory-local` 的 `contributes.memory` 契约按需简化。
3. `settings.preferences/forget` 移给记忆应用。

### 阶段 5：删除 `history` 与内核 chat

1. 查清 `history.*` 的全部调用方（当前包括 web、mcp、`external/coding/conversation-history.ts`、`external/coding/workbench.ts`）以及它们读的是旧数据还是仍在产生的内核会话（build、wake、rescue 会话）。
2. 仍在产生的内核会话：build 会话的读取改由 `modules`（构建记录）提供有界只读事实；构建状态中文文案（`system/history.ts` 里的 `ended` 表）移到 web。
3. 旧会话数据：提供一次性导出（或迁入入口应用），用户确认后删除 `history` 与 `sessions` 读路径。
4. rescue 去掉对话（§2.4），随后删除 `steward/chat.ts` 等内核对话服务。

### 阶段 6：收窄 `settings`、`projects`、`workspace-local`，改造 OAuth

1. 按 §2.1 把各设置项迁到所属应用（应用设置已有 `modules.settings-set` 机制，优先复用）。
2. `projects.default` 的策略移给 coding。
3. `workspace-local.rules` 移给 coding。
4. OAuth 端点改为 manifest 声明；现有 mail 应用的 Google 配置随之迁移，需验证已保存的 refresh token 继续可用。

### 阶段 7：mcp/files/events 外迁

1. 目录移到 `steward/external/`，按官方外置应用的安装与种子流程处理；保留名称规则相应调整。
2. 已部署实例上这三个应用的数据目录和 active 定制需保持不变（迁移只改类别，不改 moduleId 与数据）。
3. 同步更新 `AGENTS.md`、`docs/zh/architecture.md` §2、`builtin/README.md`。

## 5. 需要先问用户的决策点

实施 Agent 遇到以下问题时停下并报告，不要自行决定：

- **A. 旧数据处置**：旧会话、旧附件是导出归档后删除，还是迁入入口应用长期保留。
- **B. 构建会话编排**：目标模块与构建会话的绑定是防止任意应用提交他人代码的信任边界，应留在内核；但提示词、队列展示等是否还在内核、能否移出，需要先盘点 `module-build-session.ts`、`owner-build.ts` 再提交方案。不要新建一个可以对任意模块 `propose` 的“构建应用”。
- **C. `workspace-local.capture/result`**：确认它是否被用作“停止证据”。是则保留最小不可变快照；否则移给 coding。
- **D. 外迁 mcp 的风险**：mcp 是用户自己的 Agent 访问 Chrona 的入口，外迁后若被删除，需确认用户可接受的恢复路径。

## 6. 完成标准

- §2 表中每一项的终态都已落地，或在本文中标注了被用户否决的决策点。
- `grep` 不再有已删除接口名（`content.read`、`history.`、`memory.recall` 等）的生产引用。
- 停用 web 与 notify 后，内核启动、审批、定时投递和 rescue 审批仍工作（自动化测试）。
- 全量 `typecheck / lint / test:bun / test:api` 通过；页面改动在真实浏览器检查过。
- 迁移在 chino 数据副本上演练通过，并记录到 [运维说明](operations.md)。
- `docs/zh/architecture.md`、`AGENTS.md` 与代码一致；本文状态改为“已完成”并列出各阶段提交。
