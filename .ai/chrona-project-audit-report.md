# Chrona 项目问题分析报告

## 1. 总体判断

Chrona 当前主要风险不是“缺功能”，而是任务工作区状态派生和 UI 呈现分层不够干净。同一业务状态会在 `task-workspace-query.ts`、`task-workspace-actions.ts`、`task-workspace-plan-section.tsx`、`task-workspace-execution-overview.tsx`、`task-plan-view-model.ts`、`task-plan-graph/node-card.tsx` 中重复解释，后续 AI 自动修改时容易引入文案、颜色、按钮可用性不一致。

Task workspace 主链路基本可用：创建任务、生成 plan、接受 plan、执行、观察 activity、查看 result。但 blocked / waiting approval / failed / completed / no plan / plan not accepted 等状态的表达仍依赖多个局部判断，信息层级不够稳定。

`packages/ui-protocol` 已经具备 json-render catalog 与 `validateChronaSpec()` 严格校验路径，能覆盖 unknown component、wrong prop type、dangling child 等问题。但前端仍存在 server-driven spec 与本地 fallback spec 双路径，输出、activity、header、current operation 的契约容易漂移。

测试基础不错：task workspace model、plan graph、compact view、activity feed、ui-protocol validation 都有测试。缺口集中在状态组合 matrix、错误态/空态 UI、json-render 更复杂结构校验、action eligibility 与 copy/tone 一致性。

最适合交给 AI 自动优化的任务：纯函数抽取、状态映射集中化、table-driven tests、空态/错误态 UI polish、json-render validation 测试补齐、轻量组件拆分。最不适合无人值守的任务：执行引擎语义、DB schema、auth/permission、provider/tool contract、大规模页面重设计。

## 2. 高优先级问题

### P1: Task workspace 状态派生逻辑分散

- 位置：
  - `apps/web/src/components/tasks/workspace/model/task-workspace-query.ts`
  - `apps/web/src/components/tasks/workspace/model/task-workspace-actions.ts`
  - `apps/web/src/components/tasks/workspace/sections/task-workspace-plan-section.tsx`
  - `apps/web/src/components/tasks/plan/task-plan-view-model.ts`
  - `apps/web/src/components/tasks/plan/task-plan-graph/node-card.tsx`
- 现象：`task.status`、`currentExecution.status`、`savedPlan.status`、node status 在多个文件中独立映射。
- 影响：同一状态可能显示不同文案、tone、按钮状态。AI 后续小改容易漏一个入口。
- 证据：
  - `task-workspace-query.ts` 有 `deriveTaskStatusFromGraph()`、`mapTaskWorkspaceStatus()`、`overviewToneForNode()`、`buildTaskHeaderView()`。
  - `task-workspace-actions.ts` 有 `buildWorkspaceStateTreatment()` 再次判断 `blocked`、`failed`、`waiting_for_approval`、`waiting_for_user`、`active`。
  - `task-workspace-plan-section.tsx` 自己判断 `isGeneratingPlan`、`isPlanAccepted`、`isPlanAwaitingAcceptance`、`hasGraphExecutionStarted`、`hasTaskCompleted`。
  - `task-plan-view-model.ts` 有 `statusLabel()`、`statusGroup()`、`isTerminalStatus()`。
  - `node-card.tsx` 有 `STATUS_CHIP_THEME_BY_STATUS`。
- 建议：抽一个 task workspace 纯状态模块，集中输出：`workspaceStatus`、`tone`、`primaryCopy`、`allowedActions`、`stateTreatment`。
- 风险：中。
- 是否适合 AI 自动修复：部分适合。先抽纯函数和测试，不动执行行为。
- 推荐拆分任务：
  1. 抽 `deriveWorkspacePresentationState()` 并迁移 `mapTaskWorkspaceStatus()` / `overviewToneForNode()`。
  2. 给 task/node/execution/plan 状态组合补 table-driven tests。
  3. 让 header、overview、state banner 共用同一个派生结果。

### P1: Waiting approval 与 waiting input 被混成同一用户状态

