# Execution Command Test Gaps

## 背景

2026-05-25 发现一个前端提交 checkpoint 输入后任务没有继续运行的问题。前端实际请求为：

```http
POST /api/work/:taskId/commands
Content-Type: application/json

{
  "type": "checkpoint.action",
  "checkpointId": "plan_a82c97e7:cn_mpkykqpe_1:user_input",
  "action": "submit_input",
  "payload": {
    "inputFields": {
      "location": "北京",
      "script_language": "python",
      "weather_source": "免费公开 API"
    },
    "message": "..."
  }
}
```

数据库里已经记录了 `user_input_received` 和 `resume_with_input`，但图状态仍停在 `WaitingForInput`。根因是 workspace command 路径把 `checkpoint.action` 转成 `resume_with_input` 时，没有把 `payload.inputFields` 传递到 execution action；`CheckpointNodeExecutor` 收不到 `inputFields` 后再次返回 `waiting_for_user`。

已有测试没有发现该问题，因为现有覆盖集中在 engine 直接调用和 `/tasks/:taskId/execution/checkpoint/:checkpointId/actions` SSE 路由，没有覆盖前端真实使用的 `/api/work/:taskId/commands` fire-and-forget 路径及其异步副作用。

## 当前覆盖情况

| 层级 | 代表测试 | 已覆盖内容 | 缺口 |
| --- | --- | --- | --- |
| Graph runtime | `packages/graph-runtime/src/graph-runtime.execution.bun.test.ts` | graph command 分发、节点状态推进、`submit_node_result` | 不覆盖 API DTO 映射、workspace command 异步处理 |
| Engine plan execution | `packages/engine/src/modules/plan-execution/plan-runner.bun.test.ts` | `start_manual`、`resume_with_input`、`submitCheckpointAction` 直接调用 | 不覆盖 server route 的 command body 到 execution action 转换 |
| Engine continuation | `plan-runner.task-executor.continuation.bun.test.ts` | checkpoint 输入后继续下游 provider work | 使用 engine 直接入口，不覆盖 `/api/work/:taskId/commands` |
| Server execution SSE route | `apps/server/src/__tests__/api/plan-execution-module.bun.test.ts` | `/tasks/:taskId/execution/...` 与 checkpoint SSE API | 不覆盖 workspace page command API |
| Server real router smoke | `apps/server/src/__tests__/api/real-router-smoke.bun.test.ts` | 生产 router CRUD/基础 smoke | 不覆盖 task workspace command 写路径 |
| Frontend/E2E | `e2e/specs/task-workspace-*.spec.ts` | 页面打开、布局、assistant surface | 不覆盖真实 checkpoint 表单提交后任务继续运行 |

## 必补测试

### P0. Workspace Command Checkpoint Submit Integration

**目的**：覆盖前端真实调用路径，防止 `payload.inputFields` 在 workspace command 到 execution action 的映射中丢失。

**建议位置**：`apps/server/src/__tests__/api/task-workspace-commands.bun.test.ts`

**路径**：

```text
POST /api/work/:taskId/commands
  -> dispatchWorkspaceCommand
  -> engine.tasks.execution.submitCheckpointAction
  -> checkpoint transition
  -> dispatchExecutionAction(resume_with_input)
  -> graph runtime
```

**测试场景**：

1. 播种一个 accepted plan，入口节点是 `checkpoint` 且 `checkpointType=input`。
2. 通过 execution API 或 engine 直接入口启动任务，使其进入 `WaitingForInput`。
3. 通过 `/api/work/:taskId/commands` 提交 `checkpoint.action submit_input`，请求体必须与前端一致：`payload.inputFields` 嵌套在 payload 中。
4. 等待异步 command 完成。
5. 断言任务不再停留在原 checkpoint。

**必要断言**：

- HTTP 返回 `202`。
- `TaskProjection.persistedStatus` 不再是 `WaitingForInput`，除非下一个节点本身需要输入。
- 原 checkpoint 的旧 result 为 `obsolete`，`waitKind=user_input`。
- 原 checkpoint 的新 result 为 `current`，且包含 `inputFields`。
- `ExecutionSession.currentNodeId` 已清空或指向下一个真实等待/阻塞节点。
- 如果 plan 有下游任务，能观察到下游 `node_started`、provider run 或对应 projected state。
- `Event` 至少包含：`plan_execution.user_input_received`、`plan_execution.node_completed`，以及后续节点事件。

**为什么能抓住本次问题**：如果 `payload.inputFields` 没有传到 execution action，executor 会再次返回 `waiting_for_user`，上述断言会失败。

### P0. Fire-and-Forget Command Side Effect Wait Helper

