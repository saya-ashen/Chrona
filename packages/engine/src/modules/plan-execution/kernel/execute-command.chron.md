---
chronicle_version: 1
scope: "file"
source: "execute-command.ts"
owner_feature: "Kernel"
owner_capability: "Execute Command"
layer: "engine"
status: "active"
sync:
  mode: "scaffold-and-check"
  source_hash: "c3ca5586bc907abc"
  last_scanned_commit: ""
symbols:
  - id: "executeCommand"
    source_name: "executeCommand"
    kind: "function"
    describe: true
    signature_hash: "159ea49a9ba09405"
    body_hash: "ddf0509cad57bc92"
---
# execute-command

<!-- ai:start -->
Provides the single state-mutating command kernel for plan execution, translating API/runtime commands into graph-runtime dispatches and persisting the resulting execution/session/run state once.
<!-- ai:end -->

## Generated symbol inventory

<!-- generated:symbols:start -->
| Symbol | Kind | Score | Reason | Signature |
|---|---:|---:|---|---|
| `executeCommand` | function | 5 | ai-selected:plan-execution-command-kernel | `export async function executeCommand( input: ExecutionCommandEnvelope & PlanExecutionObserver, ): Promise<PlanExecutionResult>` |
<!-- generated:symbols:end -->

## Symbols

<!-- symbol:executeCommand:start -->

### `executeCommand`

<!-- ai:start -->
Role: Central entry point for starting, resuming, approving, submitting, failing, blocking, retrying, pausing, cancelling, or mutating a task plan execution.

Behavior: Ensures a native plan run and execution session, appends start events when needed, resolves current graph state, ignores late out-of-band provider callbacks for inactive sessions, builds the corresponding graph command, dispatches graph runtime with kernel callbacks, saves the derived graph/run under an epoch guard, appends runtime events, and finalizes session/task/work-block projections from the outcome.

Inputs/outputs: Input is an `ExecutionCommandEnvelope` plus optional execution observers. Output is a `PlanExecutionResult` describing task/plan/session ids, execution status, effective graph, current node, executed nodes, message/error details, and wait kind.

Invariants:
All state mutation flows through one dispatch and one guarded final persist. Missing plans return `no_plan`; unresolvable late commands return current execution. Task status and block reason are not written directly here; projection rebuild remains authoritative.

Coverage:
Coverage status: Partial

Covered:
- Direct smoke tests cover start dispatch, duplicate start suppression while running, persisted running attempts, and serial advancement to the next ready node after in-process completion.

Missing or weak:
- Direct tests do not cover every command type, epoch conflict fallback, pause/cancel/mutation persistence, inactive late provider callbacks, work-block completion/release, or observer callback behavior.
<!-- ai:end -->

<!-- generated:tests:start executeCommand -->
Direct tests:
- packages/engine/src/modules/plan-execution/kernel/execute-command.smoke.bun.test.ts

Transitive tests:
- None found
<!-- generated:tests:end executeCommand -->

<!-- symbol:executeCommand:end -->