- 位置：`apps/web/src/components/tasks/workspace/model/task-workspace-query.ts:208-214`、`packages/contracts/src/plan-runtime/execution-state.ts:48-55`。
- 现象：`mapTaskWorkspaceStatus()` 把 `waiting_for_user`、`waiting_for_approval`、`WaitingForInput`、`WaitingForApproval` 都映射成 `approval-needed`。
- 影响：用户无法一眼区分“需要输入”和“需要批准”。底部 drawer / command center 的主操作可能看起来像同一种任务。
- 证据：contracts 已区分 `WaitingForInput` 与 `WaitingForApproval`，但 web user status 只有 `approval-needed`。
- 建议：保留 UI 总类别也可以，但 derived state 应输出更细字段：`waitKind: input | approval | blocked | failed | none`。
- 风险：中。
- 是否适合 AI 自动修复：是，先只改展示派生和测试。
- 推荐拆分任务：
  1. 为 waiting input / waiting approval 增加独立 label/tone/description 测试。
  2. 当前 operation card 显示不同 icon/copy。
  3. activity / header badge 使用细分 wait kind。

### P1: Header actions 可用性规则集中但覆盖不足

- 位置：`apps/web/src/components/tasks/workspace/model/task-workspace-query.ts:443-497`。
- 现象：`start`、`pause`、`stop` 是否 disabled 依赖 `hasPlan`、`savedPlan.status`、`isRunnable`、`workspaceStatus`，但覆盖状态组合有限。
- 影响：用户可能看到可以点但实际不可执行的按钮，或状态已可执行但按钮仍 disabled。
- 证据：`cannotStartReason` 直接在 `buildTaskHeaderView()` 中长链三元判断；`task.status` 与 `executionSummary.executionState` 同时参与。
- 建议：抽 `deriveHeaderActions()`，用 matrix 覆盖 no plan / draft plan / accepted plan / running / blocked / completed / not runnable。
- 风险：中。
- 是否适合 AI 自动修复：是。
- 推荐拆分任务：
  1. 抽 header action helper。
  2. 增加 table-driven test。
  3. 统一 disabledReason 文案来源。

### P1: Current operation / command center server spec 与 fallback spec 双路径

- 位置：
  - `apps/web/src/components/tasks/workspace/sections/task-workspace-plan-section.tsx:181-273`
  - `apps/web/src/components/tasks/workspace/execution/task-workspace-execution-overview.tsx:147-170`
  - `apps/web/src/components/tasks/workspace/execution/build-execution-overview-spec.ts`
  - `packages/ui-protocol/src/builders/build-command-center-spec.ts`
- 现象：UI 可以使用 API 返回 `currentOperationSpec` / `commandCenter.documents.*`，也可以本地 build fallback spec。
- 影响：后端 spec 和前端 fallback 行为可能不同，AI 改一边漏一边。
- 证据：`apiCurrentOperationSpec ?? currentOperationAction.spec`、`commandCenter?.documents.trail ?? buildCommandCenterTrailTabSpec(...)`、`commandCenter?.documents.output ?? null`。
- 建议：为 fallback spec 写契约测试，确保和 server-driven spec 同级字段兼容。长期收敛到 shared builder。
- 风险：中。
- 是否适合 AI 自动修复：部分适合。
- 推荐拆分任务：
  1. 增加 fallback spec validation tests。
  2. 对 output/trail/now fallback 统一调用 `validateChronaSpec()`。
  3. 给 current operation spec 缺失时增加明确 fallback reason。

### P1: json-render validation 有基础，但复杂结构缺口仍多

- 位置：`packages/ui-protocol/src/document/validate.ts:124-169`、`packages/ui-protocol/src/document/validate.bun.test.ts`、`packages/ui-protocol/src/catalog/components.ts:117-341`。
- 现象：已覆盖 unknown component、wrong type、dangling child、dynamic expressions，但 cycles、orphan、Table rows、nested children、action binding payload 的测试仍不够。
- 影响：AI 生成 spec 出错时，开发者和模型收到的反馈可能不够具体。
- 证据：`validateChronaSpec()` 先 partial props 校验，再跑 `coreValidateSpec()`；测试目前集中在基础错误。
- 建议：补 negative tests：cycle、missing root after normalize、invalid table row shape、invalid ActivityStream binding、invalid action params。
- 风险：低。
- 是否适合 AI 自动修复：是。
- 推荐拆分任务：
  1. 补 validation negative test matrix。
  2. 改进 issue path/message 可读性。
  3. 给 catalog prompt 增加最小合法 examples。

### P1: Bottom drawer / inspector 已偏 right rail，selected node 详情概念不清

