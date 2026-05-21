# Task Execution Refactor Debt

> Status captured after the task execution refactor on 2026-05-21.
> Purpose: preserve the diagnosis and optimal follow-up design across new AI
> sessions.

## Summary

The original diagnosis was correct: task execution failures were caused less by a
single bug and more by oversized files, mixed responsibilities, and unclear state
boundaries.

The largest root cause in `plan-execution` has been addressed. The largest
contract hotspot, graph runtime monolith, graph runtime test fixture, and plan
runner task-executor fixture have also been split. The rest of the execution
system still has architecture debt, especially in remaining API fixtures and
medium-sized orchestration modules.

## Solved Scope

The main file `packages/engine/src/modules/plan-execution/task-plan-execution.ts`
was reduced from about 2506 lines to about 670 lines.

Responsibilities moved out of the original file:

- Facade class and singleton moved to `facade/task-plan-execution.facade.ts`.
- Shared execution types moved to `types.ts`.
- Plan runtime persistence moved to `persistence/plan-runtime-store.ts`.
- Execution session persistence moved to `persistence/execution-session-store.ts`.
- Work block lifecycle moved to `persistence/work-block-store.ts`.
- Runtime event persistence moved to `persistence/runtime-event-store.ts`.
- Task execution status persistence moved to `persistence/task-execution-store.ts`.
- Runtime name lookup moved to `persistence/task-runtime-store.ts`.
- Execution response projection moved to `projection/execution-response.ts`.
- Graph selectors moved to `projection/execution-graph-selectors.ts`.
- Graph state conversion moved to `runtime/graph-state.ts`.
- Graph runtime callbacks moved to `runtime/graph-runtime-callbacks.ts`.
- Advance command construction moved to `runtime/advance-dispatch/`.
- Runtime outcome helpers moved to `runtime/runtime-outcome.ts`.
- Terminal command validation moved to `runtime/terminal-command.ts`.
- Execution lifecycle handling moved to `use-cases/execution-lifecycle.ts`.
- Advance outcome handling moved to `use-cases/advance-outcome.ts`.
- Runtime command action dispatch moved to
  `use-cases/dispatch-runtime-command-action.ts`.
- Current execution lookup moved to `use-cases/get-current-execution.ts`.
- Checkpoint transition handling moved to
  `use-cases/checkpoint-transition/`.
- Terminal node result submission moved to
  `use-cases/submit-terminal-node-result.ts`.
- Runtime result sync moved to `use-cases/sync-runtime-result/`.

Current key entry sizes after the refactor:

| Entry | Size | Role |
| --- | ---: | --- |
| `advancePlanExecution` | about 27 lines | Build runtime, dispatch command, hand off outcome |
| `submitCheckpointAction` | about 22 lines | Load checkpoint context and delegate transition |
| `dispatchExecutionAction` | about 113 lines | Action router switch |

Verification after the refactor:

- `bun run typecheck` passed.
- Targeted Bun tests for `plan-execution`, `runtime-sync`, and `orchestration`
  passed: 77 tests.
- API tests for task workflow and plan execution output passed: 32 tests.
- `bun run test` passed: 47 files, 285 tests.
- `bun run lint` had 0 errors. Warning baseline remains high.
- `gitnexus_detect_changes(scope: "all")` reported high risk, expected because
  core execution flows were touched.

### Advance Dispatch Split

`packages/engine/src/modules/plan-execution/runtime/advance-dispatch-command.ts`
was removed. Advance command construction now lives in focused modules under
`packages/engine/src/modules/plan-execution/runtime/advance-dispatch/`:

| Module | Size | Role |
| --- | ---: | --- |
| `build-advance-dispatch-command.ts` | 58 lines | Public builder for implicit start/resume and explicit commands |
| `command-kind.ts` | 17 lines | Runtime command family guards |
| `current-node.ts` | 21 lines | Current execution node resolution for external results |
| `explicit-command.ts` | 29 lines | Explicit command family router |
| `external-result-command.ts` | 106 lines | Manual completion, block, and failure result commands |
| `non-external-command.ts` | 71 lines | Resume, approval, retry, cancel, and start commands |
| `terminal-state.ts` | 7 lines | Completed graph detection |
| `types.ts` | 36 lines | Builder input and dispatch resolution types |

