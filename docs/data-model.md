# 数据模型

## 概览

AgentDashboard 使用 SQLite 数据库，通过 Prisma 7 ORM 管理 15 个数据模型。数据模型围绕"任务生命周期"设计，覆盖工作空间管理、任务执行、审批流程、排期规划、事件审计等领域。

## 实体关系图

```
Workspace (工作空间)
  │
  ├── Task (任务) ──────────────┐
  │     │                       │
  │     ├── Run (执行)          │ TaskDependency (依赖关系)
  │     │    ├── Approval       │
  │     │    ├── Artifact       │
  │     │    ├── ConversationEntry
  │     │    ├── ToolCallDetail
  │     │    └── RuntimeCursor
  │     │
  │     ├── TaskSession (会话)
  │     ├── TaskProjection (投影)
  │     ├── ScheduleProposal (排期建议)
  │     └── Task (子任务, 自引用)
  │
  ├── Memory (记忆)
  └── Event (事件日志)
```

## 模型详解

### Workspace（工作空间）

工作空间是顶层容器，隔离不同项目的任务和数据。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | String (CUID) | 主键 |
| name | String | 工作空间名称 |
| description | String? | 描述 |
| defaultRuntime | String? | 默认运行时适配器 |
| status | WorkspaceStatus | Active / Archived |
| createdAt | DateTime | 创建时间 |
| updatedAt | DateTime | 更新时间 |

### Task（任务）

核心实体，代表一个待执行的任务。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | String (CUID) | 主键 |
| workspaceId | String | 所属工作空间 |
| title | String | 任务标题 |
| description | String? | 任务描述 |
| status | TaskStatus | 任务状态 |
| priority | TaskPriority | 优先级 (Low/Medium/High/Urgent) |
| ownerType | OwnerType | 所有者类型 (human/agent) |
| **运行时配置** | | |
| runtimeAdapterKey | String? | 运行时适配器标识 (如 "openclaw") |
| runtimeInput | String? | 运行时输入数据 (JSON) |
| runtimeInputVersion | String? | 输入版本 |
| runtimeModel | String? | AI 模型名称 |
| prompt | String? | 执行提示词 |
| runtimeConfig | String? | 运行时配置 (JSON) |
| **排期字段** | | |
| dueAt | DateTime? | 截止时间 |
| scheduledStartAt | DateTime? | 计划开始时间 |
| scheduledEndAt | DateTime? | 计划结束时间 |
| scheduleStatus | ScheduleStatus | 排期状态 |
| scheduleSource | ScheduleSource? | 排期来源 (human/ai/system) |
| **关联** | | |
| parentTaskId | String? | 父任务 ID（子任务关系） |
| latestRunId | String? | 最新执行 ID |
| budgetLimit | Int? | 预算限制 |
| blockReason | String? | 阻塞原因 |

**索引：**
- `[workspaceId, status]`
- `[workspaceId, priority]`
- `[workspaceId, scheduleStatus]`

### Run（执行）

一次 AI 智能体的执行实例。一个任务可有多次执行。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | String (CUID) | 主键 |
| taskId | String | 所属任务 |
| runtimeName | String | 运行时名称 |
| status | RunStatus | 执行状态 |
| startedAt | DateTime | 开始时间 |
| endedAt | DateTime? | 结束时间 |
| errorSummary | String? | 错误摘要 |
| runtimeRunRef | String? | 运行时侧的执行引用 (唯一) |
| resumeToken | String? | 恢复令牌 |
| triggeredBy | String? | 触发者 |
| retryable | Boolean | 是否可重试 |
| resumeSupported | Boolean | 是否支持恢复 |
| pendingInputPrompt | String? | 等待输入的提示文本 |
| pendingInputType | String? | 等待输入的类型 |
| lastSyncedAt | DateTime? | 最后同步时间 |
| syncStatus | String? | 同步状态 |

**RunStatus 枚举：**
- `Pending` → `Running` → `Completed` / `Failed` / `Cancelled`
- `Running` → `WaitingForInput` / `WaitingForApproval` → `Running`

### Approval（审批）

AI 智能体执行过程中的审批请求。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | String | 主键 |
| runId | String | 所属执行 |
| type | String | 审批类型 |
| title | String | 标题 |
| summary | String? | 摘要 |
| riskLevel | String? | 风险等级 |
| status | ApprovalStatus | 审批状态 |
| resolvedAt | DateTime? | 决议时间 |
| resolvedBy | String? | 决议者 |
| resolution | String? | 决议内容 |

**ApprovalStatus：** Pending → Approved / Rejected / EditedAndApproved / Expired

### Artifact（产出物）

执行产生的文件、报告等输出。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | String | 主键 |
| runId | String | 所属执行 |
| type | ArtifactType | 类型 (file/patch/summary/report/terminal_output/url) |
| title | String | 标题 |
| uri | String? | 资源地址 |
| contentPreview | String? | 内容预览 |
| metadata | String? | 元数据 (JSON) |

### ConversationEntry（会话记录）