- 位置：`apps/web/src/components/tasks/workspace/execution/task-workspace-inspector.tsx`、`apps/web/src/components/tasks/workspace/model/task-workspace-query.ts:529-545`。
- 现象：`TaskWorkspaceInspector` 注释说“Node clicks no longer open a node-detail overlay”，但 model 仍有 `nodeDetail.selectedNode/currentNode/tabs/disabledActionReason/isEmpty`。
- 影响：产品心智有偏差：用户期望 selected node detail/output/error，实际侧栏更像 task command center。
- 证据：`nodeDetail` 输出多个字段，但 inspector 只传给 action rail / execution overview，并不完整呈现 selected node tabs。
- 建议：明确设计：要么恢复 bottom drawer selected-node detail，要么删除/收敛 nodeDetail 残留字段。
- 风险：中。
- 是否适合 AI 自动修复：部分适合。先做文案/空态和测试，不做大重设。
- 推荐拆分任务：
  1. 审计 `nodeDetail` 字段实际消费点。
  2. 增加 selected node empty/loading/error 状态测试。
  3. 给 inspector 标题和 aria 文案对齐实际行为。

### P1: Plan accepted / no plan / generating / completed 模式切换藏在组件 effect 中

- 位置：`apps/web/src/components/tasks/workspace/sections/task-workspace-plan-section.tsx:143-157`。
- 现象：graph mode 自动切换由组件内 `useEffect` 控制：generating → full，started/completed → compact。
- 影响：业务规则不易测试，也容易和用户手动切换冲突。
- 证据：`setGraphMode("full")` 和 `setGraphMode("compact")` 直接写在 React effect 中。
- 建议：抽 `derivePreferredGraphMode()`，明确自动切换何时覆盖用户选择。
- 风险：低。
- 是否适合 AI 自动修复：是。
- 推荐拆分任务：
  1. 抽 pure helper。
  2. 覆盖 generating / running / completed / idle / manual override 测试。

### P2: Activity stream 实时事件合并规则复杂，回归测试仍可增强

- 位置：`apps/web/src/components/tasks/workspace/model/task-workspace-activity.ts`、`workspace-activity-feed.test.tsx`、`task-workspace-activity.test.ts`。
- 现象：runtime events、workspace SSE events、persisted activity 会合并、排序、去重、截断。
- 影响：live execution status 可能重复、丢失或顺序错乱。
- 证据：已有测试覆盖 tool events、assistant delta、approval/failed status、generic provider drop，但多 run / same sequence / node boundary 仍可加强。
- 建议：补 table-driven identity + ordering + merge tests。
- 风险：低。
- 是否适合 AI 自动修复：是。
- 推荐拆分任务：
  1. 补 provider run boundary tests。
  2. 补 same timestamp + sequence tie-break tests。
  3. 补 live + persisted 去重 tests。

### P2: UI protocol catalog 兼容 alias 可能掩盖 AI spec 质量问题

- 位置：`packages/ui-protocol/src/catalog/components.ts:136-149`、`packages/ui-protocol/src/document/validate.ts:25-30`。
- 现象：catalog 支持 lowercase aliases：`heading`、`paragraph`、`table`、`section`，`normalizeChronaSpec()` 也会修正类型。
- 影响：短期提高容错，长期可能让 prompt/schema 错误不暴露。
- 证据：test 名称已说明“normalizes lowercase report components repairs missing root”。
- 建议：保留兼容，但输出 validation warning 或统计 aliases 使用次数，方便优化 prompt。
- 风险：低。
- 是否适合 AI 自动修复：部分适合。
- 推荐拆分任务：
  1. 给 normalize 增加 alias 使用测试。
  2. 在 dev/test 暴露 alias normalization issues。
  3. 更新 catalog prompt 禁止 lowercase aliases 作为首选。

### P2: 测试命令齐全，但 AI 自动 PR 缺少最小推荐 gate

- 位置：`package.json:24-50`。
- 现象：脚本有 `typecheck`、`lint`、`test`、`test:bun`、`test:api`、`test:e2e:*`、`check:ui-foundation`、`check:boundaries`，但任务粒度没有规定每类改动应跑哪些。
- 影响：AI 自动修改容易只跑局部测试，漏 UI foundation 或 boundary gate。
- 证据：AGENTS 已写 required checks，但可分任务应更明确：状态纯函数改动跑 unit；UI primitive 改动跑 check:ui-foundation；task/schedule/navigation 跑 e2e。
- 建议：补项目规则中的“变更类型 → 必跑命令”。
- 风险：低。
- 是否适合 AI 自动修复：是。
- 推荐拆分任务：
  1. 更新 AGENTS 测试矩阵。
  2. 给 `.ai/tasks.md` 每个任务写 Validation。

