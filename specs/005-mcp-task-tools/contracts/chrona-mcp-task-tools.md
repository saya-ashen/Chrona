# Contract: Chrona MCP Task Tools

This contract describes the agent-facing MCP tool surface for Chrona task lifecycle operations. Names are implementation targets; final code may map them onto MCP transport details while preserving operation semantics.

## Common Request Envelope

All tools accept a validated object with shared context fields plus operation-specific fields.

```json
{
  "workspaceId": "workspace_123",
  "taskId": "task_123",
  "sessionId": "agent_session_123",
  "idempotencyKey": "agent-session-123:set-schedule:1",
  "expectedState": {
    "taskStatus": "Ready",
    "planRevision": 3,
    "executionStatus": "WaitingForInput"
  },
  "payload": {}
}
```

## Common Result Envelope

All tools return a Chrona-owned result. This result is authoritative for accepted mutations.

```json
{
  "operationId": "op_123",
  "status": "accepted",
  "reasonCode": null,
  "message": "Execution advanced.",
  "affected": {
    "workspaceId": "workspace_123",
    "taskId": "task_123",
    "planId": "plan_123",
    "executionSessionId": "exec_123"
  },
  "state": {
    "taskStatus": "Running",
    "planRevision": 3,
    "scheduleStatus": "Scheduled",
    "executionStatus": "Running"
  },
  "idempotency": "new",
  "auditRef": "event_123",
  "recovery": null
}
```

## Result Statuses

- `accepted`: Chrona applied the operation and returned current authoritative state.
- `rejected`: Chrona did not apply the operation and returned the reason plus recovery guidance.
- `noop`: Chrona did not change state because the operation was an idempotent replay or already satisfied.

## Reason Codes

- `VALIDATION_ERROR`: Request shape or payload failed the shared contract.
- `UNAUTHORIZED`: Actor cannot operate on the workspace/task.
- `NOT_FOUND`: Target entity does not exist in allowed scope.
- `STALE_STATE`: Expected state or revision does not match current state.
- `INVALID_TRANSITION`: Requested lifecycle change is not valid from current state.
- `CONFLICT`: Another active operation or state constraint conflicts with the request.
- `DUPLICATE_OPERATION`: Idempotency key replayed an existing result.
- `PROVIDER_UNSUPPORTED`: Agent/provider cannot complete the requested tool path.

## Read Tools

### `chrona.task.read`

Returns task details and current lifecycle summary.

**Required fields**: `workspaceId`, `taskId`

**Mutation**: No

### `chrona.plan.read`

Returns accepted/editable plan summary, graph id, revision, and active execution-relevant nodes.

**Required fields**: `workspaceId`, `taskId`

**Mutation**: No

### `chrona.schedule.read`

Returns schedule/work block state and pending proposal summary.

**Required fields**: `workspaceId`, `taskId`

**Mutation**: No

### `chrona.execution.read`

Returns execution session/run state, waiting/blocking info, active node, retryable state, and supported next actions.

**Required fields**: `workspaceId`, `taskId`

**Mutation**: No

## Mutation Tools

### `chrona.task.create`

Creates a task through Chrona validation.

**Required fields**: `workspaceId`, `idempotencyKey`, task payload

**Result**: Created task state or structured rejection.

### `chrona.task.update`

Updates task details or task-level outcome through Chrona validation.

**Required fields**: `workspaceId`, `taskId`, `idempotencyKey`, update payload

**Expected-state support**: task status/revision

### `chrona.plan.mutate`

Applies plan graph changes through Chrona plan mutation rules.

**Required fields**: `workspaceId`, `taskId`, `idempotencyKey`, `reason`, `operations`

**Expected-state support**: `expectedGraphId`, `expectedRevision`

**Existing schema reuse**: `planMutationBodySchema`

### `chrona.schedule.propose`

Creates a schedule proposal from an agent.

**Required fields**: `workspaceId`, `taskId`, `idempotencyKey`, proposal payload

**Existing schema reuse**: `scheduleProposalBodySchema`

### `chrona.schedule.set`

Sets or updates accepted schedule state.

**Required fields**: `workspaceId`, `taskId`, `idempotencyKey`, `scheduledStartAt`, `scheduledEndAt`

**Existing schema reuse**: `scheduleBodySchema`

### `chrona.schedule.clear`

Clears schedule state when Chrona rules permit it.

**Required fields**: `workspaceId`, `taskId`, `idempotencyKey`

### `chrona.execution.dispatch`

Starts, resumes, retries, completes, or cancels execution through the existing execution action model.

**Required fields**: `workspaceId`, `taskId`, `idempotencyKey`, execution action payload

**Expected-state support**: task status, execution status, session id, node id, plan revision

**Existing schema reuse**: `executionActionBodySchema`

## Error And Recovery Contract

Rejected responses must include:

- `reasonCode`
- `message`
- Current relevant state summary
- Expected-vs-actual metadata when stale
- Safe next operation, usually one of the read tools or a corrected mutation

Example stale rejection:

```json
{
  "operationId": "op_124",
  "status": "rejected",
  "reasonCode": "STALE_STATE",
  "message": "Plan revision changed before mutation.",
  "affected": { "taskId": "task_123", "planId": "plan_123" },
  "state": { "planRevision": 4 },
  "idempotency": "new",
  "auditRef": "event_124",
  "recovery": {
    "nextTool": "chrona.plan.read",
    "details": { "expectedRevision": 3, "actualRevision": 4 }
  }
}
```

## Trust Boundary

Only accepted or noop Chrona tool results can mutate or confirm authoritative state. Agent text, provider final structured output, and provider tool traces are evidence unless they are the returned result of a Chrona-owned operation.
