---
chronicle_version: 1
scope: "file"
source: "task-orchestrator.ts"
owner_feature: "Orchestration"
owner_capability: "Task Orchestrator"
layer: "engine"
status: "active"
sync:
  mode: "scaffold-and-check"
  source_hash: "56eecc8ab76b7ce3"
  last_scanned_commit: ""
symbols:
  - id: "createTaskOrchestrator"
    source_name: "createTaskOrchestrator"
    kind: "function"
    describe: true
---
# task-orchestrator

<!-- ai:start -->
Coordinates Chrona background orchestration workers behind one scheduler lease, polling configured workers without re-entrant ticks or duplicate process-local orchestrators.
<!-- ai:end -->

## Generated symbol inventory

<!-- generated:symbols:start -->
| Symbol | Kind | Score | Reason | Signature |
|---|---:|---:|---|---|
| `createTaskOrchestrator` | function | 6 | ai-selected:task-orchestration-runtime-loop | `export function createTaskOrchestrator(options: TaskOrchestratorOptions =` |
<!-- generated:symbols:end -->

## Symbols

<!-- symbol:createTaskOrchestrator:start -->

### `createTaskOrchestrator`

<!-- ai:start -->
Role: Creates the runtime controller for task orchestration polling and worker registration.

Behavior: Loads config and workers, acquires the scheduler lease before each tick, renews the lease before each worker, runs workers sequentially, logs worker failures without aborting later workers, prevents overlapping ticks, and releases a held lease on stop. `start` is idempotent and respects disabled config.

Inputs/outputs: Input options can override config, initial workers, lease repository, clock, and interval functions for tests/runtime injection. Output exposes `start`, `stop`, `tick`, `isRunning`, and `registerWorker`.

Invariants:
Workers run only when this owner acquires the lease. One tick runs at a time. Later worker registration replaces by worker name. Stopping clears the polling timer and releases only a lease previously held by this orchestrator.

Coverage:
Coverage status: Partial

Covered:
- Direct tests cover production worker list membership, idempotent start, disabled start, lease acquisition gating, no re-entry, post-start worker registration, worker failure isolation, stop cleanup, and lease release.
- Scheduler ownership integration test covers skipping workers when another owner holds the active lease.

Missing or weak:
- Direct tests do not cover lease renewal failure semantics or the global singleton helpers.
<!-- ai:end -->

<!-- generated:tests:start createTaskOrchestrator -->
Direct tests:
- packages/engine/src/modules/orchestration/scheduler-ownership.integration.bun.test.ts
- packages/engine/src/modules/orchestration/task-orchestrator.bun.test.ts

Transitive tests:
- None found
<!-- generated:tests:end createTaskOrchestrator -->

<!-- symbol:createTaskOrchestrator:end -->
