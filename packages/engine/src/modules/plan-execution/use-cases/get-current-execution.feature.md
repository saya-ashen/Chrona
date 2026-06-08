---
feature_doc_version: 1
scope: "file"
source: "get-current-execution.ts"
owner_feature: "Use Cases"
owner_capability: "Get Current Execution"
layer: "engine"
status: "active"
sync:
  mode: "scaffold-and-check"
  source_hash: "cd0df1036f59928a"
  last_scanned_commit: ""
symbols:
  - id: "currentExecutionStatusFromEffectiveGraph"
    source_name: "currentExecutionStatusFromEffectiveGraph"
    kind: "function"
    describe: true
  - id: "getCurrentExecution"
    source_name: "getCurrentExecution"
    kind: "function"
    describe: true
---
# get-current-execution

<!-- ai:start -->
Role: projects the currently selected task plan run into the API shape consumed by task workspace execution/current and Command Center `documents.now`.

Behavior: ensures a native persisted plan run exists, resolves the effective graph from persisted attempts/results, checks active execution session state, derives a current execution status, selects a current node, and returns a `PlanExecutionResult` with optional checkpoint UI in `ui.currentOperationSpec`.

Critical invariant: `started` is only valid before any execution evidence exists. Failed, blocked, running, waiting, or completed effective graph evidence must win even when no active `ExecutionSession` row remains. Command Center status-card correctness depends on this projection.

Coverage after repair: partial/good for the high-risk status projection branch. `packages/engine/src/modules/plan-execution/use-cases/get-current-execution.bun.test.ts` now covers accepted-with-no-evidence returning `started` and no-active-session failed/blocked/waiting evidence returning the persisted graph status. Remaining gaps are API-level work-block scoping and checkpoint payload completeness.
<!-- ai:end -->

## Generated symbol inventory

<!-- generated:symbols:start -->
| Symbol | Kind | Score | Reason | Signature |
|---|---:|---:|---|---|
| `currentExecutionStatusFromEffectiveGraph` | function | 5 | ai-selected:task-workspace-current-execution-status-projection | `export function currentExecutionStatusFromEffectiveGraph(input:` |
| `getCurrentExecution` | function | 6 | ai-selected:task-workspace-current-execution-status-projection | `export async function getCurrentExecution(input:` |
<!-- generated:symbols:end -->

## Symbols

<!-- symbol:getCurrentExecution:start -->

### `getCurrentExecution`

<!-- ai:start -->
Role: returns one task's current execution snapshot for REST callers and for the command-center document builder.

Inputs/outputs: input is `{ taskId, workBlockId? }`. Output is `PlanExecutionResult`: status, current node, executed/waiting/blocked node ids, checkpoint, message, and `ui.currentOperationSpec` when a checkpoint is actionable.

Behavior: if no accepted native plan run exists, returns `no_plan`. Otherwise it resolves effective graph status. Active execution sessions force live graph evaluation; persisted graph evidence such as failed/blocked/running/waiting/completed nodes also forces graph evaluation even after the execution session closes. Only an accepted plan with no execution evidence returns `started`.

Coverage: partial. `get-current-execution.bun.test.ts` directly covers the extracted status projection helper for ready-to-start, failed, blocked, and waiting graph evidence; API integration tests cover ready-to-start and completed execution. Still missing direct API coverage for work-block scoped current execution and checkpoint UI payload completeness.
<!-- ai:end -->

<!-- generated:tests:start getCurrentExecution -->
Direct tests:
- None found

Transitive tests:
- None found
<!-- generated:tests:end getCurrentExecution -->

<!-- symbol:getCurrentExecution:end -->

<!-- symbol:currentExecutionStatusFromEffectiveGraph:start -->

### `currentExecutionStatusFromEffectiveGraph`

<!-- ai:start -->
Role: pure status projection guard used by `getCurrentExecution` before it chooses between pre-execution `started` and persisted effective-graph state.

Behavior: returns `started` only when there is no active execution session and no persisted execution evidence. Any completed, failed, blocked, running, or waiting graph evidence delegates to `executionStatusFromEffectiveGraph`, preserving failed/blocked/waiting states after an execution session closes.

Inputs/outputs: input is an effective graph plus `hasActiveExecutionSession`. Output is a `PlanExecutionStatus`.

Coverage: good for the regression class. `get-current-execution.bun.test.ts` covers the old false-positive `started` path plus failed, blocked, and waiting graph evidence with no active session. Missing one direct case for `runningNodeIds` evidence, but the highest-risk failed/blocked Command Center status-card path is pinned.
<!-- ai:end -->

<!-- generated:tests:start currentExecutionStatusFromEffectiveGraph -->
Direct tests:
- None found

Transitive tests:
- None found
<!-- generated:tests:end currentExecutionStatusFromEffectiveGraph -->

<!-- symbol:currentExecutionStatusFromEffectiveGraph:end -->
