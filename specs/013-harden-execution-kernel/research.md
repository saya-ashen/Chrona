# Research: Harden Execution Kernel

## Decision: Keep Chrona DAG/product model and harden the execution kernel in place

**Rationale**: The observed failure is not a graph algorithm problem. Chrona can already represent the plan DAG and run a single graph runtime invocation serially. The defect is that multiple engine entry points can advance the same task plan run concurrently, creating duplicate provider-side work and unstable results. Keeping the current DAG/product model avoids unnecessary product churn while allowing the execution authority model to be corrected directly.

**Alternatives considered**:

- Fully migrate to an external durable workflow framework: rejected for this feature because the library maturity and migration surface are not justified yet.
- Replace only the topological scheduler: rejected because ready-node selection is not the root cause.
- Add ad hoc guards to individual entry points: rejected because manual start, scheduler, provider callback sync, terminal result continuation, stop, pause, retry, and recovery all need the same rule.

## Decision: Add durable task-plan-run execution ownership

**Rationale**: Exactly one execution owner must be allowed to mutate a task plan run at a time. This ownership must be durable because current process-local control maps cannot protect against overlapping scheduler ticks, callbacks, manual actions, or restart recovery.

**Alternatives considered**:

- Process-local mutex: rejected because it cannot protect after restart and cannot coordinate independent entry points reliably.
- Trust active execution session status: rejected because state can be stale and previous evidence showed sessions can be recreated or abandoned while runs continue.
- Provider-run status as the lock: rejected because provider runs are side effects, not execution ownership records.

## Decision: Use execution epoch and fencing tokens for every state mutation

**Rationale**: A task can be paused, stopped, retried, or resumed while older callbacks and execution owners are still in flight. Every mutating path must prove it belongs to the current epoch and accepted owner before writing task, node, attempt, or result state.

**Alternatives considered**:

- Compare timestamps: rejected because timestamp order does not reliably express ownership or user intent.
- Check only node status: rejected because stale owners can read old status and write after newer changes.
- Ignore late callbacks entirely: rejected because they still need diagnostic visibility and provider history.

## Decision: Make node attempt identity the idempotency boundary

**Rationale**: A node attempt represents one intended execution of one plan node. Provider-side work must be created at most once for that attempt. If an overlapping trigger reaches the same node attempt, it must observe the existing attempt/provider run rather than create a new one.

**Alternatives considered**:

- Idempotency by provider run ID: rejected because each duplicate invocation creates a new run ID and therefore defeats deduplication.
- Idempotency by node ID only: rejected because explicit retry needs a new attempt for the same node.
- Idempotency by task ID only: rejected because a task contains many nodes and retries.

## Decision: Treat completed node result as a durable checkpoint

**Rationale**: Completed node work must not repeat automatically during resume, recovery, downstream execution, or scheduler evaluation. The effective result remains stable until explicit retry. This mirrors durable workflow step memoization without adding an external workflow runtime dependency.

**Alternatives considered**:

- Recompute completed nodes during recovery: rejected because provider work may be costly or irreversible.
- Obsolete all current results on stop/cancel: rejected because stop/cancel should affect active work, not erase completed evidence.
- Keep multiple conflicting result sources: rejected because previous investigation found divergent mutable graph and legacy node state sources.

## Decision: Record stale callbacks as ignored execution events

**Rationale**: Late provider or terminal callbacks are expected in asynchronous execution. They must not mutate current execution state, but maintainers and users need enough history to understand what happened.

**Alternatives considered**:

- Drop stale callbacks silently: rejected because it hides important debugging evidence.
- Accept stale callbacks if node IDs match: rejected because node ID alone does not prove current attempt or user intent.
- Convert stale callbacks into retries: rejected because retry must be explicit user intent.

## Decision: Remove unpublished legacy compatibility paths

**Rationale**: Chrona has not shipped a formal stable version. Keeping compatibility for known-conflicting execution state would increase complexity and preserve ambiguity. The correct design is one authoritative execution model and projection output derived from it.

**Alternatives considered**:

- Migrate old local data: rejected because the user explicitly removed compatibility requirements.
- Support both old and new state readers: rejected because dual readers caused hidden divergence and unstable UI state.
- Keep legacy aliases temporarily: rejected because the feature's goal is to remove conflicting state authority.
