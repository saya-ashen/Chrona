# 核心模块文档

本文档详细介绍 `src/modules/` 下的核心业务逻辑模块。

## 模块概览

| 模块 | 职责 | 文件数 |
|------|------|--------|
| `commands/` | 写入操作（命令处理器） | 16 |
| `queries/` | 读取操作（页面数据组装） | 8 |
| `events/` | 事件追加（不可变日志） | 1 |
| `projections/` | 投影重建（物化视图） | 2 |
| `tasks/` | 任务领域逻辑（纯函数） | 4 |
| `runtime/` | 运行时适配器（OpenClaw） | 15+ |
| `ai/` | AI 智能服务（冲突/分解/建议） | 10 |
| `workspaces/` | 工作空间管理 | 1 |
| `ui/` | UI 导航配置 | 1 |

---

## 1. commands/ — 命令处理器

命令层实现所有状态变更操作。每个命令遵循统一模式：

```
验证输入 → 数据库变更 → 追加规范事件 → 重建任务投影 → 返回结果
```

### 任务生命周期命令

#### `createTask(input)`
创建新任务。

```typescript
interface CreateTaskInput {
  workspaceId: string;
  title: string;
  description?: string;
  priority?: TaskPriority;
  dueAt?: Date;
  runtimeAdapterKey?: string;
  runtimeInput?: string;
  runtimeInputVersion?: string;
  runtimeModel?: string;
  prompt?: string;
  runtimeConfig?: string;
  parentTaskId?: string;
}
```

**行为：**
- 验证运行时配置规格（如果提供了 adapter）
- 检查任务可运行性（deriveTaskRunnability）
- 创建数据库记录
- 追加 `TaskCreated` 事件
- 重建投影

#### `updateTask(taskId, input)`
更新任务字段。支持运行时配置的增量合并。

**特殊逻辑：**
- 如果更新了运行时配置相关字段，会重新计算可运行性
- 支持 `runtimeConfig` 的深度合并（不是覆盖）

#### `markTaskDone(taskId)`
将已完成执行的任务标记为最终完成。

#### `reopenTask(taskId)`
重新打开已完成的任务。

#### `acceptTaskResult(taskId)`
接受任务执行结果。

#### `createFollowUpTask(taskId, input)`
基于当前任务创建后续任务。

### 执行管理命令

#### `startRun(taskId, options?)`
启动 AI 智能体执行。

```typescript
interface StartRunOptions {
  prompt?: string;  // 覆盖任务的默认 prompt
}
```

**行为：**
1. 验证任务可运行性
2. 获取/创建运行时会话（TaskSession）
3. 调用运行时适配器创建执行（RuntimeExecutionAdapter.createRun）
4. 在数据库创建 Run 记录
5. 追加 `RunStarted` 事件
6. 更新任务的 latestRunId
7. 重建投影

#### `resumeRun(runId)`
恢复暂停的执行（需要运行时支持 `resumeSupported`）。

#### `retryRun(runId)`
重试失败的执行（需要 `retryable` 为 true）。

#### `resolveApproval(approvalId, decision)`
处理审批请求。

```typescript
type Decision = {
  action: "approve" | "reject" | "edit_and_approve";
  resolution?: string;  // 决议说明
  editedContent?: string;  // 编辑后的内容（edit_and_approve 时）
}
```

**行为：**
- 更新审批状态
- 通过运行时适配器将决议传达给智能体
- 追加 `ApprovalResolved` 事件
- 重建投影

#### `sendOperatorMessage(taskId, message, runId?)`
向正在运行的智能体发送消息。如未指定 runId，自动查找最新活跃执行。

#### `provideInput(taskId, inputText, runId?)`
为等待输入的执行提供输入。自动查找状态为 `WaitingForInput` 的执行。

### 排期命令

#### `applySchedule(taskId, window)`
直接应用排期窗口。

```typescript
interface ScheduleWindow {
  scheduledStartAt: Date;
  scheduledEndAt: Date;
  dueAt?: Date;
  scheduleSource?: ScheduleSource;
}
```

**行为：**
- 验证时间窗口（validateScheduleWindow）
- 更新任务的排期字段
- 派生排期状态（deriveScheduleState）
- 追加 `ScheduleApplied` 事件
- 重建投影

#### `clearSchedule(taskId)`
清除任务的排期。

#### `proposeSchedule(taskId, proposal)`
创建排期建议（不直接应用）。