## 3. 中低优先级优化点

### UX polish

1. `TaskWorkspaceInspector` 顶部只显示 `completed/total steps`，对 blocked/approval/failed 缺少更强首屏状态提示。
2. `TaskWorkspaceExecutionOverview` activity below 用 `<details>`，默认折叠可能隐藏关键 live execution status。
3. 当前 `statusLabel` 优先级来自 primary action / attention / readiness，缺少解释 source 的 UI。
4. `no plan`、`draft plan`、`accepted but not started` 可做更明确空态卡片。
5. blocked state 应优先显示 actionRequired / retry instruction，而不是普通 readiness copy。
6. completed state 应明确“完成后可查看输出/关闭任务/重新运行”的下一步。
7. `recoveryActions` 全部用 destructive variant，可能让“retry/edit instruction”看起来过危险。

### 状态逻辑

1. `WaitingForInput` 与 `WaitingForApproval` 应在 UI 派生层分开。
2. `Cancelled` 当前被 `mapTaskWorkspaceStatus()` 映射成 completed，可能误导。
3. `degraded` 被当作 blocked/critical，需确认产品语义。
4. `Completed` 与 `Done` 数据模型有差异，UI 需要保留此区别或明确折叠策略。
5. `hasStartedGraphExecution()` 通过节点状态推断，和 `currentExecution.status` 可能冲突。
6. `allNodesDone` 包含 `cancelled/invalidated`，可能让失败/取消 plan 显示完成。
7. `isPermissionLimited` 通过 `!isRunnable && !blockReason` 推断，语义过宽。

### 测试

1. `deriveTaskStatusFromGraph()` 缺少全状态矩阵。
2. `buildWorkspaceStateTreatment()` 缺少优先级测试：stale vs permission vs blocked vs failed。
3. `buildTaskHeaderView()` 缺少 action disabled matrix。
4. `resolveCommandCenterPrimaryAction()` 应有独立测试。
5. `buildExecutionOverviewSpec` 缺少 spec validation tests。
6. `validateChronaSpec()` 缺少 cycle/orphan/table/action payload negative cases。
7. `TaskWorkspaceInspector` 缺少空态、blocked、approval、completed 的组件测试。
8. e2e 应至少有 task workspace smoke：open task → see header → plan panel → command center。

### 类型系统

1. `TaskWorkspaceUserStatus` 粒度不足。
2. `TaskHeaderTaskStatus` 和 `TaskWorkspaceUserStatus` 形似但不共享来源。
3. `UiDocument = Spec` 是 loose alias，callsite 容易绕过 typed catalog。
4. `Record<string, unknown>` handler params 多，需要边界 helper。
5. `build-action-spec.ts` 有 `as any` 用于 action binding，建议用 typed adapter 包住。
6. `PlanNodeStatus` 包含 `done` 与 `completed`，需要明确前端语义。

### 组件结构

1. `TaskWorkspacePlanSection` 组合过重：状态派生、graph mode、command handlers、recovery banner、layout 全在一个组件。
2. `TaskWorkspaceExecutionOverview` 同时做 state store、trail merge、results、activity layout。
3. `TaskWorkspaceInspector` 名称与实际 command center 行为不完全一致。
4. `task-plan-graph/node-card.tsx` 视觉 theme 与状态映射可外提。
5. fallback spec builders 与 protocol builders 可进一步共享。

### 性能

1. `createStateStore()` 每次 `commandCenter.documents.trail` 引用变化都会重建，需确认 React Query 是否稳定。
2. `mergeWorkspaceActivity([...liveActivity, ...liveRuntimeActivity, ...savedTrailActivity])` 每次 runtimeEvents 变化重算，当前量小但可测试边界。
3. `TaskWorkspacePlanSection` 每次 messages copy 变化会重算 consoleView。
4. graph compact view model 对大 DAG 可 memo，但当前看已有局部 memo。

### 文档 / agent 指令

1. AGENTS 应明确“状态派生只能在 model 纯函数里改”。
2. AGENTS 应给 task workspace 改动必跑命令矩阵。
3. json-render spec 修改应强制跑 `packages/ui-protocol` 相关 bun tests。
4. UI foundation rule 已有，但应补“不要新建自定义状态 badge mapping”。
5. 自动 AI 任务应禁止 DB/schema/execution engine/auth 改动。

