# Contract: Task Orchestrator

This contract describes the user-visible and service-facing behavior required from the task orchestrator. Exact route names and schema filenames may be finalized during implementation, but the semantics below are mandatory.

## Task Workspace State Contract

Task detail responses MUST expose one authoritative execution state for the workspace.

### Task Execution Summary

```json
{
  "taskId": "task_123",
  "executionState": "running",
  "stateLabel": "Running",
  "stateReason": null,
  "graphVersion": 4,
  "currentNodeId": "node_4",
  "primaryAction": {
    "type": "pause",
    "enabled": true,
    "label": "Pause"
  },
  "progress": {
    "completed": 3,
    "total": 7,
    "percent": 43
  },
  "readiness": {
    "runnable": true,
    "reason": null
  },
  "degraded": null,
  "blocking": null,
  "waiting": null
}
```

### Required Semantics

- `executionState` MUST be the single source for the task's visible state.
- `currentNodeId` MUST point to the running, waiting, blocked, failed, degraded, or next actionable node when one exists.
- `primaryAction` MUST match `executionState` and MUST NOT contradict readiness or block reason.
- `progress` MUST exclude invalidated work and must explain skipped paths through graph node state.
- `readiness.runnable` MUST NOT show a task as ready when it is blocked or degraded.

## Graph Node State Contract

Each node in the effective graph read model MUST expose explicit state.

```json
{
  "id": "node_4",
  "type": "task",
  "status": "running",
  "reachable": true,
  "current": true,
  "requiresAction": false,
  "result": null,
  "stateReason": null,
  "invalidatedByMutationId": null
}
```

### Required Semantics

- Node status values MUST distinguish `pending`, `ready`, `running`, `waiting_for_user`, `waiting_for_approval`, `blocked`, `failed`, `skipped`, `invalidated`, `cancelled`, and `completed`.
- A skipped node MUST remain explainable in the graph if it helps the user understand branch selection.
- An invalidated node MUST identify the mutation that invalidated it.
- A completed node MUST NOT appear downstream of reachable pending prerequisites unless reconciliation has surfaced an inconsistency.

## Scheduler Runtime Operations

The orchestrator MUST provide internal operations with these observable outcomes.

### Process Due Scheduled Work

**Input**: Current time and scheduler owner identity.

**Outcome**:

- Due eligible scheduled work starts once.
- Ineligible work remains scheduled with an explicit reason.
- Duplicate scheduler owners cannot start the same work twice.

### Synchronize Active Runs

**Input**: Stale, active, or degraded external runs.

**Outcome**:

- Terminal runtime results are applied to the owning graph node once.
- Running results keep the task running with a current node.
- Failed or unavailable sync becomes degraded or failed with a recovery action.
- Late results for cancelled or invalidated nodes are recorded without corrupting current state.

### Advance Graph Execution

**Input**: Active execution session and current graph version.

**Outcome**:

- Ready automatic nodes start.
- User waits and approval waits pause with the correct waiting state.
- True blockers pause with a blocker state and reason.
- Completed graphs complete the task.
- Impossible graphs become repaired or recoverable inconsistent states.

### Reconcile Task State

**Input**: Task, graph, sessions, node attempts, external runs, blockers, waits, and mutations.

**Outcome**:

- One authoritative task state is produced.
- Current node, primary action, readiness, progress, and visible reasons align.
- Reconciliation is idempotent.

## Graph Mutation Operations

Runtime graph changes MUST use explicit mutation operations.

### Supported Operations

- Add future node.
- Update future node.
- Remove future node.
- Add edge.
- Remove edge.
- Replace unstarted subgraph.
- Invalidate downstream from node.
- Replan from node.

### Mutation Request

```json
{
  "taskId": "task_123",
  "baseGraphVersion": 4,
  "operation": "replace_subgraph",
  "targetNodeId": "node_5",
  "payload": {},
  "reason": "User refined the task plan"
}
```

### Mutation Response

```json
{
  "mutationId": "mutation_123",
  "status": "applied",
  "graphVersion": 5,
  "affectedNodeIds": ["node_5", "node_6"],
  "invalidatedNodeIds": ["node_7"],
  "executionState": "running",
  "currentNodeId": "node_4"
}
```

### Required Semantics

- Base graph version mismatch MUST reject the mutation.
- Mutating active running work MUST reject unless execution is safely cancelled first.
- Mutation apply MUST be atomic.
- Applied mutation MUST trigger reconciliation.
- Rejected mutation MUST explain why and leave execution state unchanged.

## Recovery Actions

Degraded or inconsistent tasks MUST expose safe recovery actions.

```json
{
  "actions": [
    {
      "type": "retry_sync",
      "enabled": true,
      "label": "Retry sync"
    },
    {
      "type": "cancel_execution",
      "enabled": true,
      "label": "Cancel execution"
    },
    {
      "type": "replan_from_node",
      "enabled": true,
      "label": "Replan from current node"
    }
  ]
}
```

### Required Semantics

- Recovery actions MUST be available when the scheduler cannot repair automatically.
- Recovery actions MUST not erase execution history.
- A successful recovery action MUST trigger reconciliation and update the task workspace state.

## Event and History Contract

Scheduler-visible events MUST be available for diagnostics and tests.

### Event Types

- `scheduled_work_started`
- `external_run_synced`
- `graph_advanced`
- `execution_paused`
- `execution_completed`
- `execution_failed`
- `execution_cancelled`
- `task_reconciled`
- `graph_mutation_applied`
- `graph_mutation_rejected`
- `degraded_retry_scheduled`
- `inconsistency_detected`
- `inconsistency_repaired`

### Required Semantics

- Events MUST include task identity, graph version, timestamp, and reason.
- Events MUST not contain secrets or raw provider credentials.
- Events MUST be sufficient to explain what the scheduler did during a user-visible state transition.
