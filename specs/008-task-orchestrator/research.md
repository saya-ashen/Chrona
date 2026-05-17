# Research: Task Orchestrator

## Decision: Build a Chrona-Specific Orchestrator

**Decision**: Implement a custom task orchestrator inside Chrona instead of adopting a generic scheduler, cron runner, queue, or workflow engine for this phase.

**Rationale**: Chrona's correctness problem is not simply running a function at a time. It must converge a versioned task graph, synchronize asynchronous runtime results, advance ready graph nodes, pause for user decisions, distinguish blockers from waits, recover degraded runs, and support safe runtime graph mutations. Generic schedulers provide timers; Chrona needs domain-specific execution state reconciliation.

**Alternatives considered**:

- `setInterval` or cron-style libraries: useful for ticks only, but they do not solve durable ownership, graph advancement, or reconciliation.
- Redis-backed queues: strong job execution substrate, but add operational dependency and still require Chrona-specific graph state logic.
- Postgres job workers: good fit after a database migration, but current storage is SQLite and no legacy compatibility is required now.
- Temporal: powerful durable workflow system, but operationally heavy and still cannot replace Chrona's graph mutation semantics, UI state contract, or reconciliation rules.

## Decision: Use Durable Leases and Idempotent Workers

**Decision**: Use database-backed scheduler leases for due starts, task sessions, external runs, graph advancements, degraded retries, and graph mutations.

**Rationale**: Scheduler correctness must survive restarts and must remain safe if multiple server processes run. A lease with owner identity, expiry, heartbeat, and work key gives each worker temporary ownership while allowing another worker to recover expired work.

**Alternatives considered**:

- In-memory `inFlight` flags: simple, but fail after restart and cannot coordinate multiple processes.
- Per-process singleton scheduler: avoids local duplication only when exactly one process exists, which does not satisfy the spec.
- External distributed locks: unnecessary operational complexity for the current local SQLite target.

## Decision: Make Reconciliation Authoritative

**Decision**: Add a reconciliation step that derives the authoritative task state from graph version, node states, execution sessions, external runs, waits, blockers, degraded sync, cancellations, and mutations.

**Rationale**: The current UI inconsistency exists because task status, run status, block reason, readiness, and graph node state are derived independently. Reconciliation creates one source of truth that can drive both backend behavior and workspace presentation.

**Alternatives considered**:

- Continue deriving state separately in frontend view models: cannot repair stale backend state and can only hide contradictions.
- Add more status flags without reconciliation: increases ambiguity and makes impossible states harder to detect.
- Treat runtime sync as the only source of truth: insufficient because user waits, graph mutations, scheduled starts, and execution sessions also affect state.

## Decision: Split Wait, Blocked, Degraded, Skipped, and Invalidated States

**Decision**: Replace overloaded blocker summaries with explicit state categories for waiting for user, waiting for approval, true blocked, failed, degraded, skipped, invalidated, cancelled, and completed.

**Rationale**: A waiting node is not a blocked node, and degraded runtime sync is not readiness. Explicit states prevent the workspace from showing contradictory actions and allow recovery flows to be precise.

**Alternatives considered**:

- Keep `blockedNodeIds` as a catch-all for all attention states: causes misleading UI and incorrect scheduler decisions.
- Map all paused states to blocked: loses whether the user can act, approval is needed, or the system must retry.

## Decision: Support Runtime Graph Changes Through Versioned Mutations

**Decision**: Treat graph edits during execution as explicit mutations against a graph version, with validation, atomic apply-or-reject behavior, downstream invalidation, and audit history.

**Rationale**: Directly editing an effective graph while it runs can erase execution history or make active work untraceable. Versioned mutation commands let Chrona reject unsafe active-node changes, apply safe future edits, and explain invalidated downstream work.

**Alternatives considered**:

- Directly rewrite the saved effective graph: simplest but unsafe for running tasks and impossible to audit.
- Require users to stop and clone every task before editing: safe but blocks the expected future workflow of dynamic task refinement.
- Allow only append-only edits: too restrictive for replacing unstarted branches or replanning from a node.

## Decision: Reset or Rebuild Old Scheduler State

**Decision**: Do not preserve old scheduler state or old saved execution projections; reset or rebuild development data as needed during implementation.

**Rationale**: The user explicitly requested the optimal refactor without old code or old data compatibility. Removing compatibility constraints reduces risk of preserving contradictory state semantics.

**Alternatives considered**:

- Migrate old partial scheduler state: would encode invalid historical semantics into the new model.
- Compatibility adapters: would prolong the old split-source state model and complicate testing.

## Decision: Keep Frontend as Presentation of Authoritative State

**Decision**: The task workspace should present the orchestrator's authoritative read model and should not infer execution truth from independent badges, raw task status, or local selection state.

**Rationale**: The frontend should make current task, active node, waiting/blocking/degraded reason, and primary action visible, but business logic must remain outside React components. Shared contracts should expose the state needed for a truthful UI.

**Alternatives considered**:

- Patch workspace state mapping only: would not solve backend execution correctness.
- Keep multiple task badges from different sources: preserves the current contradiction problem.