**目的**：`/api/work/:taskId/commands` 返回 `202` 后，真实执行在后台异步发生。测试不能只断言 response accepted，必须等待副作用。

**建议位置**：`apps/server/src/__tests__/api/helpers/work-command.ts` 或现有 `bun-test-helpers.ts`

**建议工具函数**：

```ts
async function waitForTaskProjection(
  taskId: string,
  predicate: (projection: TaskProjectionRow | null) => boolean,
  options?: { timeoutMs?: number; intervalMs?: number },
): Promise<TaskProjectionRow>
```

或更专用：

```ts
async function waitForWorkspaceCommandEffect(input: {
  taskId: string;
  commandId: string;
  expectedEventType?: string;
  timeoutMs?: number;
}): Promise<void>
```

**必要断言**：

- command accepted event 已发布。
- command result event 已发布。
- projection 或 plan runtime state 到达预期状态。
- timeout 时输出最近 `Event` / `TaskProjection` / `TaskPlanRun.results` 摘要，便于定位 silent failure。

### P0. Workspace Command DTO Mapping Tests

**目的**：锁住 command body 到 execution action 的字段映射，避免 API DTO 改动时丢字段。

**建议位置**：如果将 `dispatchWorkspaceCommand` 拆出可测模块，放在对应 route command mapper 测试；否则通过 API integration 间接覆盖。

**覆盖矩阵**：

| Workspace command | 必须映射到 | 关键字段 |
| --- | --- | --- |
| `checkpoint.action submit_input` | `resume_with_input` | `checkpointId`、`payload.inputFields`、`payload.message` |
| `checkpoint.action retry_node` | `retry_node` | `nodeId`、reason/input |
| `checkpoint.action resume_after_unblock` | `resume_after_unblock` | note/reason |
| `checkpoint.action approve_result` | `resume_with_approval` | decision/feedback |
| `execution.action start_manual` | `start_manual` | prompt/reason/idempotency |
| `execution.action cancel_session` | `cancel_session` | reason/idempotency |

**必要断言**：

- 每个 command 的 nested payload 字段不会丢失。
- unknown payload keys 不影响核心字段。
- 空 payload 走预期 fallback，而不是静默成功后无副作用。

## 应补测试

### P1. Workspace Command Projection Event Contract

**目的**：前端页面依赖 `/api/work/:taskId/events` 的 projection event，而不是 execution SSE route。需要验证 workspace command 触发后，前端能收到足够事件更新页面。

**建议位置**：`apps/server/src/__tests__/api/task-workspace-commands.bun.test.ts`

**场景**：提交 checkpoint input 后订阅或收集 workspace events。

**必要断言**：

- 发布 `command.accepted`。
- 发布 `execution.state.updated`。
- 发布 `checkpoint.result` 或 `execution.result`。
- event payload 包含 `commandId`、`taskId`、`eventKind`。
- 页面刷新 `GET /api/work/:taskId` 能看到与事件一致的状态。

### P1. Command Envelope Actor/Origin/Correlation Contract

**目的**：新增 command envelope 后，应验证不同入口的 actor/origin/correlation 正确，避免事件审计可观测性退化。

**建议位置**：engine plan execution tests 或 server route integration tests。

**覆盖矩阵**：

| 入口 | actor | origin.channel | 关键 correlation |
| --- | --- | --- | --- |
| Web/API manual command | `user` | `api` 或 `web` | `taskId`、`planId`、`executionSessionId` |
| MCP tool command | `agent` | `mcp_tool` | `toolInvocationId`、`nodeAttemptId`、`providerRunId` |
| Provider runtime sync | `system` | `provider_stream` | provider run / runtime run refs |
| Scheduler | `system` | `scheduler` | schedule/run ids |

**必要断言**：

- `Event.payload.command` 存在且为 domain command 类型。
- `Event.payload.actor`、`origin`、`correlation` 与入口一致。
- `RawEventLog.metadata` 或 canonical event payload 保留足够链路信息。

### P1. MCP Terminal Tool Command Integration

**目的**：确保 AI 调用 terminal tool 后，由 MCP tool 入口驱动 graph command，而不是 provider stream 或 audit fallback 决定图状态。

**建议位置**：`packages/engine/src/services/agent-tool-operations.service.bun.test.ts` 或 plan runner integration test。

**场景**：

1. AI condition node 正在运行。
2. MCP tool `chrona.node.condition_select` 接收 `{ branchRef, summary, outputs }`。
3. Tool audit 记录 `RawEventLog`、`ToolInvocation`、`condition.selected`。
4. Graph command `submit_node_result` 写入 selected branch。
5. Provider `run.completed` 返回没有 branchRef 的 stale result。

