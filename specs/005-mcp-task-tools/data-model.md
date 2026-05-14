# Data Model: MCP Task Tools

## AgentToolOperation

Represents one agent-requested Chrona operation.

**Fields**:

- `operationId`: Chrona-generated identifier for audit and response correlation.
- `operationName`: Stable tool name, such as `chrona.task.read`, `chrona.plan.mutate`, `chrona.schedule.set`, or `chrona.execution.dispatch`.
- `actorType`: `agent`, `human`, or `system`; MCP calls normally use `agent`.
- `actorId`: Agent/runtime/user identifier when known.
- `workspaceId`: Workspace scope for authorization and audit.
- `taskId`: Target task when applicable.
- `sessionId`: Agent or execution session identifier when applicable.
- `idempotencyKey`: Required for mutating tool calls; optional for reads.
- `expectedState`: Optional state guard supplied by the caller.
- `expectedRevision`: Optional revision guard for task, plan, schedule, or execution state.
- `payload`: Operation-specific validated input.
- `receivedAt`: Server timestamp.

**Validation Rules**:

- Mutating operations must include `idempotencyKey` or receive a structured rejection.
- Operation target must be inside the actor's allowed workspace/task scope.
- Expected state/revision must match current authoritative state before mutation.
- Payload must pass the shared Zod contract for the requested operation.

## ChronaToolResult

Trusted structured result returned by Chrona after evaluating an operation.

**Fields**:

- `operationId`: Correlates result to `AgentToolOperation`.
- `status`: `accepted`, `rejected`, or `noop`.
- `reasonCode`: Machine-readable reason for rejection/noop, such as `STALE_STATE`, `INVALID_TRANSITION`, `UNAUTHORIZED`, `VALIDATION_ERROR`, or `DUPLICATE_OPERATION`.
- `message`: Concise human/agent-readable explanation.
- `affected`: Entity identifiers touched or inspected by the operation.
- `state`: Current authoritative state summary after evaluation.
- `idempotency`: `new`, `replayed`, or `not_applicable`.
- `auditRef`: Event/activity/tool-call trace identifier when recorded.
- `recovery`: Safe next action guidance, including read tool names or required expected values.
- `completedAt`: Server timestamp.

**Validation Rules**:

- Rejected results must not include partial state changes.
- Replayed idempotent results must match the original accepted/noop result for that key and target.
- Result `state` must reflect Chrona-owned state, not provider final output.

## Task

Existing user goal or work item.

**Relevant Fields**:

- `id`, `workspaceId`, `title`, `description`, `status`, `priority`.
- `revision` or equivalent freshness marker if added or derived.
- Related plan, schedule, execution session, run, activity, and evidence records.

**State Rules**:

- Agent-created or updated tasks use the same validation as human task flows.
- Invalid lifecycle transitions are rejected without changing task state.
- Task-level outcome changes cannot contradict active execution state.

## Plan

Existing graph or ordered representation of work for a task.

**Relevant Fields**:

- `planId`, `taskId`, `status`, `revision`, `graphId`.
- Node definitions, node layers, edges, mutation reason, created/updated metadata.

**State Rules**:

- Plan mutations require a reason.
- Mutations may use `expectedGraphId` and `expectedRevision` to reject stale edits.
- Accepted changes create authoritative plan state and supersede prior graph revisions according to existing rules.
- Agent-authored complete JSON plans are not authoritative unless applied through Chrona plan tools.

## Schedule

Timing/work block state associated with a task.

**Relevant Fields**:

- `taskId`, `scheduledStartAt`, `scheduledEndAt`, `dueAt`, `status`, `source`.
- Schedule proposal fields when operation proposes rather than sets state.

**State Rules**:

- Schedule set/update/clear operations must pass Chrona scheduling rules.
- Agent schedule operations must record source and actor context.
- Conflicts or stale task state return rejection with current schedule summary.

## ExecutionState

Runtime progress for plan execution.

**Relevant Fields**:

- `taskId`, `sessionId`, `runId`, `status`, active node, waiting/blocking reason, retryable node, current effective plan.
- Existing action names include `start_manual`, `start_scheduled`, `resume_with_input`, `resume_with_approval`, `resume_after_unblock`, `complete_manual_node`, `retry_node`, and `cancel_session`.

**State Rules**:

- Execution dispatch uses existing engine orchestration.
- Actions that do not match current task/session/node state are rejected.
- Agent-facing results summarize the final authoritative execution state even if the human UI path streams intermediate SSE events.

## AgentSessionEvidence

Provider-specific session content retained for observability.

**Fields**:

- `sessionId`, `provider`, `runtime`, `conversation`, `toolCalls`, `toolOutputs`, optional structured output, errors, timestamps.
- Link to `operationId` or `auditRef` when evidence corresponds to a Chrona tool call.

**State Rules**:

- Evidence is never an authoritative mutation by itself.
- Malformed or conflicting provider output is preserved for diagnostics but cannot override accepted tool results.
- Existing provider tool-call traces remain useful for audit and debugging.

## State Transitions

```text
Agent reads current state
  -> Agent submits AgentToolOperation
  -> Chrona validates contract, scope, idempotency, expected state, and lifecycle rules
  -> accepted: Chrona applies one authoritative mutation and records audit/evidence
  -> rejected: Chrona records rejected attempt when appropriate and leaves state unchanged
  -> noop: Chrona returns current state for idempotent replay or already-satisfied operation
  -> Agent uses ChronaToolResult.recovery/state for next operation
```
