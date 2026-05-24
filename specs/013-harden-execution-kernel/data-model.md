# Data Model: Harden Execution Kernel

## Task Plan Run

Represents one active execution instance of a task plan.

**Fields**:

- `id`: stable identifier.
- `taskId`: owning task.
- `planId`: source plan definition.
- `status`: `idle`, `running`, `paused`, `stopped`, `completed`, `failed`.
- `executionEpoch`: monotonic generation incremented when a new execution authority period begins.
- `activeOwnerId`: current execution owner, if any.
- `activeNodeId`: currently accepted running node, if any.
- `serialMode`: whether provider-backed node execution is restricted to one at a time.
- `updatedAt`: last mutation time.

**Relationships**:

- Has many execution owners.
- Has many node attempts.
- Has many node results.
- Has many execution events.

**Validation rules**:

- At most one active owner per task plan run.
- In serial mode, at most one provider-backed node attempt may be running.
- Completed task plan runs cannot be advanced unless explicitly restarted through a new accepted user action.

## Execution Owner

Represents the only actor currently allowed to advance a task plan run.

**Fields**:

- `id`: stable owner identifier.
- `taskPlanRunId`: owning task plan run.
- `epoch`: execution epoch this owner belongs to.
- `leaseToken`: opaque fencing token.
- `source`: `manual`, `scheduler`, `runtime_callback`, `terminal_callback`, `recovery`, `retry`, `pause`, `stop`.
- `status`: `active`, `released`, `expired`, `rejected`.
- `acquiredAt`: acquisition time.
- `heartbeatAt`: last observed liveness time.
- `expiresAt`: time after which ownership may be reacquired.
- `releasedAt`: release time, if released.

**Relationships**:

- Belongs to one task plan run.
- Owns zero or more execution transitions.

**Validation rules**:

- Only an active, unexpired owner for the current epoch can mutate execution state.
- Rejected owners must not start provider-side work.
- Expired owners must fail fencing checks before any write.

## Node Attempt

Represents one intended execution of one plan node.

**Fields**:

- `id`: stable attempt identifier.
- `taskPlanRunId`: owning task plan run.
- `nodeId`: plan node being executed.
- `attemptNumber`: monotonically increasing per node.
- `epoch`: epoch in which the attempt was accepted.
- `ownerId`: owner that accepted the attempt.
- `status`: `pending`, `running`, `succeeded`, `failed`, `cancelled`, `stale`.
- `providerRunId`: provider-side run associated with this attempt, if any.
- `startedAt`: start time.
- `completedAt`: completion time.
- `cancelledAt`: cancellation time.

**Relationships**:

- Belongs to one task plan run.
- Has zero or one provider run.
- Has zero or one effective node result.
- Has many execution events.

**Validation rules**:

- One node attempt can create at most one provider run.
- A new attempt for a completed node requires explicit retry.
- A stale attempt cannot become the effective result source.

## Provider Run

Represents one external AI/provider execution.

**Fields**:

- `id`: provider run record identifier.
- `taskPlanRunId`: owning task plan run.
- `nodeAttemptId`: owning node attempt.
- `nodeId`: associated node.
- `idempotencyKey`: stable key for this node attempt.
- `status`: `pending`, `running`, `completed`, `failed`, `cancelled`, `stale`.
- `externalRef`: provider/runtime reference.
- `startedAt`: provider start time.
- `completedAt`: provider completion time.

**Relationships**:

- Belongs to one node attempt.
- Emits execution events.

**Validation rules**:

- `idempotencyKey` is unique per node attempt.
- A second provider start for the same node attempt must return or observe the existing provider run rather than creating a duplicate.

## Node Result

Represents the durable checkpoint produced by a node attempt.

**Fields**:

- `id`: result identifier.
- `taskPlanRunId`: owning task plan run.
- `nodeId`: plan node.
- `nodeAttemptId`: attempt that produced the result.
- `epoch`: epoch in which result was accepted.
- `status`: `effective`, `superseded`, `stale`, `rejected`.
- `summary`: human-readable result summary.
- `outputs`: structured result outputs.
- `evidence`: provider/tool evidence.
- `createdAt`: result creation time.

**Relationships**:

- Belongs to one node attempt.
- Contributes to task/plan graph projection.

**Validation rules**:

- At most one effective result per node per task plan run.
- Effective result can be superseded only by explicit retry or defined user replacement.
- Stop/cancel of later work must not supersede completed earlier results.

## Execution Event

Represents accepted progression, ignored stale callback, retry, stop, pause, cancellation, recovery, or diagnostic history.

**Fields**:

- `id`: event identifier.
- `taskPlanRunId`: owning task plan run.
- `nodeId`: related node, if any.
- `nodeAttemptId`: related attempt, if any.
- `ownerId`: related owner, if any.
- `type`: event type.
- `classification`: `accepted`, `ignored`, `stale`, `diagnostic`.
- `message`: user/maintainer-readable message.
- `metadata`: structured details.
- `createdAt`: event time.

**Validation rules**:

- Every stale callback must produce an ignored or stale event.
- Every rejected overlapping trigger must produce a diagnostic event.
- User-visible history must not imply stale events changed effective execution state.

## State Transitions

### Task Plan Run

```text
idle -> running -> paused -> running -> completed
idle -> running -> stopped
running -> failed
paused -> stopped
stopped -> running only by explicit user resume/start
completed -> running only by explicit user restart/retry path
```

### Execution Owner

```text
active -> released
active -> expired
active -> rejected by fencing if epoch/token no longer current
```

### Node Attempt

```text
pending -> running -> succeeded
pending -> running -> failed
pending -> running -> cancelled
running -> stale when superseded by newer epoch before completion
succeeded -> superseded only through explicit retry on node result
```

### Node Result

```text
effective -> superseded only through explicit retry/replacement
stale callbacks -> stale/rejected result record, never effective
```

## Projection Rules

- Task graph UI status is derived from task plan run status, node attempts, and effective node results.
- Provider run history is diagnostic and must not by itself make a node completed.
- Legacy unpublished state paths that disagree with this model must be removed or rewritten to derive from this model.
