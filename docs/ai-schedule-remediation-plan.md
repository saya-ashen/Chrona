# Chrona AI 日程软件排查与整改方案

> Provider 选择更新：任务级 `executionRuntime` / Adapter 与 Workspace 默认 runtime 已移除。任务执行只使用 `Task.aiClientId`，未指定时依次解析 `task.execution` feature binding 与已启用默认 AI Client。本文后续出现的 `executionRuntime` 证据仅描述整改前状态，不再是目标架构。

## 0. 当前决策边界

本方案基于当前产品事实，不再按泛 Agent Control Plane 或商业 SaaS 方向评估。

### 保持不变

- 品牌、名称、Logo、开源协议暂不处理。
- 产品定位：**Chrona 是开源 AI 日程软件**。
- 当前主页面：`Dashboard` / `Schedule` / `Tasks` / `Settings`。
- `Inbox`、`Memory` 当前隐藏，不作为主路径页面。
- 项目保持纯开源，暂不考虑商业化、团队 SaaS、计费、品牌迁移。
- Provider 当前按已支持三方处理：`Hermes`、`Claude Code`、`Codex`。
- `json-render` 保留，作为未来方向继续建设。
- Bun-only 可接受；最终用户通过二进制发布使用，不要求源码开发体验服务普通用户。

### 本轮目标

把 Chrona 从“文档叙事混乱、泛控制面表达偏重”的状态，收敛成：

> 稳定、清晰、可执行、可恢复的开源 AI 日程软件。

核心闭环：

```text
Task -> Plan -> Schedule -> Execute -> Review
```

---

## 1. P0：产品叙事与文档对齐

### 问题

当前文档中仍残留较多旧叙事：

- `AI-native task control plane`
- `Agent runtime observer`
- `Memory Console`
- `Inbox workflow`
- 泛 MCP / Provider 平台化表达
- 部分 roadmap 与当前代码/UI 不一致

这些表达会让外部读者误以为 Chrona 是 Agent 平台或通用控制台，而不是 AI 日程软件。

### 为什么严重

开源项目第一印象来自 README 和 docs。文档说“控制平面”，实际 UI 是四页 AI 日程应用，会造成认知断裂。

### 整改方向

将主叙事统一为：

> Chrona 是一个开源 AI 日程软件：把任务变成可计划、可排期、可执行、可审查的工作流。

英文建议：

> Chrona is an open-source AI schedule app that turns tasks into planned, scheduled, and inspectable AI-assisted work.

### 排查文件

- `README.md`
- `README.zh.md`
- `docs/README.md`
- `docs/en/README.md`
- `docs/zh/README.md`
- `docs/en/roadmap.md`
- `docs/zh/roadmap.md`
- `docs/architecture.md`
- `docs/frontend-structure.md`
- `docs/api-reference.md`

### 修改要求

- 明确当前产品主页面只有：
  - `Dashboard`
  - `Schedule`
  - `Tasks`
  - `Settings`
- `Inbox` / `Memory` 只作为隐藏或内部能力描述，不作为当前用户主路径。
- `control plane` 只能出现在技术背景或开发者文档中，不能作为产品主卖点。
- Roadmap 改成围绕 AI 日程闭环：
  - task capture
  - plan generation/review
  - schedule placement
  - provider execution
  - result review/recovery
- 删除或降级过期承诺，避免文档承诺超过当前产品。

### 验收标准

- 新用户看 README 后能明确知道：Chrona 是 AI 日程软件。
- 文档不再引导用户去隐藏页面。
- 中英文文档描述同一个产品，不出现中文/英文定位不一致。

### 核实结果（2026-07-03）

结论：**问题存在，但根 README 已部分修正；docs 子目录仍明显落后。**

证据：根 `README.md` / `README.zh.md` 已把主定位写成 local-first / AI 辅助日程软件（`README.md:10,41-43`，`README.zh.md:10,41-43`），但仍把 `Inbox`、`memory console` 当作可见路径或能力卖点（`README.md:58,142,233,248-250`，`README.zh.md:57-58,136,206-207`）。`docs/README.md:3` 仍写 `AI-native task control plane`，`docs/en/README.md:3` 仍写 `AI task control plane`，`docs/en/roadmap.md:5,123` 仍把 Chrona 描述成 control plane。`docs/README.md:33-35`、`docs/en/README.md:12,45,47`、`docs/en/roadmap.md:29-30,111,132`、`docs/zh/README.md:12,45,47`、`docs/zh/roadmap.md:30-31,112-133` 仍把 Inbox / Memory 当作产品主路径或 roadmap surface。当前路由事实上只有 Dashboard / Schedule / Tasks / Settings / task detail：`apps/web/src/router.tsx:50-76`；`Inbox` / `Memory` 路由被注释明确隐藏：`apps/web/src/router.tsx:60-62`。

修正方案：

1. 根 README 保留“AI 日程软件”定位，但删除或降级 Inbox / memory console 主路径表述：快速开始第 8 步只保留 task workspace / Dashboard；roadmap 中 Inbox 改为“隐藏内部 projection / attention source”。
2. `docs/README.md`、`docs/en/README.md`、`docs/zh/README.md` 首句统一为 AI schedule app，不再用 control plane 做产品定位。
3. `docs/en/roadmap.md`、`docs/zh/roadmap.md` shipped surface 表只列 Dashboard / Schedule / Tasks / Settings；Inbox / Memory 放到 hidden/internal 小节。
4. `docs/architecture.md` 可在技术层保留 control-plane / projection 语义，但 Web app 职责必须写成四页主 surface，Inbox projection 只作为内部 attention 聚合来源。
5. `docs/api-reference.md` 保留 `/api/inbox`、`/api/memory` API，但标注 internal/hidden projection，不作为当前用户页面。

执行状态（2026-07-03）：**已解决文档叙事主问题。** 已更新 `README.md`、`README.zh.md`、`docs/README.md`、`docs/en/README.md`、`docs/zh/README.md`、`docs/en/roadmap.md`、`docs/zh/roadmap.md`、`docs/api-reference.md`、`docs/provider-boundary.md`。`docs/architecture.md` 仍保留 Inbox projection 技术背景，属于允许的内部 projection 语境。


---

## 2. P0：四页面信息架构固定

### 目标

四个页面各司其职，不互相抢职责。

```text
Dashboard -> 今天要关注什么
Schedule  -> 工作什么时候发生
Tasks     -> 任务如何计划、执行、审查
Settings  -> Provider 和运行配置
```

---

### 2.1 Dashboard

#### 当前应承担

- 今日 AI 日程概览
- 即将开始的工作
- 正在执行的任务
- 等待输入 / 等待审批
- 失败 / 阻塞恢复入口
- 最近完成结果

#### 不应承担

