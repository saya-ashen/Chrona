# Backend Execution Flow

本文档描述 Chrona 后端从用户创建任务到计划执行完成的主流程。当前实现以 Hono route 作为 HTTP 入口，业务逻辑主要落在 `packages/engine/src/modules/*`，执行编排由 `packages/engine/src/modules/plan-execution/plan-runner.ts` 驱动。

当前 `apps/server/src/routes/plans.routes.ts` 暴露的 plan 路由只有：

- `GET /api/tasks/:taskId/plan/state`
- `POST /api/tasks/:taskId/plan/accept`
- `POST /api/tasks/:taskId/plan/generate/stop`
- `POST /api/tasks/:taskId/plan/generate`
- `POST /api/tasks/:taskId/plan`

`/plan/materialize` 和 `/plan/mutations` 不是当前公开后端主流程的一部分。`materializeTaskPlan()` 仍是内部命令，会由 `progressAcceptedTaskPlan()` 在 accepted plan 自动推进 child tasks 时调用；它不应画成用户 HTTP 主链路。

## End-to-End Flow

```mermaid
flowchart TD
  U[用户/前端] --> A[POST /api/tasks]
  A --> B[createTasksRoutes]
  B --> C[createTask]
  C --> C1[校验 workspace / parentTask / runtime config]
  C1 --> C2[db.task.create]
  C2 --> C3[rebuildTaskProjection]
  C3 --> T[任务创建完成<br/>status: Ready 或 Draft]

  T --> G[POST /api/tasks/:taskId/plan/generate]
  G --> GR[createPlansRoutes]
  GR --> GS[generateTaskPlanManualStream]
  GS --> GS1[检查是否已有 Scheduled/Active 生成任务]
  GS1 --> GS2[调用 AI provider<br/>feature: generate_plan]
  GS2 --> GS3[接收 generate_task_plan_graph tool payload]
  GS3 --> GS4[materializeGeneratedTaskPlan]
  GS4 --> GS5[保存 compiled plan / read model]
  GS5 --> WP[等待用户接受计划<br/>plan status: waiting_acceptance]

  WP --> AC[POST /api/tasks/:taskId/plan/accept]
  AC --> AR[createPlansRoutes]
  AR --> AR1[ensurePlanInWorkspace]
  AR1 --> AR2[更新 saved plan status: accepted]
  AR2 --> AP[accepted plan 可执行]

  AP --> RUN[POST /api/tasks/:taskId/run]
  RUN --> ER[createExecutionRoutes]
  ER --> DEA[dispatchExecutionAction<br/>action: start_manual]
  DEA --> SPE[startPlanExecution]
  SPE --> ENR[ensureNativePlanRun]
  ENR --> ES[ensureExecutionSession]
  ES --> PMS[ensurePlanMainSession]
  PMS --> WB[activateWorkBlock]
  WB --> EVT1[appendMainSessionEvent<br/>execution_started]
  EVT1 --> ADV[advancePlanExecution loop]

  ADV --> EPG[resolveEffectivePlanGraph]
  EPG --> READY{有 ready node?}
  READY -- 否 --> DONE[completeExecution]
  READY -- 是 --> PICK[pickNextNodeId]
  PICK --> EXECUTOR[dispatchExecutor]
  EXECUTOR --> ATTEMPT[创建 NodeAttempt<br/>status: running]
  ATTEMPT --> SS[setExecutionSessionState<br/>status: Active]
  SS --> TASKRUN[db.task.update<br/>status: Running]
  TASKRUN --> EVT2[appendMainSessionEvent<br/>node_started]
  EVT2 --> PERSIST1[persistRuntimeState]
  PERSIST1 --> EXE[executor.execute]

  EXE --> NEXEC[executePlanNode / node-specific executor]
  NEXEC --> RT{节点执行结果}

  RT -- done --> RD[attempt succeeded<br/>append current result<br/>node_completed]
  RD --> PERSIST2[persistRuntimeState]
  PERSIST2 --> ADV

  RT -- waiting_for_user --> WU[pauseExecution<br/>TaskStatus.WaitingForInput]
  RT -- waiting_for_approval --> WA[pauseExecution<br/>TaskStatus.WaitingForApproval]
  RT -- child_running --> WC[pauseExecution<br/>external_dependency]
  RT -- blocked --> BL[pauseExecution<br/>TaskStatus.Blocked]
  RT -- failed --> FA[TaskStatus.Failed<br/>session Abandoned]
  RT -- replan_required --> RP[pauseExecution<br/>approval_required]

  DONE --> CS[setExecutionSessionState<br/>Completed 或 Paused]
  CS --> CT[db.task.update]
  CT --> COK{terminal status completed?}
  COK -- 是 --> CT2[TaskStatus.Completed<br/>completedAt = now]
  COK -- 否 --> CP[Waiting/Blocked 状态]
  CT2 --> EVT3[appendMainSessionEvent<br/>execution_completed]
  EVT3 --> CWB[completeWorkBlock]
  CWB --> PROJ[rebuildTaskProjection]
  PROJ --> RESP[返回 PlanExecutionResult]
```

