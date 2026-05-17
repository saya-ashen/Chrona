# Task Orchestrator Architecture

## Ownership

Chrona task orchestration now lives under `packages/engine/src/modules/orchestration/`.
The orchestrator owns durable leases, scheduler events, active run sync, graph
advancement, degraded retry, restart recovery, reconciliation, and graph mutation
persistence boundaries.

## Runtime Loop

`createDefaultTaskOrchestrator()` registers workers in this order:

1. `restart-recovery`
2. `due-scheduled-work`
3. `active-run-sync`
4. `graph-advancement`
5. `degraded-retry`

The lifecycle is exposed through `startTaskOrchestrator()` and started by server
bootstrap through the runtime service. The old auto-start runner delegates to the
orchestrator so existing imports do not start a second scheduler.

## State Model

`packages/contracts/src/task-orchestrator.ts` defines task execution summaries,
graph node state, reconciliation results, recovery actions, and mutation
request/response schemas. Task pages receive one authoritative
`executionSummary`, `graphNodeStates`, and `reconciliation` result from
`getTaskPage()`.

`packages/graph-runtime` now separates waiting, approval, blocked, failed,
degraded, skipped, invalidated, cancelled, completed, ready, running, and pending
node buckets so UI and workers do not infer conflicting task states.

## Persistence

Prisma models added for orchestrator state:

- `SchedulerLease`
- `SchedulerEvent`
- `GraphVersion`
- `GraphMutationRecord`
- `ReconciliationEvent`

Repositories live in `packages/engine/src/modules/orchestration/` and keep direct
database access outside React and Hono handlers.

## Recovery And Auditing

Scheduler events are recorded for starts, skips, syncs, advances, failures,
degraded retries, and repairs. Event payloads pass through redaction before
persistence. Reconciliation invariants live in `reconcile-invariants.ts` and
currently detect terminal completion before reachable prerequisites complete,
returning a deterministic `repair_inconsistency` recovery action.

## Deferred Scope

Runtime graph mutation endpoints and UI affordances are not implemented in this
checkpoint. Persistence schemas and repository primitives exist, but validator,
apply service, routes, and mutation UI were intentionally skipped in `tasks.md`.