- 纯装饰性统计大屏
- 重复 Schedule 的完整日历功能
- 重复 Tasks 的完整任务详情
- 用 AI summary 覆盖确定性状态卡片

#### 排查点

- Dashboard 是否能直接显示今天需要处理的 AI 日程事项。
- blocked / failed / waiting 状态是否有明确入口。
- AI brief 是否只是辅助，而不是主状态来源。
- fallback deterministic digest 是否不被标成 AI-authored。

#### 验收标准

用户只看 Dashboard，就能回答：

- 今天哪些任务要开始？
- 哪些任务正在 AI 执行？
- 哪里需要我操作？
- 哪些失败了？
- 最近产出了什么？

#### 核实结果（2026-07-03）

结论：**问题部分存在。Dashboard 已有确定性状态主结构，但缺“今天即将开始 / 到点任务”显式模块。**

证据：Dashboard projection 明确不是纯 KPI，而是 `focusTask`、`needsAttention`、`autoCompleted`、`inProgress`、`recentEvents`：`packages/engine/src/modules/pages/get-dashboard.ts:4-18,352-361`。blocked / failed / waiting 有确定性入口：`ATTENTION_STATUSES` 覆盖 `Blocked`、`Failed`、`WaitingForApproval`、`WaitingForInput`，并映射 next step：`get-dashboard.ts:21,102-127,288-304`；UI 中 `NeedsYouCard` 给每项恢复入口：`apps/web/src/components/dashboard/dashboard-page.tsx:208-280`。AI brief 被放在 digest 区，确定性卡片仍存在于右侧；AI spec 使用 `UiSurfaceFrame kind="ai-authored"`：`dashboard-page.tsx:383-404`。fallback deterministic digest 没被标成 `ai-authored`：无 `aiBrief.spec` 时走普通 `Card`：`dashboard-page.tsx:406-439`。缺口：Dashboard 没有基于 `scheduledStartAt`/`dueAt` 的“今天要开始 / 即将开始”列表；`getDashboard()` 没输出 upcoming/today schedule bucket：`get-dashboard.ts:275-361`。

修正方案：

1. 在 `getDashboard()` 增加 `upcomingToday` bucket：来源 `taskProjection.scheduledStartAt/scheduledEndAt/dueAt`，过滤今天、未 terminal、未 attention、未 running；按开始时间升序。
2. Dashboard UI 增加 `UpcomingTodayCard`，展示开始时间、任务标题、auto-plan/auto-execute 标识、主入口 `/tasks/:id`。
3. `focusTask` 保持“最重要的一件事”，不要承担完整今日列表职责。
4. 测试补 `dashboard-page.test.tsx`：attention、running、upcoming、completed 同时存在时都可见；无 AI brief 时 digest 不带 `data-ui-surface-kind="ai-authored"`。


执行状态（2026-07-03）：**部分解决。** 已在 `packages/engine/src/modules/pages/get-dashboard.ts` 增加 `upcomingToday` bucket，并在 `apps/web/src/components/dashboard/dashboard-page.tsx` 增加 `UpcomingTodayCard`；AI brief fingerprint 已纳入 upcoming 今日事项。仍未补 Dashboard 组件级 jsdom 测试，当前 Bun 直接运行该测试缺 `document` 环境。

---

### 2.2 Schedule

#### 当前应承担

- 时间块
- 任务排期
- 冲突展示
- AI 建议
- due work
- auto-plan / auto-execute 可见性
- 外部日历 busy context

#### 不应承担

- 普通 calendar clone
- 隐藏 AI 自动执行后果
- 让用户不知道某个时间块会不会触发 AI

#### 排查点

- 每个 WorkBlock 是否能显示：
  - 来源：human / ai / system / calendar
  - 是否会 auto-plan
  - 是否会 auto-execute
  - 使用哪个 Provider / AI client
  - 当前执行状态
  - 失败后恢复入口
- 外部日历事件是否明确 read-only。
- AI schedule suggestion 是否需要用户明确接受。

#### 验收标准

用户在 Schedule 页能回答：

- 这个时间段要做什么？
- 是否由 AI 执行？
- 何时触发？
- 失败后去哪里处理？
- 哪些时间不可用来自外部日历？

#### 核实结果（2026-07-03）

结论：**问题部分存在。Schedule 承载了大量执行上下文，但 WorkBlock 来源和 Provider/AI client 可见性不完整。**

证据：Schedule projection 已输出 `autoPlanGeneration`、`autoExecute`、timing、`executionRuntime`、`aiClientId`、`latestRunStatus`、`autoStartEligible/Reason`：`packages/engine/src/modules/pages/get-schedule-page.ts:46-83,599-627`。Schedule 新建任务能设置 title、description、priority、schedule time、auto-plan、auto-execute、AI provider：`features/schedule/ui/dialogs/task-create-dialog.tsx:53-125,250-263`。外部日历 source-managed block 锁定 title/time，显示 `Synced from <sourceName>`：`features/schedule/ui/panels/selected-block-sheet/selected-block-main-column.tsx:69-76`。AI schedule proposal 必须显式接受：`get-schedule-page.ts:420-425` 只取 `status: "Pending"`。缺口：`mapWorkBlockItem()` 对所有 WorkBlock 写死 `scheduleSource: "system"`：`get-schedule-page.ts:121-136`，不能区分 human / ai / calendar。缺口：`actionableWorkBlocks` 只含 id/taskId/planId/title/status/time/trigger，没有 provider、AI client、failure/recovery link：`get-schedule-page.ts:561-571`。

修正方案：

1. 给 `WorkBlock` projection 增加 `sourceKind`：`calendar` 来自 `importedCalendarEvent`，`ai` 来自 accepted proposal，`human` 来自手动创建/拖拽，`system` 仅保留自动生成内部块。
2. `ScheduleTaskListItem`/selected block sheet 显示 `executionRuntime` + resolved AI client name，不只存 `aiClientId`。
3. selected block header 增加执行状态条：`latestRunStatus`、`autoStartEligible`、`autoStartReason`、恢复入口 `/tasks/:taskId?workBlockId=...`。
4. 时间线 block badge 显示 `auto-plan` / `auto-execute` / `manual`，点击后在 sheet 解释何时触发。
5. 测试补：calendar block read-only/source badge、manual block source、AI proposal accepted 后 source、failed/waiting block recovery link。


执行状态（2026-07-03）：**部分解决。** `mapWorkBlockItem()` 不再把所有 WorkBlock 写死为 `system`，现在 calendar block 标为 `calendar`，scheduled-trigger block 标为 `ai`，manual trigger 标为 `human`。selected block sheet 已显示来源、read-only calendar 标记、automation policy、resolved AI client name、runtime、执行状态、next action、failed/waiting recovery link；新增 `features/schedule/ui/panels/selected-block-sheet/selected-block-main-column.test.tsx` 覆盖 provider/runtime/status/automation/recovery 和外部日历 read-only/source。剩余：时间线 block badge、accepted proposal 精确 source lineage、从 block 直接关闭/调整 automation 的交互仍未完成。

