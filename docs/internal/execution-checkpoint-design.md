# Execution Checkpoint Design

## Purpose

This document defines the target design for Chrona plan execution checkpoints.
It combines two related decisions:

1. Node execution should pause through a unified `ExecutionCheckpoint` layer before
   exposing user/system recovery actions.
2. Resolving a checkpoint must not always mean running the next node. The engine
   must route each checkpoint action to an explicit post-checkpoint transition.

This design intentionally excludes child task waiting. Child-task checkpoints can
be added later as a new checkpoint kind and wait kind.

## Problem

Current execution has several pause/recovery concepts spread across runtime
results, wait kinds, pause reasons, block reasons, approval metadata, and route
actions.

The underlying runtime already supports important commands such as:

- `resume_with_input`
- `resume_with_approval`
- `resume_after_unblock`
- `retry_node`
- `cancel_session`
- `apply_mutation`
- `sync_external_result`

However, the product-level concept is missing: a single checkpoint object that
explains why execution paused, what the user/system can do, and how the engine
will translate that action into the next transition.

Without this layer, the frontend or route handlers can easily start guessing
business logic from low-level state names, such as treating reject as blocked,
retry as continue, or replan as approval feedback.

## Design Principles

1. `graph-runtime` remains the pure execution kernel.
2. `engine` owns business state, checkpoint derivation, available actions, and
   action routing.
3. `domain` derives read models only.
4. `web` renders checkpoint data and submits selected actions. It must not infer
   execution semantics from raw statuses.
5. A checkpoint is not only a gate before the next node. It is a decision point.
6. `approve`, `reject`, `retry`, `resume`, `replan`, `abort`, and `manual fix`
   are distinct product actions.
7. Failed execution must not be silently converted to blocked execution.
8. Blocked means execution is stuck and needs recovery. Failed means execution
   failed and needs retry, replan, or termination.

## Layer Boundaries

### `packages/graph-runtime`

Responsibilities:

- Execute ready graph nodes.
- Append attempts and node results.
- Resolve effective graph state.
- Return low-level `GraphDispatchOutcome`.
- Execute runtime commands requested by engine.

Non-responsibilities:

- Do not decide task status.
- Do not decide frontend actions.
- Do not create product recovery flows.
- Do not decide whether reject means retry, replan, or stay paused.

### `packages/engine`

Responsibilities:

- Interpret `GraphDispatchOutcome`.
- Create and persist `ExecutionCheckpoint`.
- Decide task/session/run/graph statuses.
- Expose `availableActions` for frontend/API.
- Route checkpoint actions to `PostCheckpointTransition`.
- Convert transitions into graph runtime commands or terminal updates.

Target files:

- `packages/engine/src/modules/plan-execution/execution-state-machine.ts`
- `packages/engine/src/modules/plan-execution/execution-checkpoint.ts`
- `packages/engine/src/modules/plan-execution/execution-actions.ts`
- `packages/engine/src/modules/plan-execution/task-plan-execution.ts`

### `packages/domain`

Responsibilities:

- Derive read-model state from persisted task/session/run/checkpoint data.
- Keep UI-facing projections stable and explicit.

Non-responsibilities:

- Do not infer missing actions.
- Do not implement business transitions.

### `apps/web`

Responsibilities:

- Render checkpoint message, form, and available actions.
- Submit selected action with payload.
- Avoid guessing runtime commands from status strings.

## Execution Flow

Target flow:

```text
start/resume execution
  -> graph-runtime executes node
  -> node returns result
  -> graph-runtime resolves effective graph
  -> engine derives checkpoint or continue decision
  -> if no checkpoint: continue next ready node
  -> if checkpoint: persist checkpoint and expose available actions
  -> user/system submits checkpoint action
  -> engine resolves action into post-checkpoint transition
  -> engine dispatches runtime command, applies mutation, stays paused, or terminates
```

This replaces the oversimplified mental model:

```text
node result -> checkpoint -> next node
```

with:

```text
node result -> checkpoint -> action -> transition -> next step
```

## ExecutionCheckpoint

`ExecutionCheckpoint` is the product-level pause/recovery object.

Recommended shape:

```ts
export type ExecutionCheckpointKind =
  | "user_input"
  | "approval"
  | "review"
  | "replan_required"
  | "blocked"
  | "failed"
  | "manual_recovery"
  | "external_dependency";

export type ExecutionCheckpoint = {
  id: string;
  taskId: string;
  sessionId: string;
  planRunId: string;
  nodeId: string | null;
  kind: ExecutionCheckpointKind;
  title: string;
  message: string;
  severity: "info" | "warning" | "error";
  form?: CheckpointForm;
  availableActions: CheckpointAction[];
  createdAt: string;
};
```

`form` is optional. Not every checkpoint is a form checkpoint.