### 安全

1. `apps/server/src/index.bun.ts` 已警告 public bind without API_KEY，保持。
2. `apps/server/src/routes/ai/clients.routes.ts` 有 secret config key 过滤，需防新增 key 漏过滤。
3. CLI `--show-api-key` 可打印 key，属显式操作；文档中应标明不要在 issue/PR 粘贴输出。
4. `providers/claude-code` aimock test 有 console dump requests/tool calls/events，需确保不在默认真实 key 环境输出。
5. json-render `JsonView` / `Markdown` 展示 AI 输出时，要防 token/run context 被直接作为 result 暴露。
6. agent control 使用 `CHRONA_RUN_TOKEN`，前端不得接触。

## 4. 最适合出差期间自动交给 AI 的任务队列

以下内容可复制到 `.ai/tasks.md`。

### CHR-AI-001: 统一 workspace 状态派生

Goal:
- 把 `task.status`、`currentExecution.status`、`savedPlan.status`、node status 的派生集中到一个纯 helper 模块。
- 输出统一的 header/status/tone/action eligibility 结果。

Scope:
- 可以改：`apps/web/src/components/tasks/workspace/model/*`
- 可以改：相关 test files
- 不可以改：`packages/engine`、`packages/graph-runtime`、server routes、DB schema

Validation:
- `bun run typecheck`
- `bun run test`
- 新增 table-driven 状态矩阵测试

Risk:
- medium

Expected output:
- 一个纯状态模块。
- `task-workspace-query.ts` 少量重构。
- 覆盖 waiting/input/approval/blocked/failed/completed/no-plan 状态。

### CHR-AI-002: 拆分 waiting input 与 waiting approval UI 派生

Goal:
- UI 派生层区分 `WaitingForInput` 与 `WaitingForApproval`。
- 不改后端状态机。

Scope:
- 可以改：`task-workspace-query.ts`、`task-workspace-actions.ts`、相关 i18n messages、tests
- 不可以改：contracts 状态枚举、engine execution behavior

Validation:
- `bun run typecheck`
- `bun run test`
- 新增两个状态的 header/overview tests

Risk:
- medium

Expected output:
- 独立 copy/tone/status detail。
- 现有 approval-needed 总类别如需保留，应加细分字段。

### CHR-AI-003: 抽 deriveHeaderActions 并补 action matrix

Goal:
- 从 `buildTaskHeaderView()` 抽出 start/pause/stop disabled 规则。
- 用 table-driven tests 锁定 no plan / draft plan / accepted / running / blocked / completed。

Scope:
- 可以改：`apps/web/src/components/tasks/workspace/model/task-workspace-query.ts`
- 可以改：`task-workspace-query.test.ts`
- 不可以改：server execution actions

Validation:
- `bun run test -- apps/web/src/components/tasks/workspace/model/task-workspace-query.test.ts`
- `bun run typecheck`

Risk:
- low

Expected output:
- `deriveHeaderActions()` pure function。
- 至少 8 个状态组合测试。

### CHR-AI-004: 补 json-render validation negative tests

Goal:
- 增加 spec validation 对复杂错误结构的覆盖。

Scope:
- 可以改：`packages/ui-protocol/src/document/validate.bun.test.ts`
- 可少量改：`packages/ui-protocol/src/document/validate.ts` 错误信息
- 不可以改：catalog 大规模重构

Validation:
- `bun run test:bun`
- `bun run typecheck`

Risk:
- low

Expected output:
- 覆盖 missing child、cycle、unknown component、invalid table rows、invalid ActivityStream binding、bad action params。

### CHR-AI-005: 统一 command center fallback spec validation

Goal:
- 让前端本地 fallback spec 都走 `validateChronaSpec()` 或测试中验证合法。
- 防止 fallback spec 和 server-driven spec 漂移。

Scope:
- 可以改：`apps/web/src/components/tasks/workspace/execution/build-execution-overview-spec.ts`
- 可以改：相关 tests
- 可以改：`packages/ui-protocol` builder tests
- 不可以改：server command-center API shape

Validation:
- `bun run test`
- `bun run test:bun`
- `bun run typecheck`

Risk:
- medium

Expected output:
- output/trail/now fallback spec 均有 validation tests。
- 无运行时大改。