#### `decideScheduleProposal(proposalId, decision)`
接受或拒绝排期建议。接受时自动调用 `applySchedule`。

### 其他命令

#### `generateTaskPlan(taskId)`
使用 LLM 为任务生成执行计划。无 LLM 时回退到模拟计划。

#### `invalidateMemory(memoryId)`
使记忆条目失效。

---

## 2. queries/ — 查询处理器

查询层负责组装各页面所需的完整数据结构。每个查询对应一个 UI 页面。

### `getSchedulePage(workspaceId, selectedDay)`

**返回类型：** `SchedulePageData`

排期页面是数据最丰富的查询，组装以下数据：

```typescript
interface SchedulePageData {
  // 基础列表
  scheduled: ScheduleRecord[];        // 已排期任务
  unscheduled: ScheduleRecord[];      // 未排期任务
  risks: RiskItem[];                  // 风险项

  // 分析数据
  focusZones: FocusZone[];            // 专注区域
  automationCandidates: AutomationCandidate[];  // 自动化候选
  conflicts: ScheduleConflict[];      // 冲突检测结果
  suggestions: ScheduleSuggestion[];  // 改进建议

  // 汇总
  planningSummary: PlanningSummary;    // 规划摘要
  proposals: ScheduleProposal[];      // 待处理建议
  listItems: ScheduleListItem[];      // 扁平列表

  // 衍生统计
  // scheduledMinutes, runnableQueueCount, conflictCount,
  // overloadedDayCount, proposalCount, riskCount,
  // dueSoonUnscheduledCount, largestIdleWindowMinutes, overloadedMinutes
}
```

**专注区域 (FocusZone) 计算：**
- 按天分组已排期任务
- 计算 totalMinutes、deepWorkMinutes（高优先级任务）、fragmentedMinutes（<90分钟任务）
- 评估 riskLevel（high/medium/low）

**自动化候选 (AutomationCandidate) 规则：**
- `auto_schedule`：未排期但有待处理的 AI 排期建议
- `decompose`：未排期且不可运行的任务（缺少 prompt/runtime）
- `remind`：风险项需要用户跟进
- `auto_run`：已排期、可运行、无审批阻塞的任务

### `getWorkPage(taskId)`

**返回类型：** `WorkPageData`

工作台页面查询，组装任务执行的深度视图：

```typescript
interface WorkPageData {
  task: TaskWithDetails;
  interventions: Intervention[];      // 待处理的干预
  taskPlan: TaskPlan | null;          // 执行计划
  conversation: ConversationMessage[];// 对话历史（跨所有执行）
  workstream: WorkstreamEvent[];      // 工作流事件时间线
  evidence: Evidence[];               // 证据/产出物
  scheduleImpact: ScheduleImpact;     // 排期影响评估
  runnability: TaskRunnabilityResult; // 可运行性状态
}
```

**特殊行为：**
- 对话历史聚合所有执行的 ConversationEntry（不只是最新一次）
- 工作流事件包含执行状态变更、审批、工具调用等

### `getTaskCenter(workspaceId, filters?)`

任务列表查询，支持按状态、优先级筛选。

### `getInbox(workspaceId)`

收件箱查询，聚合以下待处理项：
- 待审批请求（Pending Approvals）
- 待处理的排期建议
- 等待输入的执行
- 需要恢复的失败执行

### `getWorkspaceOverview(workspaceId)`

工作空间概览，包含运行中/阻塞/风险任务数、近期截止、最近活动。

### `getTaskPage(taskId)`

单任务详情，包含执行历史、审批记录、产出物、依赖关系。

### `getMemoryConsole(workspaceId)`

记忆控制台数据，列出工作空间的所有活跃记忆条目。

---

## 3. events/ — 事件存储

### `appendCanonicalEvent(event)`

追加不可变的规范事件。

```typescript
interface CanonicalEventInput {
  eventType: string;      // 事件类型（如 "TaskCreated"）
  workspaceId: string;
  taskId?: string;
  runId?: string;
  actorType: string;      // "human" | "agent" | "system"
  actorId?: string;
  source: string;         // 来源标识
  payload?: object;       // 事件负载
  dedupeKey: string;      // 去重键（唯一）
}
```

**行为：**
- 使用 upsert 实现幂等写入（基于 dedupeKey）
- 自动分配递增的 ingestSequence
- 创建时间自动设置