Examples:

- User input checkpoint has a form.
- Approval checkpoint may have comment fields.
- Blocked checkpoint may only show instructions and retry action.
- Failed checkpoint may show retry, replan, or abort actions.
- Replan checkpoint may show plan revision actions.

## CheckpointAction

`CheckpointAction` is the product action shown to the user or available to a
system actor.

Recommended shape:

```ts
export type CheckpointActionKind =
  | "submit_input"
  | "approve_result"
  | "reject_result"
  | "request_changes"
  | "request_replan"
  | "accept_replan"
  | "reject_replan"
  | "retry_node"
  | "resume_after_unblock"
  | "mark_node_completed"
  | "mark_node_skipped"
  | "cancel_session"
  | "fail_task";

export type CheckpointAction = {
  id: CheckpointActionKind;
  label: string;
  style: "primary" | "secondary" | "danger";
  requiresPayload?: boolean;
  payloadSchema?: unknown;
};
```

The frontend submits a checkpoint action. It does not submit a graph runtime
command directly.

## PostCheckpointTransition

`PostCheckpointTransition` is the engine-owned decision about what happens after
an action is accepted.

Recommended shape:

```ts
export type PostCheckpointTransition =
  | { type: "continue_next_ready" }
  | { type: "resume_current_node"; input?: unknown }
  | { type: "rerun_current_node"; input?: unknown }
  | { type: "stay_paused"; reason: string }
  | { type: "apply_graph_mutation"; mutationId: string }
  | { type: "mark_current_completed"; output?: unknown }
  | { type: "mark_current_skipped"; reason?: string }
  | { type: "fail_task"; reason: string }
  | { type: "cancel_session"; reason?: string };
```

This is the missing router between product actions and runtime commands.

## Checkpoint Categories

### User Input

Meaning:

- Current node needs user-provided data.
- This is a normal pause, not a failure.

State:

- `PlanExecutionStatus`: `waiting_for_user`
- `TaskStatus`: `WaitingForInput`
- `pauseReason`: `user_input`

Typical action:

- `submit_input`

Typical transition:

```text
submit_input -> resume_current_node -> resume_with_input
```

### Approval Or Review

Meaning:

- Current node produced a result that requires review.
- Rejecting the result is not automatically blocked or failed.

State:

- `PlanExecutionStatus`: `waiting_for_approval`
- `TaskStatus`: `WaitingForApproval`
- `pauseReason`: `approval` or `review`

Typical actions:

- `approve_result`
- `reject_result`
- `request_changes`
- `request_replan`
- `cancel_session`

Typical transitions:

```text
approve_result -> continue_next_ready -> resume_with_approval(approve)
reject_result -> stay_paused
request_changes -> rerun_current_node or stay_paused
request_replan -> stay_paused and create replan request
cancel_session -> cancel_session
```

Important rule:

- `reject_result` means “do not accept this result”.
- It does not mean “node failed”.
- It does not mean “system blocked”.

### Replan Required

Meaning:

- Current plan structure is no longer adequate.
- The next step is a replan workflow, not normal continuation.

State:

- `PlanExecutionStatus`: `waiting_for_approval`
- `TaskStatus`: `WaitingForApproval`
- `pauseReason`: `replan_required`

Typical actions:

- `request_replan`
- `accept_replan`
- `reject_replan`
- `cancel_session`

Target workflow:

```text
replan_required checkpoint
  -> request_replan
  -> generate candidate plan revision
  -> user accepts or rejects revision
  -> accept_replan applies graph mutation
  -> resolve effective graph
  -> continue_next_ready or stay_paused
```

Important rule:

- Replan is not ordinary approval feedback.
- Replan should become a first-class workflow and action family.

### Blocked

Meaning:

- Execution cannot proceed until an external/manual/system issue is fixed.
- Blocked is recoverable but not necessarily a node execution failure.

Examples:

- Missing credential.
- Provider unavailable.
- Required external resource is missing.
- Manual external setup is required.
- Capability is unavailable.

State:

- `PlanExecutionStatus`: `blocked`
- `TaskStatus`: `Blocked`
- `pauseReason`: `manual_action`, `external_dependency`, or `capability_unavailable`

Typical actions:

- `resume_after_unblock`
- `retry_node`
- `request_replan`
- `cancel_session`

Typical transitions:

```text
resume_after_unblock -> rerun_current_node or resume_current_node
retry_node -> rerun_current_node
request_replan -> stay_paused and create replan request
cancel_session -> cancel_session
```

Important rule:

- Resolving a blocked checkpoint should usually re-check or rerun the current
  node. It should not blindly continue to the next ready node.

### Failed

Meaning:

- Node execution failed.
- The task should not continue automatically.

State:

- `PlanExecutionStatus`: `failed`
- `TaskStatus`: `Failed`
- `pauseReason`: usually `manual_action`

Typical actions:

- `retry_node`
- `request_replan`
- `fail_task`
- `cancel_session`

Typical transitions:

```text
retry_node -> rerun_current_node
request_replan -> stay_paused and create replan request
fail_task -> fail_task
cancel_session -> cancel_session
```

Important rule:

- Failed must not auto-continue.
- Failed must not be collapsed into blocked.
- Retry is explicit and targets the same node.

### Manual Node Completion

Meaning:

- User manually completes or skips a node.

Typical actions:

- `mark_node_completed`
- `mark_node_skipped`

Typical transitions:

```text
mark_node_completed -> mark_current_completed -> continue_next_ready
mark_node_skipped -> mark_current_skipped -> resolve graph
```

## Action Routing Table

| Checkpoint kind | Action | Transition | Runtime command |
|---|---|---|---|
| `user_input` | `submit_input` | `resume_current_node` | `resume_with_input` |
| `approval` | `approve_result` | `continue_next_ready` | `resume_with_approval(approve)` |
| `approval` | `reject_result` | `stay_paused` | none or `resume_with_approval(reject)` if persisted review result is needed |
| `approval` | `request_changes` | `rerun_current_node` or `stay_paused` | `retry_node` or review update |
| `review` | `approve_result` | `continue_next_ready` | `resume_with_approval(approve)` |
| `review` | `request_changes` | `rerun_current_node` | `retry_node` |
| `replan_required` | `request_replan` | `stay_paused` | none; create replan request |
| `replan_required` | `accept_replan` | `apply_graph_mutation` | `apply_mutation` |
| `replan_required` | `reject_replan` | `stay_paused` | none |
| `blocked` | `resume_after_unblock` | `rerun_current_node` or `resume_current_node` | `resume_after_unblock` |
| `blocked` | `retry_node` | `rerun_current_node` | `retry_node` |
| `blocked` | `request_replan` | `stay_paused` | none; create replan request |
| `failed` | `retry_node` | `rerun_current_node` | `retry_node` |
| `failed` | `request_replan` | `stay_paused` | none; create replan request |
| `failed` | `fail_task` | `fail_task` | none; persist terminal failure |
| any | `cancel_session` | `cancel_session` | `cancel_session` |

## Runtime Command Mapping

The engine should be the only layer that maps checkpoint transitions to runtime
commands.

Recommended mapping:

```text
resume_current_node -> resume_with_input or resume_after_unblock
rerun_current_node -> retry_node
continue_next_ready -> resume_with_approval(approve) or continue execution loop
apply_graph_mutation -> apply_mutation
cancel_session -> cancel_session
stay_paused -> no runtime command
fail_task -> no runtime command; persist terminal failure
```

The exact runtime command may depend on checkpoint kind and action payload.

## Persistence Model

Recommended short-term approach:

- Store current checkpoint in execution session read model or plan run metadata.
- Include checkpoint in task execution API responses.
- Keep existing event log as source of timeline history.

Recommended long-term approach:

- Add a dedicated checkpoint table if multiple active/historical checkpoints need
  querying, auditing, or collaborative resolution.

Potential table shape:

```text
ExecutionCheckpoint
  id
  taskId
  sessionId
  planRunId
  nodeId
  kind
  status: active | resolved | cancelled
  message
  formJson
  availableActionsJson
  selectedActionJson
  resolvedAt
  createdAt
  updatedAt
```

## API Contract

Task execution responses should expose the current checkpoint:

```ts
type PlanExecutionResult = {
  status: PlanExecutionStatus;
  taskStatus: TaskExecutionAggregateStatus;
  currentNodeId?: string;
  checkpoint?: ExecutionCheckpoint;
};
```

Checkpoint action endpoint:

```text
POST /api/tasks/:taskId/execution/checkpoint/:checkpointId/actions
```

Request:

```ts
type SubmitCheckpointActionInput = {
  action: CheckpointActionKind;
  payload?: unknown;
};
```

Response:

```ts
type SubmitCheckpointActionResult = {
  transition: PostCheckpointTransition;
  execution: PlanExecutionResult;
};
```

Existing execution actions can remain internally, but frontend should move toward
checkpoint actions as the public product API.

## Frontend Contract

The frontend should render from `checkpoint`:

- `checkpoint.title`
- `checkpoint.message`
- `checkpoint.form`
- `checkpoint.availableActions`

The frontend should not infer action availability from:

- raw `TaskStatus`
- raw `PlanExecutionStatus`
- `pauseReason`
- `blockReason.blockType`

Those fields can still support display, filtering, and badges, but action
eligibility comes from `availableActions`.

## Replan Workflow

Replan should be first-class.

Target flow:

```text
node returns replan_required
  -> engine creates replan_required checkpoint
  -> user/system requests replan
  -> plan module generates candidate plan revision
  -> checkpoint exposes accept_replan / reject_replan
  -> accept_replan creates graph mutation
  -> engine dispatches apply_mutation
  -> graph-runtime resolves effective graph
  -> engine either continues or creates next checkpoint
```

Rules:

- `replan_required` is a checkpoint kind and wait kind.
- Replan is not just approval feedback.
- Applying a replan should invalidate or replace affected downstream nodes
  explicitly.
- Rejecting a replan should keep the execution paused and expose next actions.

## Reject Semantics

Reject needs explicit semantics.

Recommended behavior:

- `reject_result` means current output is not accepted.
- It should not mark task failed.
- It should not mark node blocked.
- It should keep execution paused unless paired with a concrete next action.

Follow-up actions after reject:

- request changes
- retry node
- request replan
- cancel session

This keeps rejection as a review decision, not a runtime failure.

## Retry Semantics

Retry always targets the current node.

Rules:

- `retry_node` reruns the current failed/blocked/reviewed node.
- It does not continue to the next ready node.
- Retry should respect retry policy and attempt limits.
- Retry should record attempt history.

## Blocked Fix Semantics

Blocked fix is usually external.

Examples:

- User adds missing credential.
- User enables provider.
- User manually creates required external resource.
- User fixes permissions outside Chrona.

After the user says the issue is fixed:

```text
resume_after_unblock -> rerun_current_node or resume_current_node
```

The engine should not assume the next node is safe to run until the current node
has been retried or revalidated.

## Implementation Plan

### Phase 1: Contract And Types

1. Add `ExecutionCheckpoint`, `CheckpointAction`, and
   `PostCheckpointTransition` contract types.
2. Add checkpoint/action fields to plan execution result contracts.
3. Keep graph runtime command types separate from checkpoint action types.

### Phase 2: Engine Checkpoint Derivation

1. Add `execution-checkpoint.ts`.
2. Derive checkpoint from `GraphDispatchOutcome`, effective graph, current node,
   wait kind, block reason, failure details, and review metadata.
3. Generate `availableActions` centrally.
4. Persist or expose checkpoint through execution result.

### Phase 3: Engine Action Router

1. Add `execution-actions.ts`.
2. Validate submitted checkpoint action against `availableActions`.
3. Resolve action to `PostCheckpointTransition`.
4. Convert transition to runtime command or terminal persistence update.

### Phase 4: API Integration

1. Add checkpoint action endpoint or adapt existing execution action endpoint to
   accept checkpoint actions.
2. Return checkpoint in task execution result/read model.
3. Update route tests to assert action availability and routing.

### Phase 5: Frontend Integration

1. Render checkpoint panel from API checkpoint payload.
2. Render form only when checkpoint includes form schema.
3. Render actions from `availableActions`.
4. Remove frontend guesses about whether to show approve/retry/replan controls.

### Phase 6: Tests

Add tests for:

- User input checkpoint -> `submit_input` -> `resume_with_input`.
- Approval checkpoint -> `approve_result` -> continue.
- Approval checkpoint -> `reject_result` -> stay paused.
- Review checkpoint -> `request_changes` -> rerun or stay paused.
- Replan checkpoint -> `request_replan` -> candidate revision.
- Replan checkpoint -> `accept_replan` -> `apply_mutation`.
- Blocked checkpoint -> `resume_after_unblock` -> current node rerun/resume.
- Failed checkpoint -> `retry_node` -> current node rerun.
- Failed checkpoint -> `fail_task` -> terminal failure.
- Any checkpoint -> `cancel_session` -> cancelled session.

## Non-Goals

- Do not implement child task waiting in this design pass.
- Do not let frontend infer allowed actions from raw status strings.
- Do not collapse failed into blocked.
- Do not treat reject as failed.
- Do not treat replan as ordinary approval feedback.

## Open Decisions

1. Whether checkpoints need a dedicated database table immediately or can start
   as execution session/read-model metadata.
2. Whether `reject_result` should persist a runtime review result immediately or
   only keep an active checkpoint state.
3. Whether `resume_after_unblock` should always rerun current node or allow
   executor-specific resume behavior.
4. Whether `fail_task` and `cancel_session` should both exist as user-facing
   actions or whether one should be reserved for system/admin flows.
5. How replan candidate revisions should be represented before graph mutation is
   accepted.

## Target Mental Model

The final model should be:

```text
Graph runtime produces outcomes.
Engine creates checkpoints.
Frontend displays checkpoints.
User/system submits checkpoint actions.
Engine routes actions to transitions.
Graph runtime executes commands.
```

This keeps execution deterministic, makes recovery explicit, and prevents UI or
route handlers from becoming hidden state machines.
