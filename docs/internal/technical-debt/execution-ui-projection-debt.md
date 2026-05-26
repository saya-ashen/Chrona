# Execution UI Projection Debt

## Status

Open. This document records three related architecture debts in the task plan
execution UI:

- Current operation is inferred in the frontend from graph nodes, checkpoint
  state, task primary actions, and runtime status.
- Dynamic execution data is rendered through scattered ad hoc UI paths, with
  several places flattening typed outputs into strings.
- The task workspace page loads overlapping task, plan, and execution state
  through multiple independent APIs, then decides in the frontend which queries
  to refresh for each event.

These issues make UI changes fragile because the frontend owns execution
semantics that should be projected by the execution layer.

## Problem 1: Current Operation Is Frontend-Inferred

The current operation shown in the task workspace is not a single backend fact.
It is assembled from multiple frontend functions:

- `taskPlanReadModelToGraphPlan()` and `toPlanNode()` in
  `apps/web/src/components/tasks/plan/task-plan-view-model.ts` map runtime node
  statuses into web graph statuses, interaction types, actions, and fields.
- `withCanonicalExecutionActions()` in
  `apps/web/src/components/tasks/workspace/hooks/use-task-workspace-plan-state.ts`
  overlays `/execution/current` checkpoint actions and forms onto graph nodes.
- `pickWorkspaceCurrentNode()` in
  `apps/web/src/components/tasks/workspace/model/task-workspace-query.ts`
  chooses a current node from selected node, `currentStepId`, active nodes,
  attention nodes, ready nodes, or the first node.
- `TaskWorkspacePlanSection` in
  `apps/web/src/components/tasks/workspace/sections/task-workspace-plan-section.tsx`
  decides whether to show `Current node action` or `No current operation`.

The backend already exposes `GET /api/tasks/:taskId/execution/current`, which
returns `currentNodeId`, `checkpoint`, `waitingNodeIds`, and `blockedNodeIds`.
However, it does not return a render-ready current operation projection, so the
frontend repeats execution selection and operation inference.

### Recommended Direction

Extend `PlanExecutionResult` with a backend-projected `currentOperation` field
instead of adding a separate standalone API as the default path.

Suggested contract shape:

```ts
export type CurrentOperation = {
  nodeId: string | null;
  status:
    | "none"
    | "ready"
    | "running"
    | "waiting"
    | "requires_input"
    | "requires_approval"
    | "blocked"
    | "failed"
    | "degraded"
    | "completed";
  runtimeStatus?: NodeRuntimeStatus;
  operationType:
    | "none"
    | "execute"
    | "observe"
    | "wait"
    | "input"
    | "approve"
    | "confirm"
    | "choose"
    | "edit"
    | "retry"
    | "recover";
  title: string;
  description: string;
  checkpoint: ExecutionCheckpoint | null;
  availableActions: CheckpointAction[];
  inputFields: CheckpointForm["inputFields"];
  disabledReason?: string;
  reason?: string;
};
```

Then extend:

```ts
export type PlanExecutionResult = {
  taskId: string;
  planId: string | null;
  mainSessionId: string | null;
  status: PlanExecutionStatus;
  currentNodeId: string | null;
  executedNodeIds: string[];
  waitingNodeIds: string[];
  blockedNodeIds: string[];
  message: string;
  checkpoint: ExecutionCheckpoint | null;
  currentOperation: CurrentOperation;
  errorDetails?: unknown;
};
```

Recommended implementation locations:

- Contract: `packages/contracts/src/plan-runtime/execution-state.ts`
- Projection: `packages/engine/src/modules/plan-execution/projection/`
- Response assembly:
  `packages/engine/src/modules/plan-execution/projection/execution-response.ts`
- Current execution use case:
  `packages/engine/src/modules/plan-execution/use-cases/get-current-execution.ts`
- Route remains:
  `apps/server/src/routes/tasks/execution.routes.ts`

Frontend migration path:

1. Read `currentExecution.currentOperation` in the task workspace.
2. Keep a temporary fallback to existing frontend inference for older responses.
3. Replace `shouldShowCurrentOperation`, `hasCurrentOperationControls`, and the
   current-operation-specific use of `pickWorkspaceCurrentNode()` with the
   backend projection.
4. Keep graph view-model logic for visual graph rendering only.

## Problem 2: Dynamic Execution Data Lacks A Data-To-UI Layer