---

### 2.3 Tasks

#### 当前应承担

- 任务详情
- plan generation
- plan review / edit / accept
- execution cockpit
- result panel
- 单任务 timeline
- 单任务 blocked/failed/retry/recover

#### 不应承担

- 全局 Inbox
- 全局 Memory Console
- raw runtime event 垃圾流
- 要求用户理解所有后端模型

#### 排查点

- Task Workspace 是否围绕当前任务主路径组织。
- plan、schedule、execution、result 是否在同一任务上下文中清晰。
- runtime events 是否分组/摘要，而不是原始线性堆叠。
- primary action 是否永远明显。

#### 验收标准

用户进入一个 task 后能回答：

- 当前任务计划是什么？
- 是否已接受计划？
- 当前执行到哪一步？
- 是否卡住？为什么？
- 我现在能做什么？
- 最终结果在哪里？

#### 核实结果（2026-07-03）

结论：**问题小部分存在。Task Workspace 主路径基本成立，但 runtime activity 仍需继续摘要化，最终结果 fallback 证据不足。**

证据：`TaskWorkspacePage` 同页组织 plan、current execution、runtime events、activity、accept/start/checkpoint actions：`features/task-workspace/ui/task-workspace-page.tsx:168-187`。执行 console view 构造 header、progress、attention、latest result、artifacts、activity、state treatment：`features/task-workspace/model/task-workspace-query.ts:404-474`。primary action 不直接由 AI spec 控制，而来自 task execution summary 并注入 graph primary node action：`apps/web/src/components/tasks/plan/task-action-node-action.ts:127-169`。计划必须 accept 后才可执行：`deriveHeaderActions()` 无 plan 或未 accepted 时禁用 start，并给 disabled reason：`features/task-workspace/model/task-workspace-state.ts:102-137`。缺口：`runtimeEvents` 和 `liveActivity` 仍是 workspace state 的核心输入；需要确认 UI 是否已把原始事件完全分组，不能只靠当前模型名判断。缺口：Task result panel fallback 不如 Dashboard 明确；`SpecRenderer` render fallback 只处理不兼容 spec，validate 依赖上游：`apps/web/src/components/tasks/workspace/catalog/spec-renderer.tsx:13-36`。

修正方案：

1. 保留当前 Task Workspace 信息架构，不做大重排。
2. 为 activity 建 `groupRuntimeEvents(events)` 纯 helper：按 node/tool/run phase 聚合，UI 默认显示摘要，原始事件只放 debug/expand 区。
3. Result panel 输入统一成 `{ summary, markdown?, spec? }`；spec invalid 时显示 markdown/text fallback，不影响 command center action rail。
4. 测试补：waiting_for_input、waiting_for_approval、failed、cancelled 下 header primary action/disabled reason；坏 result spec 下 start/retry/cancel/approve 仍可见。


执行状态（2026-07-03）：**无法解决（本轮范围内）。** 当前 Task Workspace 主路径已有 header/progress/attention/latest result/artifacts/activity/state treatment；但 runtime activity 分组 helper、统一 `AiResultSurface` result fallback、坏 spec 下 action rail 保持可用等需要跨模型、UI 和测试重构。本轮未安全完成，只保留为后续必做项。

---

### 2.4 Settings

#### 当前应承担

- Hermes / Claude Code / Codex 配置
- Provider health
- feature bindings
- runtime defaults
- 本地诊断
- local bind / API key 状态

#### 不应承担

- 专家级 Provider 配置表单堆叠
- 要求用户手动猜 feature 应该绑定哪个 client
- 把诊断结果藏在技术字段中

#### 排查点

- 三个 Provider 是否都有清晰 setup path。
- feature binding 是否有合理默认值。
- health check 是否区分：reachable、configured、capability-ready。
- 错误信息是否能指导用户修复。

#### 验收标准

用户能在 Settings 中完成：

- 选择 Provider
- 检查 Provider 可用性
- 绑定生成计划 / 执行任务等 feature
- 明确知道缺什么配置

#### 核实结果（2026-07-03）

结论：**问题存在。三方 Provider 都能配置，但 Settings 仍偏专家表单；Codex 文案还错误提到 codex-acp。**

证据：AI Clients form 支持 `hermes`、`claude_code`、`codex` 类型：`features/ai-clients/ui/ai-clients-manager.tsx:18,200-215,750-862`。Hermes 有 diagnose / auto-configure / restart 路径：`ai-clients-manager.tsx:553-708`。Claude Code / Codex 只有环境字段表单和通用 test availability，没有等价 setup checklist：`ai-clients-manager.tsx:750-862,938-959`。Feature bindings 是手动 checkbox，依赖 provider features：`ai-clients-manager.tsx:888-922`；没有明显默认绑定推荐 UI。Health UI 只有 `available/unavailable/testing/idle`：`ai-clients-manager.tsx:75-80,938-959`，未区分 reachable / configured / capability-ready。Codex UI 曾写底层 ACP/codex-acp 运输细节；用户可见文案应描述产品级 provider setup，而不是暴露 provider transport。

修正方案：

1. Settings 中 Provider setup 拆成三种 checklist：Hermes（base URL/API key/plugin/MCP/gateway）、Claude Code（CLI/SDK auth/model/cwd/MCP preflight）、Codex（ACP reachable/session creation/stream parsing/tool support）。
2. `test availability` 返回结构升级为 `{ reachable, configured, capabilityReady, reason, missing[] }`，UI 分三段显示。
3. 新建 client 时按 provider capabilities 自动预选推荐 feature bindings，保留手动覆盖。
4. 删除 Codex 用户可见文案中的 `codex-acp` 实现细节；开发者文档明确 ACP 是 provider-boundary 方向，Codex 是当前第一个 ACP-backed provider。
5. 测试补 AI Clients UI：三个 provider 都显示 setup checklist、错误原因、默认 bindings、health 三态。

执行状态（2026-07-03）：**部分解决。** 已删除 Settings Codex UI 中 `codex-acp` 用户可见文案，并更新 `docs/provider-boundary.md` 说明 ACP 是 provider-boundary 迁移方向、Codex 是当前第一个 ACP-backed provider。AI Clients 表单和 client card 已增加三态 readiness checklist：Configured、Reachable、Capability-ready；Capability-ready 使用 `providerCapabilityMatrix`，Codex 明确显示缺 `getRunSnapshot`、`approvalEvent`。新建 client 时已按 provider features 自动推荐默认 bindings：优先 `task.plan`、`task.execution`、`dashboard.brief`，用户手动改动后不覆盖；Hermes 默认三项，Codex/Claude Code 默认 task plan/execution。Manage AI Clients 空状态已改为通用 `Connect AI Client`，新建 client 默认 Claude Code，provider 下拉中 Hermes 排最后。新增/更新 `features/ai-clients/tests/ai-clients-manager.test.tsx` 覆盖 readiness 三态、Codex 能力缺口、Hermes/Codex 默认 binding、Claude Code 默认 provider、Hermes 排序/选择路径。剩余：`test availability` API 仍只返回 `available/reason`，未升级为 `{ reachable, configured, capabilityReady, missing[] }`；Claude Code/Codex 还没有 Hermes 等价 setup diagnostics。