### CHR-AI-006: 抽 derivePreferredGraphMode

Goal:
- 把 graph mode auto-switch 规则从 React effect 抽成纯函数。

Scope:
- 可以改：`task-workspace-plan-section.tsx`
- 可以改：新增或现有 plan section test
- 不可以改：graph layout 算法

Validation:
- `bun run test -- apps/web/src/components/tasks/workspace/sections/task-workspace-plan-section.test.tsx`
- `bun run typecheck`

Risk:
- low

Expected output:
- `derivePreferredGraphMode()` 或同等 helper。
- generating/full、running/compact、completed/compact 测试。

### CHR-AI-007: 增强 activity merge/order tests

Goal:
- 锁定 activity stream 实时事件合并、排序、去重规则。

Scope:
- 可以改：`task-workspace-activity.test.ts`
- 可以改：`workspace-activity-feed.test.tsx`
- 不可以改：SSE hook / server event format

Validation:
- `bun run test -- apps/web/src/components/tasks/workspace/model/task-workspace-activity.test.ts`
- `bun run test -- apps/web/src/components/tasks/workspace/execution/workspace-activity-feed.test.tsx`

Risk:
- low

Expected output:
- provider run boundary、same timestamp、sequence tie-break、live/persisted dedupe 测试。

### CHR-AI-008: 审计并收敛 nodeDetail 字段

Goal:
- 找出 `nodeDetail` 实际消费点，删除未使用字段或补 UI/test。

Scope:
- 可以改：`apps/web/src/components/tasks/workspace/model/task-workspace-query.ts`
- 可以改：`TaskWorkspaceInspector` / execution overview 轻量消费点
- 不可以改：大规模 drawer 设计

Validation:
- `bun run typecheck`
- `bun run test`

Risk:
- medium

Expected output:
- 未使用字段清理，或明确测试覆盖 selected/current node empty state。

### CHR-AI-009: 改善 blocked/failed/recovery action 视觉层级

Goal:
- 让 blocked/failed 的主行动与危险行动区分更清楚。

Scope:
- 可以改：`task-workspace-plan-section.tsx`
- 可以改：shadcn Button variant 使用
- 不可以改：执行动作语义

Validation:
- `bun run check:ui-foundation`
- `bun run typecheck`
- 相关 component test

Risk:
- low

Expected output:
- retry/edit instruction 不再全部 destructive。
- cancel/fail 仍保留 danger 语义。

### CHR-AI-010: 增加 task workspace smoke e2e

Goal:
- 最小化覆盖 task workspace 首屏：header、plan panel、command center、activity 区域。

Scope:
- 可以改：e2e tests
- 不可以改：app logic

Validation:
- `bun run test:e2e:desktop`
- 如慢，PR 中说明只跑目标 spec

Risk:
- medium

Expected output:
- 一个稳定 smoke test。
- 不依赖外部 LLM/provider。

### CHR-AI-011: 更新 AGENTS 自动修改边界规则

Goal:
- 增加 task workspace 状态逻辑、json-render、测试命令矩阵规则。

Scope:
- 可以改：`AGENTS.md`
- 可以改：`.ai/tasks.md` 如存在
- 不可以改：代码

Validation:
- 人工 review markdown

Risk:
- low

Expected output:
- 规则包含项目目标、禁止事项、必跑命令、状态逻辑约束、测试要求、AI 边界。

### CHR-AI-012: 清理 provider aimock 调试输出

Goal:
- 确认 `providers/claude-code` 测试中的 console dump 不会污染默认测试或泄露真实请求。

Scope:
- 可以改：`packages/providers/claude-code/src/*.test.ts`
- 不可以改：provider runtime behavior

Validation:
- `bun run test:bun`
- `bun run typecheck`

Risk:
- low

Expected output:
- 调试输出只在失败或显式 env 下打印。

## 5. 不建议 AI 无人值守处理的任务

- 大规模页面重新设计：任务工作区涉及 plan graph、command center、activity、results、状态 banner，产品判断重。
- 数据库 schema 改动：`prisma/schema.prisma`、projection、migration、历史数据兼容需要人工确认。
- auth/permission 改动：API key、run token、MCP bearer、agent control 边界高风险。
- execution engine 行为变更：`packages/engine`、`packages/graph-runtime`、runtime cursor、checkpoint/approval semantics 不能无人值守。
- provider protocol / tool contract 改动：影响外部 agent、MCP、LLM prompt、Langfuse 捕获请求和 replay。
- deploy/secrets/network 配置：`HOST`、`API_KEY`、allowed origins、remote Hermes/CPA base URL 都可能造成安全暴露。
- json-render catalog 大规模改名：会同时影响 AI prompt、server builders、web renderer、历史 spec。