The old file path was not kept as a compatibility layer. The only internal
caller, `task-plan-execution.ts`, now imports the focused builder directly.

Verification after the advance dispatch split:

- GitNexus pre-edit impact for `buildAdvanceDispatchCommand` reported low risk,
  1 direct caller, and affected processes `advancePlanExecution` and
  `resolveCheckpointTransition`.
- `bun run typecheck` passed.
- Targeted Bun tests for `plan-execution`, `runtime-sync`, and `orchestration`
  passed: 77 tests.

### Sync Runtime Result Split

`packages/engine/src/modules/plan-execution/use-cases/sync-runtime-result.ts`
was removed. Runtime result sync now lives in focused modules under
`packages/engine/src/modules/plan-execution/use-cases/sync-runtime-result/`:

| Module | Size | Role |
| --- | ---: | --- |
| `sync-plan-run-runtime-result.ts` | 143 lines | Public sync use case and orchestration |
| `attempts.ts` | 22 lines | Runtime run reference lookup in running attempts |
| `external-result.ts` | 49 lines | External runtime completion/cancellation/failure result mapping |
| `mark-task-completed.ts` | 16 lines | Fallback task completion persistence |
| `pause-synced-execution.ts` | 45 lines | Paused/failed synced execution persistence |
| `types.ts` | 9 lines | Local sync runtime helper types |

The old file path was not kept as a compatibility layer. The public
`task-plan-execution.ts` barrel now exports the focused use case directly.

Verification after the sync runtime result split:

- GitNexus pre-edit impact for `syncPlanRunRuntimeResult` reported low risk and
  no affected processes.
- `bun run typecheck` passed.
- Targeted Bun tests for `plan-execution`, `runtime-sync`, and `orchestration`
  passed: 77 tests.

### Checkpoint Transition Split

`packages/engine/src/modules/plan-execution/use-cases/resolve-checkpoint-transition.ts`
was removed. Checkpoint transition handling now lives in focused modules under
`packages/engine/src/modules/plan-execution/use-cases/checkpoint-transition/`:

| Module | Size | Role |
| --- | ---: | --- |
| `resolve-checkpoint-transition.ts` | 39 lines | Public transition dispatcher |
| `continue-next-ready.ts` | 17 lines | Approval continuation transition |
| `resume-current-node.ts` | 29 lines | User input/current node resume transition |
| `rerun-current-node.ts` | 25 lines | Retry current node transition |
| `mark-current-completed.ts` | 27 lines | Manual completion transition |
| `fail-task.ts` | 25 lines | Current node failure transition |
| `cancel-session.ts` | 20 lines | Session cancellation transition |
| `stay-paused.ts` | 50 lines | Rejection and paused response projection |
| `dispatch-action.ts` | 18 lines | Shared execution action dispatch bridge |
| `observer.ts` | 9 lines | Observer callback projection |
| `node.ts` | 9 lines | Required checkpoint node lookup |
| `types.ts` | 61 lines | Transition handler contracts |

The old file path was not kept as a compatibility layer. The internal caller in
`task-plan-execution.ts` imports the focused dispatcher directly.

Verification after the checkpoint transition split:

- GitNexus pre-edit impact for `resolveCheckpointTransition` reported low risk,
  1 direct caller, and affected process `submitCheckpointAction`.
- `bun run typecheck` passed.
- Targeted Bun tests for `plan-execution`, `runtime-sync`, and `orchestration`
  passed: 77 tests.
- `bun run test` passed: 47 files, 285 tests.
- `bun run lint` passed with 0 errors and 729 warnings.

### Contract Runtime Split

`packages/contracts/src/ai-plan-runtime.ts` was removed. Runtime contracts now
live in focused modules under `packages/contracts/src/plan-runtime/`:

- `index.ts` is only a barrel.
- `node.ts` owns node definitions, configs, runtime input, and review types.
- `node-result.ts` owns node output, evidence, artifact refs, and results.
- `attempts.ts` owns execution context snapshots and attempt types.
- `graph.ts` owns compiled, mutable, layered, and effective graph types.
- `execution-state.ts` owns runtime statuses, plan runs, read models, and
  execution sessions.
- `commands.ts` owns runtime commands, graph mutation requests, and task update
  proposals.
- `checkpoints.ts` owns checkpoint response, action, transition, and submit
  types.
- `events.ts` owns execution and plan-generation SSE events.
- `context.ts` owns plan generation and task workspace chat request/response
  types.

Module sizes after the split:

| Module | Size | Exports |
| --- | ---: | ---: |
| `attempts.ts` | 54 lines | 3 |
| `checkpoints.ts` | 92 lines | 10 |
| `commands.ts` | 134 lines | 6 |
| `context.ts` | 66 lines | 4 |
| `events.ts` | 156 lines | 12 |
| `execution-state.ts` | 348 lines | 24 |
| `graph.ts` | 333 lines | 24 |
| `index.ts` | 10 lines | 9 |
| `node-result.ts` | 81 lines | 4 |
| `node.ts` | 187 lines | 19 |

Old compatibility surface intentionally removed:

- `TaskPlanGraphResponse` was deleted.
- `EffectivePlanGraph.planId` was deleted from contracts.
- `ExecutionSession.planId` was deleted from contracts.
- `EffectivePlanGraph.planId` was deleted from graph runtime.
- `NodeExecutorInput.planId` was deleted; executors use `plan.graphId` when the
  graph identity is needed.

Verification after the contract split:

- `bun run typecheck` passed.
- Targeted Bun tests for contracts, `plan-execution`, `runtime-sync`, and
  `orchestration` passed.
- `bun run lint` had 0 errors. Warning baseline remains 736 warnings.
- `bun run test` passed: 47 files, 285 tests.
- `gitnexus_detect_changes(scope: "all")` reported low risk, 19 changed files,
  1 indexed touched symbol, and no affected processes.

## Remaining Debt In `plan-execution`

The core file has been fixed, but the directory is not fully optimized yet.

Current largest non-test files in `packages/engine/src/modules/plan-execution`:

| File | Approx. lines | Remaining issue |
| --- | ---: | --- |
| `task-plan-execution.ts` | 670 | Better, but still a public use-case aggregation point |
| `ai-runtime-invoker.ts` | 398 | AI runtime invocation boundary still thick |
| `execution-state-machine.ts` | 256 | Pure logic, acceptable but switch-heavy |
| `plan-run-store.ts` | 254 | Persistence conversion still dense |
| `execution-checkpoint.ts` | 245 | Checkpoint derivation still dense |
| `use-cases/execution-lifecycle.ts` | 239 | Acceptable use-case module, but can be split if it grows |
| `use-cases/advance-outcome.ts` | 208 | Acceptable now, but can be split by outcome status |

Recommended next `plan-execution` cleanup:

1. Completed: split `resolve-checkpoint-transition.ts` into transition handlers:
   `continue-next-ready`, `resume-current-node`, `rerun-current-node`,
   `mark-current-completed`, `fail-task`, `cancel-session`, `stay-paused`.
2. Completed: split `sync-runtime-result.ts` into attempt lookup,
   external-result mapping, completion handling, and paused/failed handling.
3. Completed: split `advance-dispatch-command.ts` into external result commands
   and resume/retry/cancel/start commands.
4. Split `runtime-event-store.ts` by event type if runtime event persistence grows
   further.

## Remaining Original Hotspots Outside `plan-execution`

These were part of the original diagnosis and are not yet solved.