**常见事件类型：**
- `TaskCreated`, `TaskUpdated`, `TaskCompleted`, `TaskReopened`
- `RunStarted`, `RunCompleted`, `RunFailed`
- `ApprovalRequested`, `ApprovalResolved`
- `ScheduleApplied`, `ScheduleCleared`, `ScheduleProposed`
- `OperatorMessageSent`, `InputProvided`
- `PlanGenerated`

---

## 4. projections/ — 投影重建

### `rebuildTaskProjection(taskId)`

从任务当前状态重建物化投影。

**计算逻辑：**
1. 读取 Task + 最新 Run + Approval 计数
2. 调用 `deriveTaskState()` 计算显示状态
3. 调用 `deriveScheduleState()` 计算排期状态
4. 组装 TaskProjection 并 upsert

**触发时机：** 每个命令处理器执行后自动调用。

### `getWorkProjection(taskId)`

工作台页面的投影辅助查询。

---

## 5. tasks/ — 任务领域逻辑

纯函数模块，无数据库依赖。

### `deriveTaskState(task, latestRun?, approvalCounts?)`

从多维度派生任务的显示状态。

**状态派生优先级：**
1. `SyncStale` — 同步过期
2. `WaitingForApproval` — 有待审批项
3. `WaitingForInput` — 等待用户输入
4. `AttentionNeeded` — 需要关注（多种条件）
5. 直接映射 task.status

### `deriveTaskRunnability(task, configSpec?)`

检查任务是否具备运行条件。

```typescript
interface TaskRunnabilityResult {
  isRunnable: boolean;
  missingFields: string[];       // 缺少的必填字段
  runnabilityState: string;      // "ready" | "missing_runtime" | "missing_fields" | ...
}
```

**检查项：**
- 是否有 runtimeAdapterKey
- 是否有 prompt
- 是否有 runtimeModel（如果 configSpec 要求）
- 是否满足 configSpec 定义的所有必填字段

### `deriveScheduleState(task)`

从排期窗口和执行状态派生排期状态。

**状态映射：**
- 无排期 → `Unscheduled`
- 有排期但未到时间 → `Scheduled`
- 正在排期窗口内 → `InProgress`
- 已完成 → `Completed`
- 超过结束时间未完成 → `Overdue`
- 执行中断 → `Interrupted`
- 接近截止日期 → `AtRisk`

### `validateScheduleWindow(window)`

验证排期时间窗口的合法性（开始 < 结束，时间合理性等）。

---

## 6. runtime/ — 运行时适配器

运行时层提供可插拔的 AI 执行引擎抽象。

### 核心接口

```typescript
interface RuntimeExecutionAdapter {
  createRun(task, session, options?): Promise<RunResult>;
  sendOperatorMessage(run, message): Promise<void>;
  getRunSnapshot(run): Promise<RunSnapshot>;
  readHistory(run, cursor?): Promise<HistoryPage>;
  listApprovals(run): Promise<Approval[]>;
  resumeRun(run): Promise<void>;
}

interface RuntimeAdapterDefinition {
  key: string;              // 适配器标识 (如 "openclaw")
  displayName: string;
  configSpec: RuntimeTaskConfigSpec;  // 配置规格
}
```

### 注册表 (registry.ts)

```typescript
// 当前注册的适配器
listRuntimeAdapterKeys();  // ["openclaw", "research"]

// 获取配置规格
getRuntimeTaskConfigSpec("openclaw");
// → { fields: [{ key: "model", required: true }, ...] }

// 解析适配器
resolveRuntimeAdapterKey("openclaw");
// → RuntimeAdapterDefinition
```

### OpenClaw 适配器 (`runtime/openclaw/`)

OpenClaw 是主要的 AI 智能体运行时，通过 WebSocket 与 OpenClaw Gateway 通信。

#### 文件结构

| 文件 | 职责 |
|------|------|
| `client.ts` | WebSocket 客户端，管理连接和消息收发 |
| `adapter.ts` | 创建 OpenClawAdapter 实例（live 或 mock） |
| `orchestrator.ts` | 高层编排：任务启动、重试、回退 |
| `sync-run.ts` | 从运行时同步执行状态到本地数据库 |
| `freshness.ts` | 过期检测和自动同步（读取查询时触发） |
| `mapper.ts` | 运行时数据到本地模型的映射 |
| `evaluate-gate.ts` | 审批门控评估 |
| `device-identity.ts` | 设备身份管理 |
| `probe.ts` | 运行时健康探测 |
| `types.ts` | OpenClaw 特定类型定义 |
| `config.ts` | 配置常量 |
| `mock-adapter.ts` | 测试用的模拟适配器 |