执行过程中的对话消息。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | String | 主键 |
| runId | String | 所属执行 |
| role | String | 角色 (user/assistant/system) |
| content | String | 消息内容 |
| sequence | Int | 序列号 |
| externalRef | String? | 外部引用 |

### ToolCallDetail（工具调用）

执行过程中的工具调用记录。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | String | 主键 |
| runId | String | 所属执行 |
| toolName | String | 工具名称 |
| status | String | 状态 |
| argumentsSummary | String? | 参数摘要 |
| resultSummary | String? | 结果摘要 |
| errorSummary | String? | 错误摘要 |
| externalRef | String? | 外部引用 |

### TaskProjection（任务投影）

任务的物化视图，为 UI 优化的非规范化数据。每次命令执行后自动重建。

| 字段 | 类型 | 说明 |
|------|------|------|
| taskId | String | 关联任务 (主键) |
| displayState | String | 显示状态（派生自多个维度） |
| blockType | String? | 阻塞类型 |
| blockScope | String? | 阻塞范围 |
| actionRequired | String? | 所需操作 |
| pendingApprovalCount | Int | 待审批数量 |
| approvalPendingCount | Int | 审批挂起数量 |
| scheduleStatus | String? | 排期状态 |
| latestArtifactTitle | String? | 最新产出物标题 |
| lastActivityAt | DateTime? | 最后活动时间 |

**displayState 可能的值：**
- `Draft`, `Ready`, `Queued`, `Running`
- `WaitingForApproval`, `WaitingForInput`
- `Blocked`, `Failed`, `Completed`, `Done`, `Cancelled`
- `AttentionNeeded`, `SyncStale`

### TaskSession（任务会话）

管理任务与运行时之间的会话。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | String | 主键 |
| taskId | String | 所属任务 |
| sessionKey | String | 会话键 (唯一) |
| runtimeName | String | 运行时名称 |
| status | String | 会话状态 |
| activeRunId | String? | 当前活跃执行 ID |

### TaskDependency（任务依赖）

任务间的依赖关系。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | String | 主键 |
| taskId | String | 任务 ID |
| dependsOnTaskId | String | 被依赖的任务 ID |
| type | TaskDependencyType | blocks / relates_to / child_of |

**唯一约束：** `[taskId, dependsOnTaskId]`

### ScheduleProposal（排期建议）

AI 或系统生成的排期变更建议。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | String | 主键 |
| taskId | String | 目标任务 |
| source | ScheduleSource | 来源 (ai/human/system) |
| status | ScheduleProposalStatus | Pending / Accepted / Rejected |
| proposedBy | String? | 提议者 |
| summary | String? | 变更摘要 |
| proposedStartAt | DateTime? | 建议开始时间 |
| proposedEndAt | DateTime? | 建议结束时间 |
| proposedDueAt | DateTime? | 建议截止时间 |

### Memory（记忆）

AI 智能体的持久化知识条目。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | String | 主键 |
| workspaceId | String | 所属工作空间 |
| taskId | String? | 关联任务 |
| content | String | 记忆内容 |
| scope | MemoryScope | user / workspace / project / task |
| sourceType | MemorySourceType | user_input / agent_inferred / imported / system_rule |
| confidence | Float | 置信度 |
| status | MemoryStatus | Active / Inactive / Conflicted / Expired |
| expiresAt | DateTime? | 过期时间 |

### Event（事件日志）

不可变的规范事件日志，所有状态变更的审计轨迹。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | String | 主键 |
| eventType | String | 事件类型 (如 TaskCreated, RunStarted) |
| workspaceId | String | 所属工作空间 |
| taskId | String? | 关联任务 |
| runId | String? | 关联执行 |
| actorType | String | 操作者类型 (human/agent/system) |
| actorId | String? | 操作者 ID |
| source | String | 来源 |
| payload | String? | 事件负载 (JSON) |
| dedupeKey | String | 去重键 (唯一) |
| ingestSequence | Int | 摄入序列号 (自增) |
| createdAt | DateTime | 创建时间 |

### RuntimeCursor（运行时游标）

跟踪与外部运行时的同步状态。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | String | 主键 |
| runId | String | 所属执行 (唯一) |
| nextCursor | String? | 下一个同步游标 |
| lastEventRef | String? | 最后事件引用 |
| healthStatus | String? | 健康状态 |
| updatedAt | DateTime | 更新时间 |

## 枚举类型总览

```typescript
// 任务状态流转
TaskStatus: Draft → Ready → Queued → Running → Completed → Done
                                   ↗ Scheduled ↘
                         WaitingForInput / WaitingForApproval
                                    Blocked / Failed / Cancelled

// 优先级
TaskPriority: Low | Medium | High | Urgent

// 排期状态
ScheduleStatus: Unscheduled | Scheduled | InProgress | AtRisk
              | Interrupted | Overdue | Completed

// 执行状态
RunStatus: Pending | Running | WaitingForInput | WaitingForApproval
         | Failed | Completed | Cancelled

// 审批状态
ApprovalStatus: Pending | Approved | Rejected | EditedAndApproved | Expired
```