---

## 3. P0：AI 日程核心闭环打通

### 核心闭环

```text
创建任务
-> 生成计划
-> 审查 / 编辑 / 接受计划
-> 排期
-> 到点或手动执行
-> Provider 执行
-> 用户审查结果
-> blocked / failed 可恢复
```

### 问题

如果其中任一步不清晰，Chrona 就会从 AI 日程软件退化成“复杂任务后台”。

### 排查清单

#### Task

- 新任务是否能设置：
  - title
  - description
  - priority
  - dueAt
  - estimate
  - execution runtime / provider
  - auto-plan / auto-execute 选项
- 新任务创建后是否有明确下一步：生成计划 / 排期。

#### Plan

- plan generation 是否有流式进度。
- 生成失败是否能重试。
- plan 是否必须 review/accept 后才能执行。
- plan edit 是否足够简单，不要求用户理解底层 graph。

#### Schedule

- task 是否容易排到时间块。
- schedule proposal 是否可接受/拒绝。
- WorkBlock 是否能承载执行上下文。
- due work 是否能进入执行队列。

#### Execute

- 手动执行路径是否稳定。
- 自动执行是否只在用户明确配置时触发。
- 执行中是否显示当前 Provider、当前 node、当前状态。
- cancel/retry/resume 是否可见。

#### Review

- 结果是否可审查。
- json-render 输出是否 validate。
- validate 失败是否有 fallback。
- 用户是否可以 accept / reopen / retry。

### 验收标准

至少有一个 demo flow 能稳定跑通：

```text
Create task -> Generate plan -> Accept plan -> Schedule -> Execute -> Review result
```

并分别覆盖：

- success
- waiting_for_input
- waiting_for_approval
- failed
- cancelled

### 核实结果（2026-07-03）

结论：**核心闭环部分存在，不能声明已稳定跑通；Task 创建缺 dueAt/estimate，Review accept/reopen 也不完整。**

证据：Task 创建 dialog 支持 title、description、priority、scheduled start/end、recurrence、auto-plan、auto-execute、AI client；但 `dueAt` 固定提交 `null`，没有 estimate 字段：`features/schedule/ui/dialogs/task-create-dialog.tsx:110-125,250-263`。Plan generation 有 SSE/session 状态：`packages/engine/src/modules/plans/task-planning.ts:23-57,116-129`。Accept plan 会保存 accepted plan 并 rebuild projection：`task-planning.ts:84-114`。Start 前必须有 plan 且 accepted，否则 `deriveHeaderActions()` 禁用 start：`features/task-workspace/model/task-workspace-state.ts:108-124`。Schedule proposal 有 pending/accept/reject 模型，Schedule page 读取 pending AI proposals：`get-schedule-page.ts:420-425,507-519`。自动执行 eligibility 明确检查 accepted plan、timing、active run：`get-schedule-page.ts:609-627`。计划验收里的 demo flow 未见单个 e2e 覆盖 success/waiting/approval/failed/cancelled 全状态；现有测试多为组件/单模块。

修正方案：

1. Task 创建补 `dueAt` 和 `estimateMinutes`，或把本计划中这两个字段降级为“编辑页支持”并修改验收。
2. Demo flow 先用 debug provider 建稳定 e2e：创建 scheduled task -> generate plan -> accept -> start -> result visible。
3. 再用 provider replay/fixture 覆盖五种终态：success、waiting_for_input、waiting_for_approval、failed、cancelled；不要求真实 Provider 在线。
4. Review 语义补齐：Result panel 明确 `accept result`、`reopen task`、`retry failed node/run` 三个入口；如果当前产品只支持查看输出，则把“accept / reopen”从验收中删掉或列为缺口。
5. Schedule 和 Task Workspace 对同一个 `workBlockId` 使用同一 plan/run scope，测试覆盖 schedule block 进入 task workspace 后上下文不丢失。


执行状态（2026-07-03）：**无法解决（本轮范围内）。** 稳定 demo flow 和五种终态 e2e 需要 debug provider/replay fixture、执行流、浏览器测试链路配合；属于跨执行引擎与 e2e 的较大验收项。本轮只推进状态模型、Dashboard upcoming、Schedule source 和 calendar 默认手动策略，核心闭环 e2e 仍未声明完成。

---

## 4. P0：统一用户态状态模型

### 问题

后端存在多层状态：

- Task status
- Schedule status
- Plan status
- Execution status
- Provider run status
- Node status
- Approval/Input/Blocked state

这些内部状态可以保留，但用户不应该在不同页面看到不同解释。

### 方案

新增或强化统一用户态模型：

```ts
type WorkItemUserState =
  | "unscheduled"
  | "scheduled"
  | "ready_to_plan"
  | "ready_to_execute"
  | "running"
  | "waiting_for_input"
  | "waiting_for_approval"
  | "blocked"
  | "failed"
  | "completed"
  | "cancelled";
```

建议结构：

```ts
type WorkItemStateView = {
  state: WorkItemUserState;
  label: string;
  description: string;
  severity: "neutral" | "info" | "warning" | "danger" | "success";
  primaryAction: WorkItemAction | null;
  secondaryActions: WorkItemAction[];
  disabledReason?: string;
  source: {
    taskStatus: string;
    scheduleStatus?: string | null;
    planStatus?: string | null;
    executionStatus?: string | null;
    providerStatus?: string | null;
    nodeStatus?: string | null;
  };
};
```

### 修改要求

- Dashboard / Schedule / Tasks 复用同一个 derived state helper。
- 不允许每个页面各自写状态判断。
- `WaitingForInput` 和 `WaitingForApproval` 必须区分。
- `Cancelled`、`Completed`、`Done` 不得随意混同。
- blocked / failed 状态必须突出 next action。

### 排查文件方向

- `packages/domain/src/**/derive-*`
- `features/*/model/**`
- `apps/web/src/components/dashboard/**`
- `features/schedule/ui/**`
- `apps/web/src/components/tasks/workspace/**`
- `packages/engine/src/modules/projections/**`
- `packages/engine/src/modules/pages/**`

### 测试要求

- 表驱动测试覆盖所有 user state。
- 同一输入在 Dashboard / Schedule / Tasks 输出一致。
- blocked / failed / waiting 状态断言 primary action。