## Internal Child Task Progression

Accepted parent plans can also progress through an internal synchronization path after child runtime runs complete. This is not a public `/plan/materialize` route.

```mermaid
flowchart TD
  RUNTIME[Runtime run sync] --> SYNC[sync-run.ts]
  SYNC --> CHECK{run.task.parentTaskId?}
  CHECK -- 否 --> END[只 rebuild 当前 task projection]
  CHECK -- 是 --> SAP[syncAcceptedTaskPlanForTask]
  SAP --> DONE{child run status Completed?}
  DONE -- 否 --> SPS[syncParentTaskStateFromAcceptedPlan]
  DONE -- 是 --> PROG[progressAcceptedTaskPlan]
  PROG --> EFF[resolveSavedPlanEffectiveGraph]
  EFF --> READY{存在 ready plan node?}
  READY -- 是 --> MAT[materializeTaskPlan 内部命令]
  MAT --> CHILD[创建/更新 linked child tasks 和 dependencies]
  CHILD --> START[startPlanExecution<br/>trigger: auto]
  READY -- 否 --> FINAL[检查 parent plan 是否 all done]
  START --> FINAL
  FINAL --> PARENT[更新 parent task status / projection]
```

## Pause And Resume Flow

```mermaid
flowchart TD
  P[执行暂停] --> K{暂停原因}

  K -- waiting_for_user --> IN[POST /api/tasks/:taskId/input]
  IN --> A1[dispatchExecutionAction<br/>resume_with_input]
  A1 --> C1[continuePlanExecution]
  C1 --> ADV[advancePlanExecution<br/>forcedNodeId = waiting node]

  K -- blocked --> MSG[POST /api/tasks/:taskId/message]
  MSG --> A2[dispatchExecutionAction<br/>resume_after_unblock]
  A2 --> C2[continuePlanExecution]
  C2 --> ADV

  K -- waiting_for_approval --> APR[POST /api/approvals/:approvalId/resolve]
  APR --> RA[resolveApproval]
  RA --> A3[dispatchExecutionAction<br/>resume_with_approval]
  A3 --> C3[continuePlanExecution]
  C3 --> ADV

  K -- failed node --> RETRY[POST /api/tasks/:taskId/retry<br/>或 execution/actions retry_node]
  RETRY --> A4[dispatchExecutionAction]
  A4 --> R1[cancel active attempt]
  R1 --> R2[mark old node results obsolete]
  R2 --> ADV

  ADV --> NEXT[继续执行 ready node]
```

## Text Diagram

