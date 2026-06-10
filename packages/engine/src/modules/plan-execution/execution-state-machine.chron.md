---
chronicle_version: 1
scope: "file"
source: "execution-state-machine.ts"
owner_feature: "Plan Execution"
owner_capability: "Execution State Machine"
layer: "engine"
status: "active"
sync:
  mode: "scaffold-and-check"
  source_hash: "64e035bbeae34b09"
  last_scanned_commit: ""
symbols:
  - id: "executionStatusFromEffectiveGraph"
    source_name: "executionStatusFromEffectiveGraph"
    kind: "function"
    describe: true
  - id: "executionStatusFromGraphOutcome"
    source_name: "executionStatusFromGraphOutcome"
    kind: "function"
    describe: true
  - id: "executionTransition"
    source_name: "executionTransition"
    kind: "function"
    describe: true
  - id: "graphStatusForExecutionStatus"
    source_name: "graphStatusForExecutionStatus"
    kind: "function"
    describe: true
---
# execution-state-machine

<!-- ai:start -->
Defines the canonical mappings between graph outcomes, plan execution status, session status, plan-run status, graph status, and pause reasons used when persisting execution progress.
<!-- ai:end -->

## Generated symbol inventory

<!-- generated:symbols:start -->
| Symbol | Kind | Score | Reason | Signature |
|---|---:|---:|---|---|
| `executionStatusFromEffectiveGraph` | function | 5 | ai-selected:plan-execution-state-transitions | `export function executionStatusFromEffectiveGraph( effective: EffectivePlanGraph, ): PlanExecutionStatus` |
| `executionStatusFromGraphOutcome` | function | 5 | ai-selected:plan-execution-state-transitions | `export function executionStatusFromGraphOutcome(outcome: GraphDispatchOutcome): PlanExecutionStatus` |
| `executionTransition` | function | 5 | ai-selected:plan-execution-state-transitions | `export function executionTransition(input:` |
| `graphStatusForExecutionStatus` | function | 5 | ai-selected:plan-execution-state-transitions | `export function graphStatusForExecutionStatus(status: PlanExecutionStatus): PlanGraph["status"]` |
<!-- generated:symbols:end -->

## Symbols

<!-- symbol:executionStatusFromEffectiveGraph:start -->

### `executionStatusFromEffectiveGraph`

<!-- ai:start -->
Role: Derives a high-level `PlanExecutionStatus` from an effective graph snapshot after graph resolution.

Behavior: Reports `running` when any node is ready or running, then prioritizes user waits, approval waits, failures, and blocked nodes. It returns `completed` only when every reachable node is completed; otherwise unresolved graphs fall back to `blocked`.

Inputs/outputs: Input is an `EffectivePlanGraph` with node lists and computed ready/running/failed/blocked/completed id sets. Output is one `PlanExecutionStatus` value.

Invariants:
Ready or running work takes precedence over pauses and failures. Completion ignores unreachable nodes. A graph with no runnable/waiting/failed/blocked state and incomplete reachable work is treated as blocked.

Coverage:
Coverage status: Unknown

Covered:
- No direct tests are listed for this symbol.

Missing or weak:
- Needs direct table tests for status precedence, unreachable completed graphs, empty graphs, and blocked fallback behavior.
<!-- ai:end -->

<!-- generated:tests:start executionStatusFromEffectiveGraph -->
Direct tests:
- None found

Transitive tests:
- None found
<!-- generated:tests:end executionStatusFromEffectiveGraph -->

<!-- symbol:executionStatusFromEffectiveGraph:end -->

<!-- symbol:executionStatusFromGraphOutcome:start -->

### `executionStatusFromGraphOutcome`

<!-- ai:start -->
Role: Normalizes graph-runtime dispatch outcomes into the execution status vocabulary persisted by Chrona.

Behavior: Passes through supported graph statuses (`running`, waits, `blocked`, `failed`, `completed`, `cancelled`) and maps graph-runtime `unsupported` outcomes to `blocked`.

Inputs/outputs: Input is a `GraphDispatchOutcome`. Output is the corresponding `PlanExecutionStatus` used by execution finalization.

Invariants:
Unsupported graph commands do not create a separate execution status; they pause execution as blocked work.

Coverage:
Coverage status: Unknown

Covered:
- No direct tests are listed for this symbol.

Missing or weak:
- Needs direct mapping tests for every graph outcome status, especially `unsupported` to `blocked`.
<!-- ai:end -->

<!-- generated:tests:start executionStatusFromGraphOutcome -->
Direct tests:
- None found

Transitive tests:
- None found
<!-- generated:tests:end executionStatusFromGraphOutcome -->

<!-- symbol:executionStatusFromGraphOutcome:end -->

<!-- symbol:executionTransition:start -->

### `executionTransition`

<!-- ai:start -->
Role: Builds the full persisted execution transition for one execution status change.

Behavior: Computes pause reason, session status, plan-run status, and graph status from a `PlanExecutionStatus`, preserving an explicit wait kind when supplied.

Inputs/outputs: Input is a status plus optional pause reason. Output is an `ExecutionTransition` containing execution status, session status, plan-run status, graph status, and nullable pause reason.

Invariants:
Pause reasons are only present for paused/failed/blocked statuses unless explicitly supplied. Completed maps to completed session/run/graph state; cancelled maps to abandoned session, cancelled run, and cancelled graph.

Coverage:
Coverage status: Unknown

Covered:
- No direct tests are listed for this symbol.

Missing or weak:
- Needs direct transition matrix tests across active, paused, terminal, and explicit wait-kind inputs.
<!-- ai:end -->

<!-- generated:tests:start executionTransition -->
Direct tests:
- None found

Transitive tests:
- None found
<!-- generated:tests:end executionTransition -->

<!-- symbol:executionTransition:end -->

<!-- symbol:graphStatusForExecutionStatus:start -->

### `graphStatusForExecutionStatus`

<!-- ai:start -->
Role: Maps execution status into the graph status persisted on `PlanGraph` snapshots.

Behavior: Returns `completed` for completed execution, `cancelled` for cancelled execution, `active` for started/running/no-plan states, and `paused` for waits, blocked, or failed execution.

Inputs/outputs: Input is a `PlanExecutionStatus`; output is a `PlanGraph["status"]` value.

Invariants:
Graph status intentionally has fewer states than execution status. Waiting, blocked, and failed executions all persist as paused graph snapshots.

Coverage:
Coverage status: Unknown

Covered:
- No direct tests are listed for this symbol.

Missing or weak:
- Needs direct mapping tests for all execution statuses, including no-plan/start aliases and failed-as-paused behavior.
<!-- ai:end -->

<!-- generated:tests:start graphStatusForExecutionStatus -->
Direct tests:
- None found

Transitive tests:
- None found
<!-- generated:tests:end graphStatusForExecutionStatus -->

<!-- symbol:graphStatusForExecutionStatus:end -->