### 验收标准

同一个任务在 Dashboard、Schedule、Tasks 中：

- 状态文案一致
- 色调一致
- 主按钮一致
- disabled reason 一致

### 核实结果（2026-07-03）

结论：**问题存在。已有多个局部 helper，但没有统一 `WorkItemStateView`；不同页面确实各自判断状态。**

证据：Domain 只有 `deriveScheduleState()`，输出 `scheduleStatus`/summary：`packages/domain/src/task/derive-schedule-state.ts:1-116`。Dashboard 自己定义 attention/running/focus 状态集合和 next step：`packages/engine/src/modules/pages/get-dashboard.ts:21-27,102-127,133-147`。Schedule projection 自己映射 `scheduleStatus`、`latestRunStatus`、`autoStartEligible`：`get-schedule-page.ts:46-83,599-627`。Task list 自己按 `status` 决定 badge/gradient：`apps/web/src/components/tasks/task-list-page.tsx:108-144`。Task Workspace 自己有 `deriveTaskStatusFromGraph()`、`mapTaskWorkspaceStatus()`、`deriveHeaderActions()`：`features/task-workspace/model/task-workspace-state.ts:21-61,87-137`。`WaitingForInput` / `WaitingForApproval` 在部分地方有区分，但 `mapTaskWorkspaceStatus()` 把 `Cancelled` 映射成 `completed`：`task-workspace-state.ts:54-60`，与本计划“Cancelled、Completed、Done 不得混同”冲突。

修正方案：

1. 在 `packages/domain/src/task/derive-work-item-state-view.ts` 新增纯 helper，输入 task/schedule/plan/run/node/capability，输出 `WorkItemStateView`。
2. 状态优先级固定：failed > blocked > waiting_for_approval > waiting_for_input > running > ready_to_execute > ready_to_plan > scheduled > unscheduled > cancelled > completed；terminal 内 `cancelled` 独立。
3. Dashboard projection、Schedule projection、Task Workspace header/task list 全部消费同一 helper 输出；页面只负责布局，不再自写状态判断。
4. `mapTaskWorkspaceStatus()` 保留为 node-level display helper，但不得作为 task/user state 来源；Cancelled 显示改为独立状态或显式产品决策测试。
5. 表驱动测试覆盖所有 `WorkItemUserState`，并加 cross-surface fixture：同一输入在 Dashboard/Schedule/Task Workspace 得到同一 label/tone/primaryAction/disabledReason。

执行状态（2026-07-03）：**部分解决。** 已新增 `deriveWorkItemStateView()` 并从 `@chrona/domain` 导出；Dashboard projection、Schedule projection、Task list、Task Workspace status mapper 已开始消费统一 state view。已补 `packages/domain/src/task/derive-work-item-state-view.bun.test.ts` 和 `features/task-workspace/model/task-workspace-state.bun.test.ts`，覆盖 cross-surface label/severity/primaryAction/disabledReason 一致性；`Cancelled` 仍通过 workspace legacy `TaskWorkspaceUserStatus` 显示为 completed 兼容态，后续如要独立视觉状态需扩展 workspace status union 和 UI copy。

---

## 5. P0：Provider 三方一致性

### 当前 Provider

- Hermes
- Claude Code
- Codex

### 问题

已支持多个 Provider 不等于产品体验一致。真正风险在状态语义：

- run completed
- run failed
- run cancelled
- waiting for approval
- tool call started/completed
- structured output
- stream disconnect
- getRun snapshot
- cancel behavior

### 方案：Provider Capability Matrix

建立并维护能力矩阵：

| Capability | Hermes | Claude Code | Codex | UI 行为 |
|---|---:|---:|---:|---|
| health check | TBD | TBD | TBD | Settings 显示可用性 |
| start run | TBD | TBD | TBD | 允许执行 |
| stream events | TBD | TBD | TBD | 显示实时进度 |
| get run snapshot | TBD | TBD | TBD | 恢复 stale running |
| cancel run | TBD | TBD | TBD | 显示 cancel |
| approval event | TBD | TBD | TBD | 显示审批 |
| tool traces | TBD | TBD | TBD | 显示工具活动 |
| structured output | TBD | TBD | TBD | json-render / fallback |
| session resume | TBD | TBD | TBD | 显示 resume |

### 修改要求

- UI 不按 Provider 名称硬编码行为。
- UI 按 capability 展示动作。
- Provider adapter 不拥有 Chrona 任务语义。
- Provider event 先归一化，再进入执行状态 reducer。

### Contract tests

每个 Provider 至少覆盖：

- health check success/failure
- start run success
- stream completed
- stream failed
- stream cancelled
- tool call event
- approval required event
- getRun active/terminal snapshot
- cancel behavior
- malformed provider event handling

### 验收标准

同一个 demo task 分别使用 Hermes / Claude Code / Codex 时：

- 状态流一致
- UI 主动作一致
- 失败恢复一致
- 结果展示一致

### 核实结果（2026-07-03）

结论：**问题存在。Provider 接口有能力字段和归一化事件，但三方一致性、能力矩阵、contract tests 不完整；Codex 当前是唯一 ACP-backed provider，未来可把其他 provider 迁到 ACP。**

证据：Hermes test 覆盖 capabilities、health、startRun 等：`packages/providers/hermes/src/HermesProviderClient.bun.test.ts:27-193`。Claude Code test 覆盖 replay completed、static capabilities/health、startRun/getRun、tool_call/tool_result：`packages/providers/claude-code/src/ClaudeCodeProviderClient.bun.test.ts:82-123,140-209`。ACP test 覆盖 capabilities、completed、resume、tool events、cancel：`packages/providers/acp/src/AcpProviderClient.bun.test.ts:91-245,275-315`。Codex provider 委托 `AcpProviderClient`：`packages/providers/codex/src/CodexProviderClient.ts:1-48`；这符合当前 Codex ACP 方向。缺口在于 ACP capabilities 写 `supportsRunLookup: false`，但 `getRun()` 只查内存 map：`packages/providers/acp/src/AcpProviderClient.ts:424-435,500-515`；重启后无法恢复 stale running。Provider contract tests 不是统一 matrix；Codex 自身测试只薄覆盖 start/stream completed，缺 failed/cancelled/approval/malformed/getRun terminal 等完整项。

修正方案：