Execution results and artifacts are dynamic. The UI cannot know every display
shape while authoring static components.

Chrona already has typed node outputs:

```ts
export type NodeResultOutput =
  | { kind: "text"; content: string; title?: string }
  | { kind: "markdown"; content: string; title?: string }
  | { kind: "json"; value: unknown; title?: string }
  | { kind: "file"; path: string; title?: string; language?: string; description?: string }
  | { kind: "artifact"; artifactId: string; title: string; description?: string }
  | { kind: "command"; command: string; title?: string; exitCode?: number; stdout?: string; stderr?: string }
  | { kind: "link"; href: string; title: string; description?: string };
```

`ResultOutputCard()` in
`apps/web/src/components/tasks/plan/task-plan-graph/inspector-run-panel.tsx`
already renders this union. Other workspace paths still stringify or flatten
outputs, for example `stringifyNodeResultOutput()`, `nodeResultContent()`, and
`buildArtifactItems()` in
`apps/web/src/components/tasks/workspace/model/task-workspace-query.ts`.

That loses type information for artifacts, links, commands, JSON, and future
output kinds.

### Recommended Direction

Create a typed dynamic content projection and renderer. Do not build an
unbounded generic JSON renderer.

Suggested contract:

```ts
export type DynamicContentBlock =
  | { kind: "text"; title?: string; content: string; tone?: "default" | "muted" | "success" | "warning" | "danger" }
  | { kind: "markdown"; title?: string; content: string }
  | { kind: "json"; title?: string; value: unknown; collapsed?: boolean }
  | { kind: "key_value"; title?: string; items: Array<{ label: string; value: string | number | boolean | null }> }
  | { kind: "table"; title?: string; columns: Array<{ key: string; label: string }>; rows: Array<Record<string, string | number | boolean | null>> }
  | { kind: "code"; title?: string; language?: string; content: string }
  | { kind: "command"; title?: string; command: string; exitCode?: number; stdout?: string; stderr?: string }
  | { kind: "file"; title?: string; path: string; language?: string; description?: string }
  | { kind: "artifact"; artifactId: string; title: string; type?: string; description?: string; preview?: DynamicContentBlock[] }
  | { kind: "link"; href: string; title: string; description?: string }
  | { kind: "callout"; title?: string; content: string; tone: "info" | "success" | "warning" | "danger" };
```

Suggested architecture:

1. Contract layer:
   `packages/contracts/src/ui/dynamic-content.ts`
2. Projection helpers:
   `packages/domain/src/dynamic-content/`
3. React renderer:
   `apps/web/src/components/dynamic-content/`

The renderer should accept controlled blocks:

```tsx
<DynamicContent blocks={blocks} density="compact" context="node-result" />
```

Keep page shells product-specific. Use dynamic content only for payload-like
content blocks such as results, artifacts, evidence, command output, tool
output, checkpoint instructions, and current operation details.

### Migration Path

1. Extract a shared `DynamicContent` renderer from the existing
   `ResultOutputCard()` behavior.
2. Support the current `NodeResultOutput` kinds first: `text`, `markdown`,
   `json`, `file`, `artifact`, `command`, and `link`.
3. Replace workspace result and artifact stringification paths with blocks.
4. Add `contentBlocks?: DynamicContentBlock[]` to workspace cards while keeping
   existing `content?: string` during migration.
5. When `currentOperation` is backend-projected, include content/result/evidence
   blocks there too.

## Design Constraints

- Render only whitelisted block kinds.
- Do not render arbitrary HTML.
- Markdown must use the existing safe markdown renderer.
- JSON rendering must cap depth and size.
- Command output must be collapsible or height-limited.
- Artifact previews should lazy-load large content instead of eagerly embedding
  large payloads.
- The dynamic renderer should support compact and full display density.
- Business/execution semantics stay in backend or domain projections; React
  components render typed blocks only.

## Problem 3: Workspace Page Uses Too Many Overlapping APIs

The task workspace page currently composes its state from several independent
endpoints instead of a single workspace projection.

Main workspace paths currently used by the page:

```text
GET  /api/tasks/:taskId
GET  /api/tasks/:taskId/plan
GET  /api/tasks/:taskId/execution/current
POST /api/work/:taskId/commands
GET  /api/work/:taskId/events
GET  /api/tasks/:taskId/nodes/:nodeId/activity?limit=100
```

Current frontend entry points:

- `fetchTaskWorkspacePage()` in
  `apps/web/src/components/tasks/workspace/model/task-workspace-query.ts`
  calls `GET /api/tasks/:taskId` for the page snapshot.
- `fetchTaskPlanState()` in the same file calls `GET /api/tasks/:taskId/plan`
  for plan state.
- `fetchCurrentTaskExecution()` in the same file calls
  `GET /api/tasks/:taskId/execution/current` for current execution and
  checkpoint state.
- `dispatchWorkspaceCommand()` in
  `apps/web/src/components/tasks/workspace/hooks/use-task-workspace-plan-state.ts`
  calls `POST /api/work/:taskId/commands` for plan generate and plan accept.
- `dispatchTaskExecutionAction()` and `submitTaskCheckpointAction()` in
  `task-workspace-query.ts` also call `POST /api/work/:taskId/commands` for
  execution actions and checkpoint actions.
- `useTaskWorkspaceEventStream()` in
  `apps/web/src/components/tasks/workspace/hooks/use-task-workspace-page-state.ts`
  calls `GET /api/work/:taskId/events` for workspace SSE events.
- `loadNodeWorkspaceActivityPage()` in
  `apps/web/src/components/tasks/workspace/model/task-workspace-actions.ts`
  calls `GET /api/tasks/:taskId/nodes/:nodeId/activity` when the node detail
  drawer is open.

Server routes involved:

- `apps/server/src/routes/tasks/crud.routes.ts` owns `GET /api/tasks/:taskId`
  and activity endpoints.
- `apps/server/src/routes/tasks/plan.routes.ts` owns
  `GET /api/tasks/:taskId/plan`.
- `apps/server/src/routes/tasks/execution.routes.ts` owns
  `GET /api/tasks/:taskId/execution/current` and older execution action SSE
  endpoints.
- `apps/server/src/routes/pages/work.routes.ts` owns
  `POST /api/work/:taskId/commands` and `GET /api/work/:taskId/events`.

This creates repeated state boundaries:

- `GET /api/tasks/:taskId` already includes task execution summary, saved plan,
  latest run summary, and artifacts.
- `GET /api/tasks/:taskId/plan` repeats plan status and saved plan state.
- `GET /api/tasks/:taskId/execution/current` repeats execution current node and
  checkpoint state.
- SSE events do not carry a canonical projection update, so the frontend must
  decide whether to refetch page, plan state, current execution, or several of
  them.
- Current operation inference spans `pageData`, `planState`,
  `currentExecution`, `graphPlan`, and latest workspace events.

### Recommended Direction

Move the task workspace page to a small set of workspace-specific APIs grouped
by query, command, event, and lazy detail.

Recommended steady-state API set:

```text
GET  /api/work/:taskId
POST /api/work/:taskId/commands
GET  /api/work/:taskId/events
GET  /api/work/:taskId/activity?cursor=&limit=
GET  /api/work/:taskId/nodes/:nodeId/activity?cursor=&limit=
GET  /api/work/:taskId/artifacts/:artifactId
GET  /api/work/:taskId/results/:resultId
```

The page should use only these on the main workspace path:

- `GET /api/work/:taskId` as the only first-screen query.
- `POST /api/work/:taskId/commands` as the only user command entry point.
- `GET /api/work/:taskId/events` as the only state-change stream.
- Lazy detail endpoints only when opening activity, artifact, result, or large
  output views.

Existing task, plan, and execution APIs may remain for compatibility, tests,
debugging, or external callers, but the workspace page should not directly
depend on them.

### Workspace Projection Contract

`GET /api/work/:taskId` should return a render-oriented workspace projection,
not raw task, plan, and execution subdomain records stitched together in React.

Suggested shape:

```ts
export type TaskWorkspaceProjection = {
  task: TaskWorkspaceTask;
  plan: TaskWorkspacePlan | null;
  execution: TaskWorkspaceExecution;
  currentOperation: CurrentOperation;
  overview: TaskWorkspaceOverview;
  commandCenter: CommandCenterProjection;
  artifacts: WorkspaceArtifactSummary[];
  permissions: WorkspacePermissions;
  activityPreview?: WorkspaceActivityPreview;
  updatedAt: string;
  version: number;
};
```

The projection should include the data the workspace needs to render its shell:

- Task identity, title, status, priority, and permission treatment.
- Accepted or draft plan display state.
- Execution summary and current execution status.
- Backend-projected `currentOperation`.
- Command center primary action and disabled reasons.
- Artifact summaries and lightweight latest result summaries.
- Optional activity preview, with full activity kept behind pagination.
- `version` or monotonic revision to connect SSE events to projection refreshes.