```text
用户创建任务
  |
  v
POST /api/tasks
  |
  v
createTasksRoutes -> createTask
  |
  +-- 校验 workspace / parent task / runtime config
  +-- db.task.create
  +-- rebuildTaskProjection
  |
  v
Task: Ready 或 Draft
  |
  v
POST /api/tasks/:taskId/plan/generate
  |
  v
generateTaskPlanManualStream
  |
  +-- 调 AI provider: generate_plan
  +-- 接收 generate_task_plan_graph
  +-- materializeGeneratedTaskPlan
  +-- 保存 compiled plan / read model
  |
  v
Plan: waiting_acceptance
  |
  v
POST /api/tasks/:taskId/plan/accept
  |
  v
Plan: accepted
  |
  v
POST /api/tasks/:taskId/run
  |
  v
dispatchExecutionAction(start_manual)
  |
  v
startPlanExecution
  |
  +-- ensureNativePlanRun
  +-- ensureExecutionSession
  +-- ensurePlanMainSession
  +-- activateWorkBlock
  +-- event: execution_started
  |
  v
advancePlanExecution loop
  |
  +-- resolveEffectivePlanGraph
  +-- pickNextNodeId
  +-- dispatchExecutor
  +-- create NodeAttempt(running)
  +-- task.status = Running
  +-- event: node_started
  +-- persistRuntimeState
  |
  v
executor.execute / executePlanNode
  |
  +-- done: 写 node result，event node_completed，继续 loop
  +-- waiting_for_user: pauseExecution，TaskStatus.WaitingForInput
  +-- waiting_for_approval: pauseExecution，TaskStatus.WaitingForApproval
  +-- child_running: pauseExecution，等待 child task/session
  +-- blocked: pauseExecution，TaskStatus.Blocked
  +-- failed: TaskStatus.Failed，session Abandoned
  +-- replan_required: pauseExecution，等待审批/改计划
  |
  v
无 ready node
  |
  v
completeExecution
  |
  +-- setExecutionSessionState Completed/Paused
  +-- 如果 completed: task.status = Completed, completedAt = now
  +-- event: execution_completed
  +-- completeWorkBlock
  +-- rebuildTaskProjection
  |
  v
返回 PlanExecutionResult
```

## Source Map

| Area | File | Role |
|------|------|------|
| Task routes | `apps/server/src/routes/tasks.routes.ts` | `POST /tasks` creates tasks and validates task payloads. |
| Plan routes | `apps/server/src/routes/plans.routes.ts` | Current public plan endpoints: state, generate, generate stop, accept, and high-level patch via `POST /tasks/:taskId/plan`. |
| Execution routes | `apps/server/src/routes/execution.routes.ts` | Run, retry, input, message, done, reopen, result accept, follow-up, and approval resolve endpoints. |
| Task command | `packages/engine/src/modules/commands/create-task.ts` | Validates runtime settings, creates `Task`, rebuilds projection. |
| Plan generation | `packages/engine/src/modules/commands/generate-task-plan-manual-stream.ts` | Streams AI plan generation and persists generated plans. |
| Internal plan materialization | `packages/engine/src/modules/commands/materialize-task-plan.ts` | Internal command used by `progressAcceptedTaskPlan()` to convert accepted plan nodes into child tasks and dependencies. Not exposed as a current public route. |
| Parent plan progression | `packages/engine/src/modules/commands/progress-accepted-task-plan.ts` | Syncs accepted parent plans after child run completion, materializes ready child tasks internally, and starts child execution with `trigger: "auto"`. |
| Runtime sync | `packages/engine/src/modules/runtime-sync/sync-run.ts` | Synchronizes provider run status and triggers parent accepted-plan progression when child runs complete. |
| Plan execution | `packages/engine/src/modules/plan-execution/plan-runner.ts` | Owns `dispatchExecutionAction`, `startPlanExecution`, `continuePlanExecution`, `advancePlanExecution`, and `completeExecution`. |
| Node execution | `packages/engine/src/modules/plan-execution/node-executor.ts` | Executes one effective plan node through runtime or child-session logic. |

## Execution Status Outcomes

| Node result | Backend effect |
|-------------|----------------|
| `done` | Attempt succeeds, current node result is appended, `node_completed` event is written, loop continues. |
| `waiting_for_user` | Runtime state persists and task pauses as `WaitingForInput`. Resume via `POST /api/tasks/:taskId/input`. |
| `waiting_for_approval` | Runtime state persists and task pauses as `WaitingForApproval`. Resume through approval resolution. |
| `child_running` | Task pauses on external dependency while child session/run continues. |
| `blocked` | Task pauses as `Blocked` with `blockReason`. Resume via message/unblock action. |
| `failed` | Task becomes `Failed`; execution session is abandoned. |
| `replan_required` | Task pauses for approval/review with replan context. |