1. 建 `packages/providers/foundation/src/provider-capability-matrix.ts` 或文档化 JSON fixture，列 Hermes / Claude Code / Codex 每项 capability 和 UI 行为。
2. 抽 `createProviderContractSuite(factory, expectations)`，每个 provider 必跑：health ok/fail、start、stream completed/failed/cancelled、tool_call/tool_result、approval、getRun active/terminal、cancel、malformed event。
3. Codex 继续作为 ACP-backed provider；后续迁移其他 provider 到 ACP 时复用相同 contract suite 和 capability matrix，不把 ACP 细节泄漏到产品 UI。
4. UI action 判断只看 `ProviderCapabilities`，不看 provider name；Settings readiness 直接展示 matrix 中缺口。
5. Engine reducer 只接收 `ProviderRunEvent` 归一化事件；provider adapter 不写 Chrona task/plan 语义。

执行状态（2026-07-03）：**部分解决。** 已清理 Codex ACP 用户文案并修正 provider-boundary 文档方向：ACP 是迁移目标，Codex 是当前 ACP-backed provider。已新增 `packages/providers/foundation/src/provider-capability-matrix.ts`，列出 Hermes / Claude Code / Codex 的 capability 与 UI 行为，并导出 `summarizeProviderCapabilities()`。统一 contract suite 仍未完成；Codex getRun 跨进程恢复仍是缺口。

---

## 6. P1：json-render 保留并治理边界

### 当前决策

`json-render` 保留，作为未来方向继续建设。

### 风险

json-render 适合 AI 结果展示，但不能控制产品权威动作。

### Surface 分类

所有相关 UI 区域应归类：

```ts
type UiSurfaceKind =
  | "product-authored"
  | "ai-authored"
  | "ai-editable"
  | "runtime-control";
```

### 边界规则

#### AI 可以生成

- 结果摘要
- 分析报告
- plan explanation
- schedule insight
- artifact preview
- dashboard AI brief

#### AI 不可控制

- 任务状态
- 执行状态
- 审批按钮
- retry/cancel/approve
- Provider 配置
- 权限动作
- destructive action
- backend ID / secret / raw provider payload

### Fallback 要求

AI 输出建议结构：

```ts
type AiResultSurface = {
  summary: string;
  markdown?: string;
  spec?: ChronaJsonRenderSpec;
};
```

规则：

- `spec` 必须 validate。
- validate 失败时 fallback 到 markdown / text。
- fallback 不能显示为 AI-authored structured surface。
- json-render 坏了不能影响任务执行动作。

### 排查点

- 所有 `validateChronaSpec()` 使用点。
- Dashboard AI brief 是否和确定性状态分离。
- Task result panel 是否有 fallback。
- plan output patch 是否限制根节点覆盖风险。
- AI-authored surface 是否暴露 secret / raw tool payload。

### 验收标准

破坏 AI spec 后：

- 页面不崩
- 任务状态仍可见
- retry/cancel/approve 仍可用
- fallback 文案可读

### 核实结果（2026-07-03）

结论：**边界方向正确，部分已实现；Task result fallback 和 runtime-control 隔离仍需补证据/测试。**

证据：`UiSurfaceKind` 已存在，且 `UiSurfaceFrame` 写 `data-ui-surface-kind`：`apps/web/src/components/ai-surface/ui-surface-frame.tsx:5-54`。Dashboard AI brief 使用 `kind="ai-authored"`；无 spec fallback 是普通 Card，不是 AI-authored structured surface：`apps/web/src/components/dashboard/dashboard-page.tsx:383-439`。`validateChronaSpec()` 存在并检查 component type、props、action binding、child cycle、core validation：`packages/ui-protocol/src/document/validate.ts:175-224`。`SpecRenderer` 对缺 spec / catalog incompatible 返回 fallback，但注释说明 invalid specs 应由上游拒绝：`apps/web/src/components/tasks/workspace/catalog/spec-renderer.tsx:9-36`。plan output patch 根覆盖风险已在 `packages/engine/src/modules/plan-execution/use-cases/submit-terminal-node-result.ts` 治理。缺口：`DashboardPage` 对 `SpecRenderer` 传 `fallback={null}`，坏 spec 若绕过上游只会空白，不是 readable markdown/text fallback：`dashboard-page.tsx:399-400`。

修正方案：

1. 定义统一 `AiResultSurface = { summary, markdown?, spec? }`，Dashboard brief 和 Task result 都使用。
2. 所有写入 AI spec 的入口先 `validateChronaSpec()`；失败时存 issue + markdown/text fallback，不把 invalid spec 传给 renderer。
3. `SpecRenderer` caller 必须提供可读 fallback，Dashboard 不再传 `null`。
4. runtime-control action rail/header/approval/retry/cancel 必须用 `UiSurfaceFrame kind="runtime-control"` 或产品组件，不能来自 AI spec action binding。
5. 测试补坏 spec：Dashboard、Task result 不崩；状态、retry/cancel/approve 仍可见；fallback 文案可读；raw provider payload/API key 不出现在 rendered text。


执行状态（2026-07-03）：**无法解决（本轮范围内）。** Dashboard fallback 已是普通 Card，`SpecRenderer` 上游 validate 边界存在；但统一 `AiResultSurface`、Task result fallback、坏 spec 下 runtime-control action rail 保持可用测试仍需跨 Dashboard/Task Workspace/result 模型重构。本轮未安全完成，标记为后续必做。

---

## 7. P1：Bun-only 保留，优化二进制发布体验

### 当前决策

Bun-only 没问题，因为最终产品通过二进制发布。

### 真正目标

普通用户不应感知 Bun。

### Release 体验要求

用户下载 release 后：

```bash
./chrona start
```

应自动完成：

- 初始化数据目录
- 初始化 SQLite
- 生成或读取本地 access key
- 启动 server
- 服务 web dist
- 打开或提示浏览器地址
- 引导 Provider 设置
- 可运行 demo task

### 排查文件

- `scripts/chrona.ts`
- `scripts/build-binaries.ts`
- `build/manifest.*`
- `build/release-smoke.ts`
- `packages/cli/**`
- `apps/server/src/static/**`
- `apps/server/src/config/env.ts`
- `prisma/schema.prisma`

### Release smoke test

必须覆盖：

- binary 启动成功
- `/health` 返回 ok
- web index 可访问
- `/api/health` 返回 ok
- SQLite 初始化成功
- default workspace 可获取
- Settings 页面可打开
- Provider health endpoint 可调用
- demo task 可创建

### 验收标准

release 包不依赖用户安装 Bun 即可跑通首启。

### 核实结果（2026-07-03）

结论：**问题存在。release smoke 只验文件存在，不验二进制首启/API/Web/SQLite/demo。**

证据：`build/release-smoke.ts` 只检查 binary executable、web index、Prisma schema/migrations、Hermes plugin bundle：`build/release-smoke.ts:47-67`。没有启动 release binary，也没有请求 `/health`、web index、`/api/health`、workspace、Settings、provider health、demo task。CLI program 当前主要是 agent command 和 Hermes integration commands；`createProgram()` 描述“starts the Chrona app server”，但代码中没有 `start` command：`packages/cli/src/program.ts:85-171`。

