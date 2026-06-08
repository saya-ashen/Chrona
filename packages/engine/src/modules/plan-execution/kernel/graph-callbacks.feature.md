---
feature_doc_version: 1
scope: "file"
source: "graph-callbacks.ts"
owner_feature: "Kernel"
owner_capability: "Graph Callbacks"
layer: "engine"
status: "active"
sync:
  mode: "scaffold-and-check"
  source_hash: "b7d3b0137a3b25b7"
  last_scanned_commit: ""
symbols:
  - id: "createKernelGraphCallbacks"
    source_name: "createKernelGraphCallbacks"
    kind: "function"
    describe: true
---
# graph-callbacks

<!-- ai:start -->
Creates graph-runtime callbacks that connect graph execution to Chrona persistence, node executors, observer events, and re-entrant command reconciliation.
<!-- ai:end -->

## Generated symbol inventory

<!-- generated:symbols:start -->
| Symbol | Kind | Score | Reason | Signature |
|---|---:|---:|---|---|
| `createKernelGraphCallbacks` | function | 13 | ai-selected:plan-execution-graph-mutation-callbacks | `export function createKernelGraphCallbacks( input: KernelCallbacksInput & PlanExecutionObserver, ): Partial<GraphExecutionCallbacks<EngineRuntimeContext>>` |
<!-- generated:symbols:end -->

## Symbols

<!-- symbol:createKernelGraphCallbacks:start -->

### `createKernelGraphCallbacks`

<!-- ai:start -->
Role: Builds the callback set used by `executeCommand` when dispatching graph runtime commands inside the engine kernel.

Behavior: On node start, optionally marks the execution session projection active and forwards graph events. On state change, it first checks for committed nested-command state; if none exists, it persists intermediate graph state and notifies observers. Node execution is delegated to the first registered plan-execution node executor that can handle the node. Submitted-node resolution can adopt already committed DB state for out-of-band or nested results.

Inputs/outputs: Input combines kernel ids, compiled/persisted plan state, main session, runtime name, work-block context, and optional observer callbacks. Output is a partial `GraphExecutionCallbacks<EngineRuntimeContext>` object for graph runtime dispatch.

Invariants:
Intermediate graph state is persisted before observer state notifications. Nested committed state wins over in-memory dispatch state. Runtime events emitted by node executors are annotated with node id/title and runtime name before forwarding.

Coverage:
Coverage status: Unknown

Covered:
- No direct tests are listed for this symbol.

Missing or weak:
- Needs direct tests for active-node projection updates, intermediate state persistence, nested committed-state adoption, executor selection, runtime-event annotation, and submitted-node committed-state cloning.
<!-- ai:end -->

<!-- generated:tests:start createKernelGraphCallbacks -->
Direct tests:
- None found

Transitive tests:
- None found
<!-- generated:tests:end createKernelGraphCallbacks -->

<!-- symbol:createKernelGraphCallbacks:end -->