| File | Approx. lines | Why it matters |
| --- | ---: | --- |
| `packages/contracts/src/ai-feature-specs.ts` | 984 | Contract/spec definitions are too broad |
| `apps/server/src/__tests__/api/plan-execution-fixtures.ts` | 817 | API fixtures are too large and shared across too many behaviors |
| `packages/engine/src/services/agent-tool-operations.service.ts` | 679 | Service layer still combines tool orchestration concerns |
| `packages/engine/src/modules/pages/work-page/builders.ts` | 668 | Work page view-model construction is oversized |
| `packages/engine/src/modules/ai/streaming.ts` | 587 | Streaming/event normalization remains dense |
| `packages/engine/src/modules/ai/providers.ts` | 528 | Provider registry and provider behavior remain concentrated |
| `apps/server/src/routes/tasks/plan.routes.ts` | 527 | Route layer likely still mixes HTTP, validation, and orchestration |
| `packages/engine/src/modules/runtime-sync/sync-run.ts` | 429 | Runtime sync is still a medium-sized orchestration module |

## Optimal Follow-Up Design

Do not rebuild compatibility layers for old internal organization. The goal is
clear ownership and smaller state boundaries.

### 1. Split Contracts First

Status: complete.

Original priority file: `packages/contracts/src/ai-plan-runtime.ts`.

Target structure:

```text
packages/contracts/src/plan-runtime/
  index.ts
  graph.ts
  node.ts
  node-result.ts
  attempts.ts
  events.ts
  checkpoints.ts
  execution-state.ts
  commands.ts
  context.ts
```

Rules:

- Keep contracts pure: no runtime, DB, or engine imports.
- Export domain concepts from focused files.
- Use `index.ts` only as a barrel.
- Prefer types grouped by lifecycle: definition, runtime state, command, event,
  result, checkpoint.

### 2. Split Graph Runtime

Status: complete.

Original priority file: `packages/graph-runtime/src/graph-runner.ts`.

Target structure:

```text
packages/graph-runtime/src/
  execution/run-graph-execution.ts
  execution/state-updates.ts
  execution/result-normalization.ts
  commands/validate-command.ts
  commands/approve-current-node.ts
  commands/retry-node.ts
  commands/cancel-session.ts
  commands/sync-external-result.ts
  registry/executor-registry.ts
  runtime/create-graph-runtime.ts
  status.ts
  evidence.ts
```

Rules:

- `runGraphExecution` should only run the graph loop.
- Runtime command reducers should be independent modules.
- Validation should be separate from mutation.
- `createGraphRuntime` should be a facade over command modules and the graph
  execution loop.

Completed structure:

| File | Lines | Role |
| --- | ---: | --- |
| `packages/graph-runtime/src/execution/run-graph-execution.ts` | 282 | Graph execution loop only |
| `packages/graph-runtime/src/execution/result-normalization.ts` | 215 | Node result normalization and pause/event helpers |
| `packages/graph-runtime/src/execution/types.ts` | 202 | Execution state, event, callback, and executor contracts |
| `packages/graph-runtime/src/commands/state-updates.ts` | 215 | Pure state reducers for approval/retry/cancel/external sync |
| `packages/graph-runtime/src/commands/types.ts` | 109 | Runtime command and facade contracts |
| `packages/graph-runtime/src/commands/validate-command.ts` | 48 | Graph validation gate for runtime commands |
| `packages/graph-runtime/src/commands/approve-current-node.ts` | 52 | Approval command orchestration |
| `packages/graph-runtime/src/commands/retry-node.ts` | 51 | Retry command orchestration |
| `packages/graph-runtime/src/commands/cancel-session.ts` | 26 | Cancel command orchestration |
| `packages/graph-runtime/src/commands/apply-mutation.ts` | 51 | Mutation command orchestration |
| `packages/graph-runtime/src/commands/sync-external-result.ts` | 74 | External result sync command orchestration |
| `packages/graph-runtime/src/registry/executor-registry.ts` | 24 | Executor lookup and callback fallback |
| `packages/graph-runtime/src/runtime/create-graph-runtime.ts` | 101 | Runtime facade and command dispatch |
| `packages/graph-runtime/src/status.ts` | 28 | Runtime status mapping |
| `packages/graph-runtime/src/evidence.ts` | 27 | Runtime evidence normalization |