修正方案：

1. 明确 release binary 入口：如果 `./chrona start` 是目标，则 `packages/cli/src/program.ts` 必须新增 `start` command；否则修改文档为当前真实命令。
2. `start` 执行：解析数据目录 -> 初始化 SQLite/migrations/default workspace -> 生成/读取 access key -> 启动 Hono server -> serve web dist -> 输出 URL/access key 状态。
3. 扩展 `build/release-smoke.ts`：spawn release binary，临时 `CHRONA_DATA_DIR`，轮询 `/health`、`/api/health`、`/`、default workspace API、AI provider health endpoint、create demo task API。
4. smoke 必须证明 release artifact 不依赖用户已安装 Bun；测试中调用 dist binary，不调用 `bun run` 作为被测对象。
5. Provider wizard/demo task 可先用 debug provider，避免真实外部 provider 依赖。


执行状态（2026-07-03）：**无法解决（本轮范围内）。** 当前 release binary 没有明确 `chrona start` server 入口；补 release smoke 需要先确定 CLI/server release contract，否则会修改启动/部署语义，属于需要单独设计和人工确认的发布边界。本轮只保留现状并标记缺口。

---

## 8. P1：First-run Wizard

### 问题

AI 日程软件第一次打开时，如果直接面对 Settings / Provider 表单，流失很高。

### 方案

新增或强化首次引导：

```text
1. 选择 Provider
2. 检查 Provider 可用性
3. 绑定 feature
4. 创建 demo task
5. 生成 plan
6. 执行 demo
7. 展示结果
```

### Provider 引导

#### Hermes

- base URL
- API key
- plugin installed
- MCP URL
- gateway reachable

#### Claude Code

- CLI reachable
- permission mode
- working directory
- MCP bridge/capability

#### Codex

- ACP reachable
- session creation
- stream parsing
- tool support

### 验收标准

新用户 5 分钟内能看到一个任务从 plan 到 execution 到 result。

### 核实结果（2026-07-03）

结论：**问题存在。当前没有 First-run Wizard；只有 Settings/AI Clients 表单和 Hermes 局部 setup。**

证据：全局路由没有 onboarding/wizard 路径：`apps/web/src/router.tsx:50-76`。Settings 提供 AI Clients dialog 和 schedule AI settings，并且 Dashboard / Schedule / Tasks / Settings 已在没有 AI client 时显示轻量 `StartWithChrona` 引导：`apps/web/src/components/start-with-chrona.tsx`、`apps/web/src/pages.tsx`、`features/schedule/ui/schedule-page.tsx`。Hermes 有诊断/自动配置；Claude Code/Codex 没有等价引导：`features/ai-clients/ui/ai-clients-manager.tsx`。

修正方案：

1. 新增 first-run 状态：workspace 是否已有 enabled AI client + feature binding + demo task/run；未完成时 Dashboard 顶部显示 wizard card，避免强制路由劫持。
2. Wizard 步骤：选择 provider -> health/capability check -> 自动推荐 bindings -> 创建 demo task -> generate plan -> accept -> execute via debug/provider fixture -> show result。
3. Provider setup checklist 复用 Settings 组件；完成后落库到 AI client/bindings。
4. Demo task 默认使用 debug provider 或本地可用 provider；真实 Hermes/Claude/Codex 不可用时仍可展示产品闭环但明确标记 demo runtime。
5. 测试补 first-run component + e2e happy path，验 5 分钟目标对应的可见状态，而不是真实耗时。


执行状态（2026-07-03）：**部分解决。** 已把 `Start with Chrona in three steps` 抽成全局组件 `apps/web/src/components/start-with-chrona.tsx`，在没有 AI client 时显示于 Dashboard / Schedule / Tasks / Settings；文案已移除硬编码 Hermes，改为通用 AI client / local-first provider 引导。完整 first-run wizard 仍未完成：还需要 provider readiness、feature binding、demo task/plan/execute/result 串联；与 Provider Settings 和 release demo flow 强耦合，后续必做。

---

## 9. P1：外部日历服务 AI 日程定位

### 当前判断

External Calendar 与 AI 日程软件定位一致，应保留。

### 边界

外部日历优先作为：

- busy context
- conflict source
- schedule suggestion input

谨慎作为：

- 自动任务生成器
- 自动执行触发器
- 状态机驱动源

### 分层策略

#### Layer 1：Busy Overlay

只显示不可用时间。最安全。

#### Layer 2：Conflict Detection

用外部日历发现冲突。

#### Layer 3：Schedule Suggestion

AI 根据空档推荐排期。

#### Layer 4：Automation

只有用户显式开启，才允许 auto-plan / auto-execute。

### 排查点

- calendar source URL 是否只保存在 server-side。
- browser response 是否只返回 redacted label。
- imported event 是否 read-only。
- auto-plan / auto-execute 是否有显式开关。
- 外部日历导致的 schedule action 是否可追踪来源。

### 验收标准

任何外部日历驱动的行为都必须：

- 可见
- 可撤销或可关闭
- 有来源标记
- 不泄露私有 URL

### 核实结果（2026-07-03）

结论：**方向正确，但“只有用户显式开启 automation”与当前默认实现冲突。Calendar 安全/只读/脱敏多数已实现。**

证据：Contract 返回 `redactedUrlLabel`，事件 `readOnly: true`：`packages/contracts/src/external-calendar.ts:24-63`。Service create/list/validate 返回 redacted label，不返回 source URL；API tests 断言响应不含原 URL：`features/external-calendar/service.ts:59-63,111-121,176-197,233-234`，`features/external-calendar/tests/api-sources.bun.test.ts:61-80`。Repository 保存 `sourceUrl` 在 server-side record：`features/external-calendar/repository.ts:19-24`。Imported event 会创建 task/workblock 并按 automation policy 设置 `autoPlanGeneration`/`autoExecute`：`features/external-calendar/repository.ts:414-416`。问题：createSource 默认 `automationPolicy: input.automationPolicy ?? "auto_plan"`：`features/external-calendar/service.ts:189-197`。这不是“用户显式开启”，而是默认自动生成计划。External calendar task source 可追踪：Schedule projection 输出 `sourceManaged`，含 sourceName/sourceColor/immutable fields：`get-schedule-page.ts:72-81,149-158`。

修正方案：

1. 默认 `automationPolicy` 改为 `manual`；UI 中“Create plans only / Auto-execute”必须用户主动选择。
2. 对现有 source 做兼容迁移策略：保留已配置值，但 first-run/设置页明确显示当前 automation policy；不要静默改用户已有 source。
3. Calendar imported event 默认只作为 busy/read-only overlay；只有 `auto_plan` 才创建 plan 请求，只有 `auto_execute` 才接受计划并到点执行。
4. Schedule UI 对 calendar-driven task/block 显示 source、read-only fields、automation policy、关闭/撤销入口。
5. 测试补默认 create source 为 manual、响应不泄露 URL、readOnly event、auto_plan/auto_execute 都有显式输入和来源追踪。

