# Current API Surfaces

## Purpose

This contract inventory documents the current external API surfaces Chrona exposes for the plan-execution area. It is a brownfield reference, not a target-state redesign.

## API Composition

- **Router entry**: `apps/server/src/routes/api.ts`
- **Primary modules**:
  - `apps/server/src/routes/tasks.routes.ts`
  - `apps/server/src/routes/plans.routes.ts`
  - `apps/server/src/routes/execution.routes.ts`

## Task Contracts

### `GET /tasks`

- Lists tasks for the current workspace/task views.
- Brownfield role: task inventory and top-level planning/execution entry.

### `POST /tasks`

- Creates a task.
- Brownfield role: start of the `Task -> Plan` flow.

### `GET /tasks/:taskId`

- Returns basic task detail.

### `GET /tasks/:taskId/detail`

- Returns richer task detail used by task workspace surfaces.

### `GET /tasks/:taskId/plan-state`

- Returns the current saved plan state for a task.
- Response includes `aiPlanGenerationStatus` and `savedAiPlan` when present.
- Brownfield note: this is the clearest read contract for current plan lifecycle state.

### `GET /tasks/:taskId/subtasks`

- Lists child tasks created under a task.

### `POST /tasks/:taskId/subtasks`

- Creates a child task.
- Brownfield note: plan materialization can create task trees through related flows.

## Plan Contracts

### `POST /ai/generate-task-plan`

- Generates a task plan for a task or ad hoc title/description input.
- Supports JSON and SSE streaming variants.
- Brownfield note: this route is central to the existing Plan Layer.

Request shape used today:

```json
{
  "taskId": "optional-task-id",
  "title": "optional title when taskId is absent",
  "description": "optional description",
  "estimatedMinutes": 60,
  "planningPrompt": "optional refinement prompt",
  "forceRefresh": false
}
```

### `POST /ai/generate-task-plan/stop`

- Stops in-flight plan generation for a task.

### `POST /ai/task-plan/accept`

- Accepts a generated plan for a task.
- Required fields: `taskId`, `planId`

### `POST /ai/batch-apply-plan`

- Applies provided nodes and edges as a draft plan and materializes child tasks.
- Brownfield note: this route performs plan mutation and task materialization in one surface.

### `POST /tasks/:taskId/plan`

- Mutates an existing task plan using operation-based payloads.
- Supported operations in the current brownfield route include add/update/delete/reorder style graph mutations.
- Brownfield note: plan editing is currently pragmatic and graph-oriented rather than a tightly versioned domain contract.

## Schedule Contracts

### `POST /tasks/:taskId/schedule`

- Applies a task-level schedule directly to `Task.scheduledStartAt` and `Task.scheduledEndAt`.

Request shape used today:

```json
{
  "scheduledStartAt": "2026-05-03T09:00:00.000Z",
  "scheduledEndAt": "2026-05-03T10:00:00.000Z",
  "dueAt": "2026-05-04T00:00:00.000Z",
  "scheduleSource": "system"
}
```

### `DELETE /tasks/:taskId/schedule`

- Clears the task-level schedule.

### `POST /tasks/:taskId/schedule/proposals`

- Creates a schedule proposal for a task.
- Brownfield role: AI/manual scheduling suggestion flow before acceptance.

### `POST /schedule/proposals/decision`

- Accepts or rejects a schedule proposal.
- Required fields: `proposalId`, `decision`

## Execution Contracts

### `POST /tasks/:taskId/run`

- Starts accepted-plan execution manually.
- Requires an accepted plan to exist.
- Brownfield note: despite the route name, this can start plan execution rather than only raw provider runs.

### `POST /tasks/:taskId/execution/advance`

- Advances plan execution manually or settles a child run when `runId` is supplied.

### `POST /tasks/:taskId/execution/settle-run`

- Settles a child run back into the accepted plan.

### `POST /tasks/:taskId/retry`

- Retries execution.
- Brownfield note: behavior branches between accepted-plan execution and legacy adapter-driven run retry.

### `POST /tasks/:taskId/input`

- Supplies user input when execution is waiting for input.
- Brownfield note: accepted-plan execution and legacy run flows are both supported here.

### `POST /tasks/:taskId/message`

- Sends an operator message into the current execution context.

### `POST /tasks/:taskId/resume`

- Resumes a runtime run through the adapter surface.

### `POST /tasks/:taskId/result/accept`

- Accepts the current task result.
- Brownfield note: this is task-level result acceptance, not yet a formal plan-step review contract.

### `POST /approvals/:approvalId/resolve`
### `POST /tasks/:taskId/approvals/:approvalId/resolve`

- Resolves runtime approval records.

## Brownfield Contract Gaps

1. The public API exposes task-level schedule windows, not first-class work blocks.
2. The API uses a mix of run language and plan-execution language, which makes canonical execution ownership harder to infer.
3. Plan editing and batch application expose graph-level mutation contracts that are useful today but not yet tightly aligned with a long-term execution domain model.
4. User-facing result review for final deliverables is not yet modeled as a dedicated step-level contract.
5. Backend capability and provider availability are not yet represented as a clear, provider-neutral public contract.

## Recommended Contract Direction

1. Add explicit work-block contracts instead of overloading task scheduling endpoints.
2. Introduce explicit execution-session reads/writes that separate product orchestration state from provider run state.
3. Converge route language around plan execution rather than mixing raw run terminology with orchestrated-step terminology.
4. Add step-result review contracts for accept, reject, and request-changes flows.
5. Preserve backward compatibility intentionally if existing UI surfaces already depend on current route names and payloads.