Removed old surface:

- Deleted `packages/graph-runtime/src/graph-runner.ts` instead of keeping a
  compatibility re-export.
- Updated direct imports in `index.ts`, `invalidation.ts`, and
  `builtin-nodes.ts` to target focused modules.

Verification:

- GitNexus pre-edit impact for `graph-runner.ts`: LOW risk, 3 direct importers,
  2 test dependents, no affected processes.
- `bun run typecheck` passed.
- `bun test packages/graph-runtime/src/graph-runtime.bun.test.ts packages/graph-runtime/src/resolve-state-semantics.bun.test.ts`
  passed: 24 tests, 0 failed.
- `bun run lint` passed with existing warning baseline plus expected remaining
  graph runtime complexity warnings for next internal execution-loop cleanup.
- `bun run test` passed: 47 files, 285 tests.
- `gitnexus_detect_changes({ scope: "all" })`: LOW risk, no affected processes.

### 3. Finish `plan-execution` Internal Cleanup

After contracts and graph runtime are stable, finish smaller splits in
`plan-execution`:

- Keep checkpoint transitions as focused handler functions.
- Keep sync runtime result outcome persistence in focused handler modules.
- Keep `task-plan-execution.ts` as the composition root for public use cases.
- Avoid adding DB writes back into runtime or projection modules.

### 4. Reduce Test Fixture Weight

Status: in progress.

Completed first priority file:

`packages/graph-runtime/src/graph-runtime.bun.test.ts` was removed. Graph
runtime regression tests now live in focused behavior files:

| File | Lines | Tests | Role |
| --- | ---: | ---: | --- |
| `graph-runtime.execution.bun.test.ts` | 286 | 5 | Execution loop, async starts, external result sync, concurrency |
| `graph-runtime.dispatch.bun.test.ts` | 284 | 7 | Runtime dispatch facade commands and validation gate |
| `graph-runtime.mutation.bun.test.ts` | 221 | 4 | Mutation dispatch, subgraph replacement, invalidation, structural impact |
| `graph-runtime.selection.bun.test.ts` | 108 | 3 | Branch selection, edge semantics, ready-node selection |
| `graph-runtime.validation.bun.test.ts` | 133 | 3 | Graph invariant, branch target, and cyclic component validation |
| `graph-runtime.test-fixtures.ts` | 154 | 0 | Shared graph scenario builders |

The old test file path was not kept. The split keeps test files behavior-scoped
instead of using a compatibility wrapper or a mega fixture file.

Verification after the graph runtime test split:

- GitNexus could not resolve the old test file as an indexed target and returned
  UNKNOWN/no impacted symbols; this was test-only restructuring.
- `bun run typecheck` passed.
- `bun test packages/graph-runtime/src` passed: 24 tests, 0 failed.
- `bun run test` passed: 47 files, 285 tests.
- `bun run lint` passed with 0 errors and 731 warnings.

Completed second priority file:

`packages/engine/src/modules/plan-execution/plan-runner.task-executor.bun.test.ts`
was removed. Plan-runner task-executor scenarios now live in focused behavior
files with shared setup in one fixture module:

| File | Lines | Tests | Role |
| --- | ---: | ---: | --- |
| `plan-runner.task-executor.approval.bun.test.ts` | 246 | 4 | Approval wait, approval resume/reject, and replan-required review state |
| `plan-runner.task-executor.external-results.bun.test.ts` | 277 | 4 | External completion/block races, runtime failure details, late results |
| `plan-runner.task-executor.runtime-events.bun.test.ts` | 77 | 1 | Runtime event forwarding from task node execution |
| `plan-runner.task-executor.continuation.bun.test.ts` | 70 | 1 | Terminal node result submission before downstream continuation |
| `plan-runner.task-executor.full-chain.bun.test.ts` | 139 | 1 | End-to-end task, condition, checkpoint, wait, and final task chain |
| `plan-runner.task-executor.fixtures.ts` | 280 | 0 | Shared DB reset, capability mocks, seed helpers, and compiled plan builders |