执行状态（2026-07-03）：**部分解决。** `features/external-calendar/service.ts` 默认 `automationPolicy` 已从 `auto_plan` 改为 `manual`，`features/external-calendar/ui/calendar-source-setup.tsx` 新建 source UI 默认也改为 `manual`，并在 `features/external-calendar/tests/api-sources.bun.test.ts` 增加默认值断言。现有 source 的 automation policy 已在 source list/actions 中可见和可改；Schedule block 内直接显示 automation policy / 关闭入口仍未补齐。

---

## 10. P2：隐藏 Inbox / Memory 的整理

### 当前事实

Inbox / Memory 已隐藏。

### 问题

隐藏页面可能仍在文档、API、projection、组件中留下主路径叙事。

### 方案

给产品 surface 定义状态：

```ts
type ProductSurfaceStatus =
  | "active"
  | "hidden"
  | "internal"
  | "deprecated";
```

对 Inbox / Memory：

- 文档标注为 hidden/internal。
- 不在导航出现。
- 不作为 onboarding 步骤。
- Dashboard 吸收必要能力：waiting approval、failed runs、attention items。
- 保留内部数据结构，不急删。

### 验收标准

用户文档不再把 Inbox / Memory 当作当前主页面。

### 核实结果（2026-07-03）

结论：**问题存在于文档和 API 叙事；代码导航/路由已隐藏。**

证据：路由明确隐藏 Inbox/Memory：`apps/web/src/router.tsx:60-62`。`docs/frontend-structure.md:20-23` 已正确说明 `inbox`/`memory` hidden，Dashboard owns attention/recovery。但 `docs/README.md:33-35`、`docs/en/README.md:12,45,47`、`docs/en/roadmap.md:29-30,111,132`、`docs/zh/README.md:12,45,47`、`docs/zh/roadmap.md:30-31,112-133` 仍把 Inbox/Memory 当可见产品 surface。`docs/api-reference.md:206-212` 直接列 `/api/inbox`、`/api/memory`，没标 internal/hidden projection。

修正方案：

1. 不新增 `ProductSurfaceStatus` 代码类型，先用文档 frontmatter/表格解决；当前问题是叙事，不是运行时类型缺失。
2. 文档 surface 表统一四个 active 页面：Dashboard/Schedule/Tasks/Settings。
3. Inbox / Memory 标为 hidden/internal projections：可被 Dashboard/Task Workspace 消费，不是用户导航页，不出 onboarding。
4. API reference 给 `/api/inbox`、`/api/memory` 加 “Internal/hidden projection; not current primary UI route”。
5. 全文搜索 `Inbox` / `Memory Console`，只允许出现在 hidden/internal/API/architecture 背景语境。

执行状态（2026-07-03）：**已解决主问题。** 已更新 README、docs 首页、英中文 roadmap、英中文产品指南和 API reference；Inbox/Memory 仅保留为 hidden/internal projection 语境。


---

## 11. 建议执行顺序

### Phase 1：文档和叙事对齐

目标：外部认知准确。

任务：

- 改 README / README.zh。
- 改 docs 首页。
- 改 roadmap。
- 改 architecture 的产品 surface 描述。
- 改 frontend-structure 的页面描述。
- 标注 hidden surfaces。

验收：

- 全文搜索旧主叙事，不再作为产品主定位出现。
- 文档统一为 AI 日程软件。

---

### Phase 2：四页面职责固化

目标：产品导航清晰。

任务：

- Dashboard 状态卡和 attention/recovery 入口排查。
- Schedule 时间块执行信息排查。
- Tasks plan/execution/result 主路径排查。
- Settings Provider setup 排查。

验收：

- 四页职责无重复、无缺口。
- blocked/failed/waiting 从 Dashboard/Schedule 可进入恢复。

---

### Phase 3：统一用户态模型

目标：状态一致。

任务：

- 定义 `WorkItemStateView`。
- 编写纯 helper。
- Dashboard / Schedule / Tasks 迁移使用。
- 添加表驱动测试。

验收：

- 同一 task 在三页状态一致。
- waiting/approval/blocked/failed/cancelled/completed 覆盖测试。

---

### Phase 4：Provider 一致性

目标：Hermes / Claude Code / Codex 体验一致。

任务：

- 建 Provider capability matrix。
- 增加 provider contract tests。
- Settings 展示 capability readiness。
- execution UI 按 capability 展示动作。

验收：

- 三个 Provider demo flow 结果一致。

---

### Phase 5：json-render 边界和 fallback

目标：保留方向，避免核心动作被 AI spec 污染。

任务：

- 标注 surface kind。
- 检查 validate/fallback。
- 禁止 runtime-control 来自 AI spec。
- 添加坏 spec 测试。

验收：

- json-render spec 失败不影响执行控制。

---

### Phase 6：二进制发布体验

目标：用户不感知 Bun。

任务：

- release smoke 扩展。
- 首启初始化排查。
- Provider wizard 排查。
- demo task flow 排查。

验收：

- release 包可独立跑通首启 demo。

---

## 12. 不做事项

本轮不要做：

- 品牌替换
- 协议/法务整理
- 商业化设计
- SaaS 化
- Postgres 迁移
- 团队权限系统
- 大规模 engine 重写
- 删除 json-render
- 删除外部日历
- 回退到单 Provider
- Node runtime 迁移

---

## 13. 最终验收总表

| 领域 | 验收问题 | 通过标准 |
|---|---|---|
| 定位 | 用户知道 Chrona 是什么吗 | README 明确 AI 日程软件 |
| 页面 | 四页职责清楚吗 | Dashboard/Schedule/Tasks/Settings 各司其职 |
| 主路径 | AI 日程闭环通吗 | Task -> Plan -> Schedule -> Execute -> Review 跑通 |
| 状态 | 三页状态一致吗 | 统一 `WorkItemStateView` |
| Provider | 三方体验一致吗 | Hermes/Claude Code/Codex contract tests |
| json-render | AI spec 坏了会不会影响核心动作 | fallback 可用，runtime-control 不受影响 |
| Release | 用户需要 Bun 吗 | 二进制独立启动 |
| Calendar | 外部日历是否安全服务排期 | read-only、redacted、显式 automation |
| Hidden surfaces | Inbox/Memory 是否误导用户 | 文档标 hidden/internal |

---

## 14. 一句话原则

> 保留 Chrona 的 AI 日程方向、Provider 能力、json-render 未来路线和 Bun 二进制发布优势；修掉过时文档、混乱叙事、页面职责不清、状态不一致、Provider 体验割裂这些真正阻碍产品可用性的问题。
