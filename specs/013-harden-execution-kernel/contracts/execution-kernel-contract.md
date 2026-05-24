# Contract: Execution Kernel

This contract describes the behavior Chrona must expose across execution entry points after the execution kernel hardening feature.

## Execution Entry Contract

All execution entry points share the same contract:

```text
Input:
  taskId
  taskPlanRunId
  action
  source
  optional nodeId
  optional nodeAttemptId
  optional providerRunRef
  optional payload

Behavior:
  1. Acquire or validate execution ownership for the task plan run.
  2. Load latest task plan run state after ownership is accepted.
  3. Validate epoch and fencing token before any mutation.
  4. Apply at most one deterministic execution transition.
  5. Persist accepted state and execution event together.
  6. Release, retain, or heartbeat ownership according to resulting state.

Output:
  accepted | rejected | ignored_stale | already_in_progress
  current task plan run status
  current active node, if any
  event identifier for accepted or ignored diagnostic record
```

## Required Entry Points

- Manual start/resume.
- Scheduler advance.
- Runtime/provider result sync.
- Terminal node completion.
- Retry node.
- Pause task.
- Stop/cancel task.
- Restart recovery.

## Ownership Rules

- Only one active owner may mutate one task plan run.
- Overlapping triggers must not start provider-side work unless they become the active owner.
- If ownership cannot be acquired, the trigger must return `already_in_progress` or record an ignored diagnostic event.
- Active ownership must be validated again immediately before state persistence.

## Fencing Rules

- Every mutating command must carry the current execution epoch and owner token.
- If the epoch or token is stale, the command must not mutate task, node, attempt, or result state.
- Stale provider and terminal callbacks must be recorded as stale/ignored events.

## Node Attempt Rules

- A node attempt is the idempotency unit for provider-side work.
- A node attempt may create at most one provider run.
- If the same node attempt is observed again, the existing provider run is reused or observed.
- A completed node may only get a new node attempt through explicit retry.

## Result Rules

- A successful node attempt creates one effective result for the node.
- A later stale callback cannot replace an effective result.
- Stop/cancel of active work cannot obsolete earlier completed node results.
- Explicit retry supersedes the previous effective result only when the retry attempt completes successfully or reaches the defined replacement state.

## Serial Execution Rules

- Default task plan run mode is serial for provider-backed nodes.
- In serial mode, at most one provider-backed node attempt may be running at any time.
- Independent ready DAG branches must wait while another provider-backed node is running.

## Stop/Pause Rules

- Pause prevents automatic downstream advancement until explicit resume.
- Stop/cancel prevents automatic advancement and cancels or marks active running work without invalidating completed earlier results.
- Late callbacks after pause/stop are diagnostic unless explicitly accepted by a later user action in a newer epoch.

## Projection Contract

Task detail, plan graph, and activity/history consumers must see:

- One coherent task plan run status.
- One active node at most in serial mode.
- Stable effective results for completed nodes.
- Clear distinction between accepted events and ignored stale events.
- Provider run history tied to node attempts, not used as the sole source of node completion truth.

## Implemented Behavior Notes

- Execution ownership is persisted on `TaskPlanRun` with owner scope, lease, and epoch fields.
- Node attempts and provider runs are persisted with stable idempotency keys.
- Runtime callbacks only continue through an existing active execution session; pause/stop prevent automatic downstream advancement.
- Late callbacks for stale attempts are recorded as ignored runtime-sync events and do not overwrite current effective results.
- Runtime state persistence derives legacy `PlanRun.nodeStates` and attempt arrays from authoritative graph-runtime attempts/results.
- Default graph resolution suppresses additional ready nodes while any node attempt is running, preserving serial execution across later triggers.
