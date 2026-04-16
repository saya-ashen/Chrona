# 模块参考文档

本文档详细描述 `src/modules/` 下每个模块的功能、导出函数、参数和副作用。

---

## 目录

- [1. commands/ — 命令层（写操作）](#1-commands--命令层写操作)
- [2. queries/ — 查询层（读操作）](#2-queries--查询层读操作)
- [3. ai/ — AI 智能层](#3-ai--ai-智能层)
- [4. tasks/ — 领域逻辑层](#4-tasks--领域逻辑层)
- [5. runtime/ — 运行时适配器层](#5-runtime--运行时适配器层)
- [6. projections/ — 投影层（读模型）](#6-projections--投影层读模型)
- [7. events/ — 事件层](#7-events--事件层)
- [8. workspaces/ — 工作空间](#8-workspaces--工作空间)
- [9. ui/ — UI 配置](#9-ui--ui-配置)

---

## 1. commands/ — 命令层（写操作）

CQRS 架构的写入端。每个命令执行以下标准流程：
1. 验证输入
2. 通过 Prisma 变更数据库状态
3. 调用 `appendCanonicalEvent()` 追加不可变事件
4. 调用 `rebuildTaskProjection()` 重建读模型

### createTask

```typescript
async function createTask(input: {
  workspaceId: string
  title: string
  description?: string
  priority?: TaskPriority
  dueAt?: Date | string
  runtimeAdapterKey?: string
  runtimeModel?: string
  prompt?: string
  runtimeConfig?: Record<string, unknown>
  parentTaskId?: string
}): Promise<Task>
```

创建新任务。如果提供了 `parentTaskId`，同时创建 `child_of` 类型的 `TaskDependency`。
- **副作用**：写入 Task 表，追加 `task.created` 事件，重建投影

### updateTask

```typescript
async function updateTask(input: {
  taskId: string
  title?: string
  description?: string
  priority?: TaskPriority
  dueAt?: Date | string | null
  runtimeModel?: string
  prompt?: string
  runtimeConfig?: Record<string, unknown>
}): Promise<Task>
```

更新现有任务的字段。支持部分更新。
- **副作用**：更新 Task 记录，追加 `task.updated` 事件，重建投影

### startRun

```typescript
async function startRun(input: {
  taskId: string
  prompt?: string
}): Promise<Run>
```

为任务启动一次 AI 运行。通过 Runtime Adapter 创建运行时会话，发送 prompt 到 AI 后端。
- **副作用**：创建 Run 记录，更新 Task 状态为 Running，追加 `run.started` 事件，重建投影
- **前置条件**：任务必须已配置运行时适配器

### retryRun

```typescript
async function retryRun(input: {
  taskId: string
  prompt?: string
}): Promise<Run>
```

重试失败的运行。创建新的 Run 记录并重新执行。
- **副作用**：创建新 Run，追加 `run.retried` 事件，重建投影

### resumeRun

```typescript
async function resumeRun(input: {
  taskId: string
  prompt?: string
}): Promise<Run>
```

恢复暂停/等待中的运行。
- **副作用**：更新 Run 状态，追加 `run.resumed` 事件，重建投影

### resolveApproval

```typescript
async function resolveApproval(input: {
  approvalId: string
  decision: "Approved" | "Rejected" | "EditedAndApproved"
  feedback?: string
}): Promise<Approval>
```

处理审批请求（批准/拒绝/编辑后批准）。
- **副作用**：更新 Approval 记录，追加 `approval.resolved` 事件，重建关联任务的投影

### provideInput

```typescript
async function provideInput(input: {
  taskId: string
  inputText: string
}): Promise<void>
```

向等待输入的 Agent 提供文本输入。
- **副作用**：通过 Runtime Adapter 发送输入，追加 `input.provided` 事件，重建投影

### markTaskDone

```typescript
async function markTaskDone(input: { taskId: string }): Promise<Task>
```

将任务标记为完成。
- **副作用**：更新 Task 状态为 Done，追加 `task.done` 事件，重建投影

### acceptTaskResult

```typescript
async function acceptTaskResult(input: { taskId: string }): Promise<Task>
```

接受任务的执行结果。将任务状态从 Completed 推进到 Done。
- **副作用**：更新 Task 状态，追加 `task.result.accepted` 事件，重建投影

### reopenTask

```typescript
async function reopenTask(input: { taskId: string }): Promise<Task>
```

重新打开已完成的任务，使其可以再次执行。
- **副作用**：更新 Task 状态为 Ready，追加 `task.reopened` 事件，重建投影

### createFollowUpTask

```typescript
async function createFollowUpTask(input: {
  parentTaskId: string
  workspaceId: string
  title: string
  description?: string
  priority?: TaskPriority
  prompt?: string
}): Promise<Task>
```

基于现有任务创建后续任务，自动建立 `relates_to` 依赖关系。
- **副作用**：创建 Task + TaskDependency，追加事件，重建投影

### proposeSchedule

```typescript
async function proposeSchedule(input: {
  taskId: string
  scheduledStartAt: Date | string
  scheduledEndAt: Date | string
  source: ScheduleSource  // "human" | "ai" | "system"
  reason?: string
}): Promise<ScheduleProposal>
```

为任务提出日程安排建议（不直接应用）。
- **副作用**：创建 ScheduleProposal 记录，追加 `schedule.proposed` 事件

### decideScheduleProposal

```typescript
async function decideScheduleProposal(input: {
  proposalId: string
  decision: "Accepted" | "Rejected"
}): Promise<ScheduleProposal>
```

决定是否接受日程建议。如果接受，自动调用 `applySchedule`。
- **副作用**：更新 ScheduleProposal，可能应用日程，追加事件，重建投影

### applySchedule

```typescript
async function applySchedule(input: {
  taskId: string
  scheduledStartAt: Date | string
  scheduledEndAt: Date | string
}): Promise<Task>
```

直接为任务应用日程安排。
- **副作用**：更新 Task 的 scheduledStartAt/scheduledEndAt 字段，追加 `schedule.applied` 事件，重建投影

### clearSchedule

```typescript
async function clearSchedule(input: { taskId: string }): Promise<Task>
```

清除任务的日程安排。
- **副作用**：清空 scheduledStartAt/scheduledEndAt，追加 `schedule.cleared` 事件，重建投影

### generateTaskPlan

```typescript
async function generateTaskPlan(input: { taskId: string }): Promise<object>
```

为任务生成 AI 驱动的执行计划。使用 LLM（如可用）或规则降级生成分步计划。
- **副作用**：追加 `task.plan.generated` 事件（纯查询+事件，不直接变更任务状态）

### sendOperatorMessage

```typescript
async function sendOperatorMessage(input: {
  taskId: string
  message: string
}): Promise<void>
```

向正在运行的 Agent 发送操作员消息。
- **副作用**：通过 Runtime Adapter 发送消息，创建 ConversationEntry 记录，追加事件

### invalidateMemory

```typescript
async function invalidateMemory(input: { memoryId: string }): Promise<Memory>
```

将记忆条目标记为失效。
- **副作用**：更新 Memory 状态为 Inactive，追加 `memory.invalidated` 事件

---

## 2. queries/ — 查询层（读操作）

CQRS 的读取端。每个查询从数据库读取数据并组装为页面视图模型。

### getSchedulePage

```typescript
async function getSchedulePage(workspaceId: string): Promise<SchedulePageData>
```

获取日程页面的完整数据。这是最复杂的查询之一（~230+ 行），返回：
- `listItems` — 所有任务的日程列表项（含派生的调度状态、可运行性等）
- `planningSummary` — 规划摘要（已调度数量、总分钟数、冲突数、过载天数等）
- `focusZones` — 按日分组的专注区域（深度工作分钟、碎片分钟、风险等级）
- `conflicts` — AI 检测到的日程冲突
- `suggestions` — 冲突解决建议
- `proposals` — 待决的日程提案
- `risks` — 风险项
- `automationCandidates` — 自动化候选（auto_schedule/decompose/remind/auto_run）

### getWorkPage

```typescript
async function getWorkPage(
  taskId: string,
  copyOverrides?: Partial<WorkPageCopy>
): Promise<WorkPageData>
```

获取工作（执行）页面的数据。这是项目中最大的查询（~1200 行），返回：
- `taskShell` — 任务基础信息、状态、优先级
- `runs` — 所有运行记录
- `conversation` — 跨所有 Run 聚合的对话记录
- `approvals` — 审批请求
- `artifacts` — 产出物
- `progress` — 执行进度
- `scheduling` — 日程信息
- **特殊行为**：自动同步过期的运行时状态（通过 Runtime Adapter）

### getTaskPage

```typescript
async function getTaskPage(taskId: string): Promise<TaskPageData>
```

获取任务详情页数据，包含任务配置、运行历史、依赖关系。

### getInbox

```typescript
async function getInbox(workspaceId: string): Promise<InboxData>
```

获取收件箱数据 — 需要人工干预的事项（待审批、等待输入、失败的运行等）。

### getTaskCenter

```typescript
async function getTaskCenter(
  workspaceId: string,
  filter?: string
): Promise<TaskCenterData>
```

获取任务中心数据，支持按状态过滤（Running、WaitingForApproval、Blocked、Failed、Unscheduled、Overdue）。

### getWorkspaceOverview

```typescript
async function getWorkspaceOverview(workspaceId: string): Promise<WorkspaceOverviewData>
```

获取工作空间概览（任务统计、最近活动等）。

### getMemoryConsole

```typescript
async function getMemoryConsole(workspaceId: string): Promise<MemoryConsoleData>
```

获取记忆管理控制台数据 — 所有活跃的记忆条目。

### getWorkspaces

```typescript
async function getWorkspaces(): Promise<Workspace[]>
```

获取所有工作空间列表。

---

## 3. ai/ — AI 智能层

所有 AI 功能采用 **双模式架构**：优先使用 LLM，LLM 不可用时降级到规则引擎。

### llm-service.ts — LLM 服务抽象

```typescript
function isLLMAvailable(): boolean
```
检查 LLM 是否可用（需要 `AI_PROVIDER_BASE_URL` 和 `AI_PROVIDER_API_KEY` 环境变量）。

```typescript
async function chatCompletion(options: {
  messages: Array<{ role: string; content: string }>
  model?: string
  temperature?: number
  maxTokens?: number
}): Promise<string>
```
通用 LLM 对话补全（OpenAI 兼容 API）。

```typescript
async function chatCompletionJSON<T>(options): Promise<T>
```
带 JSON 解析的 LLM 补全，适用于结构化输出。

还导出多个系统提示词生成函数：
- `taskDecompositionSystemPrompt()` — 任务分解
- `automationSuggestionSystemPrompt()` — 自动化建议
- `conflictResolutionSystemPrompt()` — 冲突解决
- `timeslotSuggestionSystemPrompt()` — 时间段建议
- `taskAutoCompleteSystemPrompt()` — 标题自动补全
- `taskPlanSystemPrompt()` — 任务计划

### conflict-detector.ts — 规则引擎冲突检测

纯规则逻辑，不使用 LLM：

```typescript
function detectTimeOverlaps(tasks: ScheduledTaskInfo[]): Conflict[]
function detectOverload(tasks: ScheduledTaskInfo[]): Conflict[]
function detectFragmentation(tasks: ScheduledTaskInfo[]): Conflict[]
function detectDependencyConflicts(tasks: ScheduledTaskInfo[]): Conflict[]
function detectAllConflicts(tasks: ScheduledTaskInfo[]): Conflict[]
```

- `detectTimeOverlaps` — 检测时间重叠冲突
- `detectOverload` — 检测日过载（单日超过 8 小时）
- `detectFragmentation` — 检测时间碎片化（过多短间隔任务）
- `detectDependencyConflicts` — 检测依赖关系违反
- `detectAllConflicts` — 组合运行所有检测器

### conflict-analyzer.ts — 智能冲突分析

```typescript
function analyzeConflicts(input): ConflictAnalysisResult
async function analyzeConflictsSmart(input): Promise<ConflictAnalysisResult>
```

- `analyzeConflicts` — 规则引擎版本：检测冲突 + 生成建议
- `analyzeConflictsSmart` — 智能版本：先用 LLM 分析，降级到规则引擎

### suggestion-generator.ts — 建议生成器

```typescript
function generateSuggestions(conflicts: Conflict[], tasks: ScheduledTaskInfo[]): Suggestion[]
```

根据检测到的冲突生成解决方案建议（重新调度、拆分、优先级调整等）。

### task-decomposer.ts — 任务分解

```typescript
function decomposeTask(input: TaskDecompositionInput): TaskDecompositionResult
async function decomposeTaskSmart(input): Promise<TaskDecompositionResult>
```

- `decomposeTask` — 规则引擎分解：根据标题/描述的关键词匹配生成子任务
- `decomposeTaskSmart` — LLM 驱动分解：使用 AI 理解任务并智能拆分
- 返回：`{ subtasks, totalEstimatedMinutes, feasibilityScore, warnings }`

### automation-suggester.ts — 自动化建议

```typescript
function suggestAutomation(input): AutomationSuggestion
async function suggestAutomationSmart(input): Promise<AutomationSuggestion>
```

推荐任务的执行模式、提醒策略和准备步骤。
- 返回：`{ executionMode, reminderStrategy, preparationSteps, contextSources, confidence }`

### timeslot-suggester.ts — 时间段推荐

```typescript
function suggestTimeslots(input): TimeslotSuggestionResult
async function suggestTimeslotsSmart(input): Promise<TimeslotSuggestionResult>
```

基于现有日程、优先级和时间偏好推荐最佳时间段。
- 返回排名的时间段列表，每个含评分和理由

### test-analyzer.ts — 测试分析

用于分析测试结果的辅助模块。

---

## 4. tasks/ — 领域逻辑层

纯函数，无副作用，不访问数据库。

### deriveTaskState

```typescript
function deriveTaskState(input: DeriveTaskStateInput): DeriveTaskStateResult
```

从任务状态、运行记录和审批记录推导出显示状态。
- 输入：`{ status, runs, approvals }`
- 返回：`{ displayState, blockReasons, latestRunStatus, approvalPendingCount }`

### deriveTaskRunnability

```typescript
function deriveTaskRunnability(input): TaskRunnabilityState
```

判断任务是否具备运行条件。检查运行时配置（适配器、模型、prompt、必填字段）。
- 返回：`{ isRunnable, missingFields, runnabilityState }`

### deriveScheduleState

```typescript
function deriveScheduleState(input): ScheduleStatus
```

从时间数据推导日程状态：
- `Unscheduled` — 未安排
- `Scheduled` — 已安排，未开始
- `InProgress` — 进行中
- `AtRisk` — 即将超时
- `Overdue` — 已超时
- `Completed` — 已完成

### validateScheduleWindow

```typescript
function validateScheduleWindow(input: {
  scheduledStartAt: Date | string
  scheduledEndAt: Date | string
}): { valid: boolean; errors: string[] }
```

验证日程时间窗口的合法性（结束时间晚于开始时间等）。

---

## 5. runtime/ — 运行时适配器层

### 顶层文件

**registry.ts** — 适配器注册中心

```typescript
function getRuntimeAdapterDefinition(key: string): RuntimeAdapterDefinition
function resolveRuntimeAdapterKey(input): string
function getRuntimeTaskConfigSpec(key: string): RuntimeTaskConfigSpec
function validateRuntimeTaskConfig(key: string, input): RuntimeInput
function listRuntimeAdapterKeys(): string[]
```

支持的适配器：`openclaw`（OpenClaw AI 网关）、`research`（研究型适配器）

**task-config.ts** — 运行时任务配置

```typescript
function isRuntimeInput(value): boolean
function extractLegacyRuntimeFields(runtimeInput): object
function buildCompatRuntimeInput(input): RuntimeInput
function resolveTaskRuntimeConfig(input): ResolvedConfig
function validateTaskRuntimeConfig(input): ValidationResult
```

处理运行时配置的序列化/反序列化和兼容性转换。

**execution-registry.ts** — 执行适配器工厂

```typescript
async function createRuntimeExecutionAdapter(key: string): Promise<RuntimeExecutionAdapter>
```

根据适配器 key 创建实际的运行时执行适配器实例。

**task-sessions.ts** — 任务会话管理

```typescript
function buildDefaultTaskSessionKey(input): string
function resolveTaskSessionKey(input): string | null
async function ensureDefaultTaskSession(input): Promise<TaskSession>
async function updateTaskSessionStateFromRun(input): Promise<void>
```

管理任务与运行时会话的映射关系。每个任务关联一个运行时会话，多次 Run 共享同一会话（上下文累积）。

### openclaw/ — OpenClaw 适配器

**adapter.ts** — 适配器入口，实现 `RuntimeExecutionAdapter` 接口：
- `createRun()` — 创建运行
- `getRunSnapshot()` — 获取运行快照
- `sendMessage()` — 发送消息
- `provideInput()` — 提供输入

**client.ts** — WebSocket 网关客户端
- 连接 OpenClaw Gateway（WebSocket 协议）
- 支持方法：`sessions.create`、`agent`、`agent.wait`、`chat.history`、`exec.approval.list`、`exec.approval.resolve`
- 自动重连、设备身份验证

**orchestrator.ts** — 高级编排器
- `executeTask()` — 完整生命周期编排（创建运行 -> 等待完成 -> 处理审批）
- 支持策略：`wait-for-completion`、`fire-and-forget`、`interactive`
- 指数退避重试，自动审批处理

**mock-adapter.ts** — 模拟适配器
- `createStatefulMockAdapter()` — 创建有状态模拟器，用于测试
- 支持：自动完成、延迟、失败率、审批模拟

**其他文件**：
- `config.ts` — OpenClaw 配置规格
- `freshness.ts` — 运行新鲜度检测
- `sync-run.ts` — 运行状态同步
- `probe.ts` — 连通性探测
- `device-identity.ts` — 设备身份管理
- `evaluate-gate.ts` — 可行性门控评估
- `mapper.ts` — 数据映射

### research/ — 研究型适配器

**adapter.ts** — 研究型运行时适配器（用于实验性 AI 任务）
**config.ts** — 研究适配器配置规格

---

## 6. projections/ — 投影层（读模型）

### rebuildTaskProjection

```typescript
async function rebuildTaskProjection(taskId: string): Promise<void>
```

重建任务的反规范化投影。从 Task + Run + Approval 数据派生：
- 显示状态（通过 `deriveTaskState`）
- 日程状态（通过 `deriveScheduleState`）
- 阻塞原因
- 最新运行信息
- Upsert 到 `TaskProjection` 表

每个 Command 执行后自动调用此函数。

### getWorkProjection

```typescript
async function getWorkProjection(taskId: string): Promise<WorkProjection>
```

获取工作视图的投影数据。包含任务本体 + 所有关联的 Run、Event、Approval、Artifact。

---

## 7. events/ — 事件层

### appendCanonicalEvent

```typescript
async function appendCanonicalEvent(input: {
  taskId: string
  type: string        // e.g. "task.created", "run.started", "schedule.applied"
  actor?: string      // "human" | "agent" | "system"
  source?: string
  payload?: object
  runtimeTimestamp?: Date
  dedupeKey?: string  // 幂等键，防止重复事件
}): Promise<Event>
```

追加不可变事件到事件日志。
- 自动递增 `ingestSequence`
- 使用 `dedupeKey` 进行 upsert 实现幂等性
- 事件一旦写入不可修改（Event Sourcing 核心原则）

---

## 8. workspaces/ — 工作空间

### getDefaultWorkspace

```typescript
const DEFAULT_WORKSPACE_ID = "ws_default"

async function getDefaultWorkspace(): Promise<DefaultWorkspace>
```

获取默认工作空间。如果不存在则自动创建。
- 返回：`{ id, name, status, taskCount? }`
- 抛出：`DefaultWorkspaceError`（仅在创建也失败时）

---

## 9. ui/ — UI 配置

### navigation.ts

```typescript
const NAV_ITEMS: ControlPlaneNavItem[] = [
  { label: "nav.workspaces", href: "/", icon: "..." },
  { label: "nav.schedule", href: "/schedule", icon: "..." },
  { label: "nav.inbox", href: "/inbox", icon: "..." },
  { label: "nav.memory", href: "/memory", icon: "..." },
  { label: "nav.settings", href: "/settings", icon: "..." },
]
```

定义控制平面的导航结构，使用 i18n 翻译键作为标签。

---

## 模块间依赖关系

```
API Routes
    │
    ├── Commands ──→ DB (Prisma) + Events + Projections
    │                     │
    │                     └── Runtime Adapters (OpenClaw / Research)
    │
    ├── Queries ──→ DB (Prisma) + Runtime sync
    │
    └── AI ──→ LLM Service (OpenAI-compatible) + Rule Engine

Domain Logic (tasks/)
    └── 被 Commands 和 Projections 引用，纯函数无外部依赖
```

命令和查询严格分离：命令负责写入，查询负责读取，投影层是二者之间的桥梁。
