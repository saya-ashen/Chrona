# Data Model: Task Orchestrator

## Task

Represents the user-visible unit of work and its authoritative execution state.

**Fields**:

- `id`: Stable task identity.
- `title`: User-visible task name.
- `executionState`: One of `not_started`, `scheduled`, `queued`, `running`, `waiting_for_user`, `waiting_for_approval`, `blocked`, `failed`, `degraded`, `cancelled`, `completed`.
- `currentNodeId`: Current active, waiting, blocked, or next actionable graph node when available.
- `primaryAction`: User-facing next action such as start, pause, resume, retry sync, provide input, approve, cancel, replan, or no action.
- `progress`: Reconciled count and percentage derived from valid reachable graph nodes.
- `stateReason`: Human-readable reason for waiting, blocked, failed, degraded, or inconsistent states.
- `updatedAt`: Last reconciled state timestamp.

**Validation rules**:

- A task MUST NOT expose contradictory execution states.
- A running task MUST have an active execution session or an active external run.
- A completed task MUST have all reachable required nodes completed, skipped, or invalidated according to the current graph version.
- A degraded task MUST include a recovery action or retry schedule.

## Task Graph

Versioned executable plan attached to a task.

**Fields**:

- `taskId`: Owning task.
- `graphVersion`: Monotonic version number.
- `nodes`: Ordered executable and decision nodes.
- `edges`: Dependencies and branch paths.
- `activeBranchSelections`: Selected branch choices by condition node.
- `validity`: `valid`, `invalid`, or `needs_reconciliation`.

**Relationships**:

- Belongs to one task.
- Has many graph nodes and graph edges.
- Has many graph mutations.
- Is referenced by execution sessions.

**Validation rules**:

- A mutation MUST target the current graph version.
- The graph MUST have deterministic reachability after branch selections.
- Terminal completion MUST require all reachable prerequisites to be complete, skipped, or invalidated.

## Graph Node

Individual step in a task graph.

**Fields**:

- `id`: Stable node identity within the graph version.
- `type`: Task, checkpoint, condition, wait, approval, input, or terminal step.
- `status`: `pending`, `ready`, `running`, `waiting_for_user`, `waiting_for_approval`, `blocked`, `failed`, `skipped`, `invalidated`, `cancelled`, or `completed`.
- `dependencies`: Upstream node references.
- `result`: User, system, or runtime result when available.
- `attempts`: Execution attempts for automatic work.
- `reachable`: Whether the node is reachable in the current graph version and branch selection.
- `invalidatedByMutationId`: Mutation that invalidated this node, when applicable.

**Validation rules**:

- A running node MUST have at most one active external run.
- A skipped node MUST be unreachable due to branch selection or explicit mutation.
- An invalidated node MUST include the graph mutation that invalidated it.
- A completed node MUST NOT depend on reachable pending prerequisites in the same graph version.

## Execution Session

Represents an attempt to execute a task graph version.

**Fields**:

- `id`: Stable session identity.
- `taskId`: Owning task.
- `graphVersion`: Graph version being executed.
- `trigger`: User start, scheduled start, resume, recovery, or mutation continuation.
- `status`: `pending`, `running`, `waiting`, `blocked`, `failed`, `cancelled`, or `completed`.
- `startedAt`, `endedAt`: Session lifecycle timestamps.
- `lastAdvancedAt`: Last graph advancement timestamp.
- `pauseReason`: User wait, approval wait, blocker, degraded sync, or manual pause reason.

**Validation rules**:

- A task MUST NOT have more than one active execution session for the same graph version.
- A session cannot advance a stale graph version after a mutation changes execution state.

## External Run

Asynchronous runtime work started by a graph node.

**Fields**:

- `id`: Run identity.
- `taskId`: Owning task.
- `sessionId`: Execution session that started the run.
- `nodeId`: Graph node that owns the run.
- `status`: `pending`, `running`, `completed`, `failed`, `cancelled`, or `degraded`.
- `runtimeRef`: External runtime reference.
- `lastSyncedAt`: Last successful sync timestamp.
- `syncStatus`: `healthy`, `stale`, or `degraded`.
- `result`: Runtime output or failure reason.

**Validation rules**:

- A terminal external run MUST be synchronized into the owning graph node exactly once.
- A degraded run MUST be retried or surfaced with a user-safe recovery action.
- Late results for cancelled or invalidated nodes MUST be recorded but MUST NOT corrupt the current graph version.

## Scheduler Lease

Durable ownership of orchestration work.

**Fields**:

- `name`: Work key such as due start, task, session, run, or mutation.
- `ownerId`: Scheduler instance that owns the lease.
- `expiresAt`: Time after which another owner may acquire the lease.
- `heartbeatAt`: Last heartbeat timestamp.
- `metadata`: Optional work context for diagnostics.

**Validation rules**:

- A scheduler worker MUST acquire a valid lease before mutating shared task execution state.
- Expired leases may be acquired by another owner.
- Lease renewal MUST be idempotent and safe to retry.

## Graph Mutation

User-requested graph change during running or paused execution.

**Fields**:

- `id`: Mutation identity.
- `taskId`: Owning task.
- `baseGraphVersion`: Version the user edited.
- `operation`: Add node, update future node, remove future node, add edge, remove edge, replace subgraph, invalidate downstream, or replan from node.
- `status`: `pending`, `applied`, `rejected`, or `cancelled`.
- `validationResult`: Accepted or rejected reason.
- `affectedNodeIds`: Nodes changed, skipped, or invalidated.
- `createdBy`: User or system actor.
- `createdAt`, `appliedAt`: Mutation lifecycle timestamps.

**Validation rules**:

- Mutation base version MUST match the current graph version at apply time.
- Mutations that remove or rewrite active running nodes MUST be rejected unless execution is safely cancelled first.
- Applied mutations MUST be atomic: either all graph, progress, node, and task state changes apply, or none do.

## Reconciliation Result

Derived authoritative state after comparing graph, nodes, sessions, runs, blockers, waits, degraded sync, and mutations.

**Fields**:

- `taskId`: Reconciled task.
- `graphVersion`: Reconciled graph version.
- `executionState`: Authoritative task state.
- `currentNodeId`: Current node after reconciliation.
- `primaryAction`: Next user or system action.
- `progress`: Recalculated progress.
- `issues`: Detected inconsistencies, repairs, or degraded causes.
- `repairActions`: Deterministic repairs applied or user-safe recovery actions offered.
- `createdAt`: Reconciliation timestamp.

**Validation rules**:

- Every active task reconciliation MUST produce exactly one execution state.
- Impossible states MUST be repaired deterministically or surfaced as recoverable inconsistencies.
- Reconciliation MUST be safe to run repeatedly with the same input.

## State Transitions

### Task Execution State

```text
not_started -> scheduled -> queued -> running
not_started -> queued -> running
running -> waiting_for_user -> running
running -> waiting_for_approval -> running
running -> blocked -> running
running -> degraded -> running
running -> failed
running -> cancelled
running -> completed
degraded -> failed
degraded -> cancelled
blocked -> cancelled
failed -> queued
cancelled -> queued
```

### Graph Mutation State

```text
pending -> applied
pending -> rejected
pending -> cancelled
```

### External Run Sync State

```text
pending -> running -> completed
pending -> running -> failed
pending -> running -> cancelled
running -> degraded -> running
degraded -> failed
```