The old test file path was not kept. The split keeps approval, runtime events,
external-result races, continuation, and full-chain behavior isolated instead of
using one 1000-line integration test.

Verification after the plan-runner task-executor test split:

- GitNexus could not resolve the old test file as an indexed target and returned
  UNKNOWN/no impacted symbols; this was test-only restructuring.
- `bun run typecheck` passed.
- Targeted Bun tests for `plan-execution`, `runtime-sync`, and `orchestration`
  passed: 77 tests.
- `bun run test` passed: 47 files, 285 tests.
- `bun run lint` passed with 0 errors and 732 warnings.

Priority files:

- `apps/server/src/__tests__/api/plan-execution-fixtures.ts`

Target structure:

```text
test-fixtures/
  graph-scenarios.ts
  execution-sessions.ts
  runtime-results.ts
  api-plan-fixtures.ts
```

Rules:

- Scenario builders should be composable and named by behavior.
- Tests should read as behavior specs, not fixture construction scripts.
- Avoid one mega fixture file used by unrelated flows.

### 5. Move HTTP Routes Back To Thin Adapters

Priority file: `apps/server/src/routes/tasks/plan.routes.ts`.

Rules:

- Route files should only parse HTTP input, call engine use cases, and map
  output/errors to HTTP responses.
- No plan execution branching logic should live in route files.
- If route logic needs more than validation and response mapping, create an
  engine use case.

### 6. Split AI Provider And Streaming Boundaries

Priority files:

- `packages/engine/src/modules/ai/streaming.ts`
- `packages/engine/src/modules/ai/providers.ts`
- `packages/engine/src/services/agent-tool-operations.service.ts`

Rules:

- Provider selection, provider invocation, stream normalization, and tool
  operation orchestration should be separate modules.
- Streaming modules should normalize events, not own business decisions.
- Service modules should orchestrate use cases, not implement provider-specific
  protocols inline.

## Recommended Order

1. Completed: `packages/contracts/src/ai-plan-runtime.ts` split into
   `packages/contracts/src/plan-runtime/`.
2. Completed: `packages/graph-runtime/src/graph-runner.ts` split into focused
   graph runtime modules.
3. Completed: `plan-execution` checkpoint/advance/runtime-sync use-case splits
4. In progress: API plan execution fixtures
5. `apps/server/src/routes/tasks/plan.routes.ts`
6. AI provider/streaming/tool operation modules

## Required Safety Checks For Future Work

Before editing core execution symbols:

- Run GitNexus impact analysis on the target symbol.
- If the index is stale, run `npx gitnexus analyze` first when feasible.
- Warn before proceeding if impact is HIGH or CRITICAL.

After editing:

- Run `bun run typecheck`.
- Run targeted Bun tests for the affected execution area.
- Run `bun run test` before finalizing broad refactors.
- Run `gitnexus_detect_changes({ scope: "all" })` before commit or final handoff.

For task execution specifically, run at minimum:

```bash
bun test packages/engine/src/modules/plan-execution packages/engine/src/modules/runtime-sync packages/engine/src/modules/orchestration
bun test apps/server/src/__tests__/api/task-workflow.bun.test.ts apps/server/src/__tests__/api/plan-execution-output.bun.test.ts
```

## Current Decision

The plan-execution refactor solved the most dangerous internal engine hotspot.
The contract split solved the largest shared type hotspot without preserving old
compatibility aliases. The graph runtime split removed the next largest runtime
monolith and made execution behavior, command reducers, validation, executor
registry, status, evidence, and facade code independently understandable. The
advance dispatch, sync runtime result, and checkpoint transition splits removed
the remaining high-value plan-execution use-case monoliths. The graph runtime
and plan-runner task-executor test splits removed the two largest execution test
fixture monoliths. The next optimal move is reducing the remaining API plan
execution fixture before returning to medium-sized production modules.