### Workspace Command Contract

Keep `POST /api/work/:taskId/commands` as the only workspace command entry
point. The response should stay an acknowledgement, not the final state.

Suggested command union:

```ts
export type WorkspaceCommand =
  | { type: "plan.generate"; userInstruction?: string; forceRefresh?: boolean }
  | { type: "plan.accept"; planId: string }
  | { type: "execution.action"; action: ExecutionActionInput["action"]; payload?: unknown; idempotencyKey?: string }
  | { type: "checkpoint.action"; checkpointId: string; action: CheckpointActionKind; payload?: unknown; idempotencyKey?: string }
  | { type: "task.complete" }
  | { type: "task.reopen" }
  | { type: "artifact.refresh"; artifactId: string };

export type WorkspaceCommandAck = {
  commandId: string;
  taskId: string;
  acceptedAt: string;
};
```

Final state should be observed through workspace events and projection refreshes.

### Workspace Event Contract

Keep `GET /api/work/:taskId/events`, but make projection invalidation explicit.

Suggested event union:

```ts
export type WorkspaceEvent =
  | {
      type: "workspace.projection.updated";
      taskId: string;
      version: number;
      changed: Array<"task" | "plan" | "execution" | "operation" | "artifacts" | "activity">;
    }
  | {
      type: "command.accepted" | "command.failed" | "command.completed";
      commandId: string;
      commandType: string;
      message?: string;
    }
  | {
      type: "execution.runtime_event";
      eventKind: string;
      summary?: string;
    }
  | {
      type: "plan.generation.event";
      eventKind: string;
      summary?: string;
    };
```

With this shape, the frontend does not need event-specific query invalidation
logic. On `workspace.projection.updated`, it refreshes only:

```text
GET /api/work/:taskId
```

Runtime and generation events can still update transient activity text while the
canonical projection catches up.

### APIs The Workspace Page Should Stop Using Directly

These can remain available, but should not be the task workspace page's primary
data source:

```text
GET  /api/tasks/:taskId
GET  /api/tasks/:taskId/plan
GET  /api/tasks/:taskId/execution/current
POST /api/tasks/:taskId/execution/actions
POST /api/tasks/:taskId/execution/checkpoint/:checkpointId/actions
```

Reasons:

- `GET /api/tasks/:taskId` is a task detail endpoint, not a workspace
  projection.
- `GET /api/tasks/:taskId/plan` exposes plan subsystem state directly to the
  page.
- `GET /api/tasks/:taskId/execution/current` forces the page to combine current
  execution with plan graph state to derive the current operation.
- Execution action SSE endpoints overlap with the workspace command bus.
- The workspace page needs display-ready workspace state, not raw subdomain
  state from several APIs.

### Migration Path

1. Extend the existing `GET /api/work/:taskId` response to include plan,
   execution, `currentOperation`, command center, artifact summaries, and
   dynamic content blocks.
2. Add `workspace.projection.updated` events from command handling,
   execution state changes, checkpoint results, plan generation completion, and
   artifact changes.
3. Change `useTaskWorkspacePageState()` to treat `GET /api/work/:taskId` as the
   only canonical page query.
4. Replace `planStateQuery` and `currentExecutionQuery` in
   `useTaskWorkspacePlanState()` with fields from the workspace projection.
5. Keep lazy detail queries for node activity, task activity, artifacts, and
   large results.
6. Remove workspace-page direct dependencies on `/api/tasks/:taskId/plan` and
   `/api/tasks/:taskId/execution/current` after parity is covered by tests.

The intended flow becomes:

```text
Workspace page mounts
-> GET /api/work/:taskId
-> render TaskWorkspaceProjection

User acts
-> POST /api/work/:taskId/commands
-> receive command ack

State changes
-> GET /api/work/:taskId/events emits workspace.projection.updated
-> refetch GET /api/work/:taskId

Heavy detail opens
-> lazy load activity, artifact, or result detail API
```

## Outcome Target

The target architecture is:

```text
Execution, artifact, and result data
-> typed backend/domain projection
-> DynamicContentBlock[]
-> shared DynamicContent renderer
-> page-specific Chrona shell/layout
```

This keeps execution semantics centralized while still allowing flexible display
of dynamic AI/runtime outputs.