**必要断言**：

- graph state 使用 command-submitted selectedBranch。
- provider completion 不覆盖 command result。
- 没有 `Condition node ... completed without a structured selectedBranch`。
- audit 与 graph result 通过 `nodeAttemptId`、`providerRunId`、`toolInvocationId` 可关联。

### P1. Async Command Failure Visibility

**目的**：fire-and-forget command 失败时，前端必须能看到失败事件，而不是只有 `202 accepted`。

**场景**：

- 提交已失效 checkpointId。
- 提交无法执行的 action。
- 提交 payload schema 合法但业务字段缺失。

**必要断言**：

- HTTP 仍可返回 `202` 时，必须发布 `command.failed`。
- `command.failed.message` 包含业务错误。
- `GET /api/work/:taskId` 不显示误导性的成功状态。
- 没有写入错误的 graph result。

### P1. Idempotency And Duplicate Workspace Commands

**目的**：前端可能重试 `POST /api/work/:taskId/commands`。需要验证 idempotencyKey 在 workspace command 层和 execution 层一致。

**场景**：同一个 `idempotencyKey` 重复提交 checkpoint input。

**必要断言**：

- 不创建重复 node attempt。
- 不创建重复 current result。
- command event 可重复响应，但 graph state 只推进一次。
- 如果第二次提交 payload 不同，应有明确策略：拒绝、忽略或记录冲突。

## 可补测试

### P2. Browser-Level Checkpoint Submit E2E

**目的**：覆盖真实 React 表单、i18n 字符串、fetch 请求体、SSE/projection 更新。

**建议位置**：`e2e/specs/task-workspace-checkpoint.spec.ts`

**场景**：

1. 创建或导入一个含 input checkpoint 的任务。
2. 打开 `/zh/tasks/:taskId`。
3. 填写 checkpoint 表单。
4. 点击提交。
5. 等待页面显示下一个活动节点或任务完成。

**必要断言**：

- 浏览器实际发出 `/api/work/:taskId/commands`。
- 请求体包含 `payload.inputFields`。
- 页面不再显示同一个 checkpoint 为当前阻塞项。
- 移动端宽度下无水平滚动，提交按钮状态正确。

### P2. Work Page Read Model Consistency

**目的**：验证 command 运行后 `TaskProjection`、`GET /api/work/:taskId`、plan runtime state 三者一致。

**必要断言**：

- `TaskProjection.currentNodeId` 与 effective graph current/waiting node 一致。
- `TaskProjection.persistedStatus` 与 `Task.status` 一致。
- `GET /api/work/:taskId` 返回的 checkpoint 与 runtime state 一致。

### P2. Real Router Negative Smoke For Workspace Commands

**目的**：当前 real router smoke 有基础路由覆盖，但没有 workspace command 写路径。应至少补一个负向 smoke，防止 route schema 或 import cascade 破坏。

**场景**：

- 不存在的 taskId。
- 不存在的 checkpointId。
- malformed command body。

**必要断言**：

- 返回合理 HTTP 状态或 `command.failed`。
- 错误信息不泄露内部堆栈。

## 推荐落地顺序

1. `task-workspace-commands.bun.test.ts`：先覆盖 workspace command checkpoint submit happy path。
2. 增加 `waitForWorkspaceCommandEffect` helper，所有 fire-and-forget command 测试统一使用。
3. 在同一文件补 command failure visibility 和 idempotency。
4. 为 command envelope 增加 actor/origin/correlation 断言。
5. 增加 Playwright checkpoint submit E2E，覆盖真实前端请求体与页面状态。

## 新测试的最低验收标准

新增测试不能只断言 HTTP response。凡是测试 `/api/work/:taskId/commands`，必须至少断言以下三项：

1. command 接受或失败事件已发布。
2. graph runtime state 或 `TaskPlanRun.results` 发生预期变化。
3. `TaskProjection` / `GET /api/work/:taskId` 与 graph state 一致。

如果测试提交 checkpoint input，还必须断言：

1. 旧 `user_input` result 被 `obsolete`。
2. 新 result 包含 `inputFields`。
3. 当前 checkpoint 不再保持为 active waiting node。

## 反模式

- 只测 `202 Accepted`。
- 只测 engine 直接入口，然后假设 server/workspace route 等价。
- 只检查 canonical `Event`，不检查 graph state。
- 只检查 graph state，不检查 `TaskProjection`。
- 在 fire-and-forget command 后立即断言，不等待异步副作用完成。
- 使用与前端不同形状的 payload，例如把 `inputFields` 放在顶层而不是 `payload.inputFields`。