## 6. 建议新增的 AGENTS.md / CLAUDE.md 项目规则

```md
## Chrona task workspace / AI auto-edit rules

Chrona is task execution + monitoring workspace. Core UX goal: user must always understand task state, plan state, current execution state, current node state, and required next action.

### 禁止事项

- Do not change database schema, migrations, auth, run token, MCP bearer, provider protocol, or execution engine behavior unless task explicitly asks.
- Do not add new task/node/execution status mappings inside JSX.
- Do not create custom generic UI primitives when shadcn/ui primitive exists.
- Do not hand-roll SSE parsing in `apps/web`; use `apps/web/src/lib/fetch-json-event-source.ts`.
- Do not expose secrets, API keys, run tokens, provider request bodies, or raw tool payloads in UI/logs/tests.

### UI 状态逻辑约束

- `task.status`, `currentExecution.status`, `savedPlan.status`, and execution node status must be derived through pure helpers under `apps/web/src/components/tasks/workspace/model/`.
- Header badge, command center status, graph node tone, activity tone, and action disabled reason must share the same derived state source where possible.
- `WaitingForInput` and `WaitingForApproval` must remain distinguishable in UI copy or derived metadata.
- `Cancelled`, `Completed`, and `Done` must not be silently treated as identical unless test names explain product decision.
- Blocked/failed states must show cause and next action before secondary metadata.

### json-render rules

- All Chrona json-render specs must be valid against `@chrona/ui-protocol` catalog.
- Add/update `packages/ui-protocol` tests when changing catalog components, builders, validation, or AI output prompt examples.
- Prefer shared spec builders over local one-off spec objects.
- Fallback specs must be tested with `validateChronaSpec()`.

### 必跑命令

- Type-only/model/state changes: `bun run typecheck` and targeted `bun run test`.
- UI primitive/foundation changes: `bun run check:ui-foundation`, `bun run typecheck`, targeted tests.
- json-render catalog/builder/validation changes: `bun run test:bun`, `bun run typecheck`.
- Task workspace navigation / execution flow changes: targeted tests plus `bun run test:e2e:desktop` when flow affected.
- Package boundary changes: `bun run check:boundaries`.

### 测试要求

- State derivation must use table-driven tests.
- UI changes must cover empty/loading/error/blocked/waiting/completed states when touched.
- Do not test CSS snapshots only; assert user-visible labels, roles, disabled reasons, and next actions.

### AI 自动修改边界

Safe for unattended AI:
- pure helper extraction
- status mapping tests
- small UI polish
- validation tests
- dead field cleanup with typecheck

Unsafe without human approval:
- execution engine changes
- DB schema/migrations
- auth/permission/token changes
- provider protocol changes
- large visual redesign
- deploy/network/secrets config
```

## 7. 下一步建议

### Phase 1: 只补测试和状态映射

1. 建立 task workspace 状态 matrix。
2. 抽 `deriveHeaderActions()`、`deriveWorkspacePresentationState()`、`derivePreferredGraphMode()`。
3. 补 `validateChronaSpec()` negative tests。
4. 补 activity merge/order tests。
5. 不改 UI 视觉，不改执行行为。

### Phase 2: 小范围 UX 和组件结构优化

1. 区分 waiting input / waiting approval copy 与视觉表达。
2. 改善 blocked/failed/recovery action 层级。
3. 收敛 command center fallback spec。
4. 清理或明确 `nodeDetail` 与 inspector/drawer 的产品语义。
5. 增加 task workspace smoke e2e。

### Phase 3: 更大的架构/设计优化

1. 重新定义 task workspace 信息架构：plan graph、command center、selected node detail、activity、output 各自职责。
2. 决定 bottom drawer 是否恢复为 selected-node 详情，或正式改为 right rail command center。
3. 收敛 server-driven UI spec 与 frontend fallback spec 为一个共享 builder contract。
4. 审查 execution/projection/state authority，避免 UI 重建 backend state。
5. 做一次人工 UX review，覆盖 desktop/tablet/mobile 三个尺寸。