#### 同步机制

```
OpenClaw Gateway ←→ sync-run.ts ←→ 本地 DB
                                     │
                  freshness.ts ──────┘
                  (查询时自动检查过期)
```

### 配置规格 (config-spec.ts)

定义运行时适配器需要的配置字段：

```typescript
interface RuntimeTaskConfigField {
  key: string;
  label: string;
  type: "string" | "text" | "number" | "boolean" | "select";
  required: boolean;
  options?: string[];
  default?: unknown;
}

interface RuntimeTaskConfigSpec {
  fields: RuntimeTaskConfigField[];
}
```

---

## 7. ai/ — AI 智能服务

AI 模块提供规则引擎 + LLM 双引擎的智能功能。

### LLM 服务 (llm-service.ts)

OpenAI 兼容的 LLM 抽象层。

```typescript
// 基本聊天补全
chatCompletion(messages, options?): Promise<string>;

// JSON 结构化输出
chatCompletionJSON<T>(messages, schema, options?): Promise<T>;

// 可用性检查
isLLMAvailable(): boolean;
```

### 冲突检测 (conflict-detector.ts)

检测排期中的 4 种冲突：

1. **时间重叠 (time_overlap)**：两个已排期任务时间交叉
2. **每日超载 (daily_overload)**：单日排期超过 8 小时
3. **碎片化 (fragmentation)**：存在过多 < 90 分钟的任务块
4. **依赖违反 (dependency_violation)**：被依赖的任务未完成但依赖方已排期

```typescript
detectAllConflicts(tasks: ScheduledTaskInfo[]): Conflict[];
```

### 建议生成 (suggestion-generator.ts)

为检测到的冲突生成解决建议：
- 重新排期
- 延期
- 合并类似任务
- 调整优先级顺序

### 冲突分析器 (conflict-analyzer.ts)

编排冲突检测 + 建议生成：

```typescript
// 纯规则引擎
analyzeConflicts(tasks): { conflicts, suggestions };

// LLM 增强（规则引擎兜底）
analyzeConflictsSmart(tasks): { conflicts, suggestions };
```

### 任务分解 (task-decomposer.ts)

将复杂任务分解为子任务，支持 5 种策略：

1. 描述列表识别
2. 动词模式匹配
3. 逗号列表分割
4. 连词分割
5. 按时长拆分

```typescript
// 规则引擎
decomposeTask(task): TaskDecompositionResult;

// LLM 增强
decomposeTaskSmart(task): TaskDecompositionResult;
```

### 自动化建议 (automation-suggester.ts)

为任务建议执行策略：

```typescript
suggestAutomation(task): AutomationSuggestion;
// → { executionMode, reminderStrategy, prepSteps }
```

### 时间建议 (timeslot-suggester.ts)

基于空闲时间、优先级、时间段偏好等因素推荐最佳排期时段：

```typescript
suggestTimeslots(input): TimeslotSuggestion[];
```

### OpenClaw 建议服务 (openclaw-suggest.ts)

通过 OpenClaw Gateway WebSocket 会话获取 AI 建议：

```typescript
suggestViaOpenClaw(input): Promise<AutoCompleteSuggestion[]>;
```

**特性：**
- 每个工作空间独立会话
- 首次消息附带系统提示词
- 结构化 JSON 响应解析

### 排期建议插件 (schedule-suggest-plugin.ts)

OpenClaw 智能体可调用的工具：

```typescript
// 可用工具
"schedule.list_tasks"    // 列出工作空间任务
"schedule.get_health"    // 获取排期健康状态
"schedule.check_conflicts" // 检查排期冲突

executeScheduleTool(toolName, args): Promise<ToolResult>;
```

---

## 8. workspaces/ — 工作空间管理

### `getDefaultWorkspace()`

查找或自动创建默认工作空间。

```typescript
const DEFAULT_WORKSPACE_ID = "default";

getDefaultWorkspace(): Promise<Workspace>;
```

---

## 9. ui/ — UI 导航

### `NAV_ITEMS`

定义应用导航结构：

```typescript
const NAV_ITEMS = [
  { href: "/workspaces", label: "Workspaces", icon: ... },
  { href: "/schedule",   label: "Schedule",   icon: ... },
  { href: "/inbox",      label: "Inbox",      icon: ... },
  { href: "/memory",     label: "Memory",     icon: ... },
  { href: "/settings",   label: "Settings",   icon: ... },
];
```
