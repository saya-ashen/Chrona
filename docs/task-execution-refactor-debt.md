# Task Execution Refactor Debt

> Status captured after the task execution refactor on 2026-05-21.
> Purpose: preserve the diagnosis and optimal follow-up design across new AI
> sessions.

## Summary

The original diagnosis was correct: task execution failures were caused less by a
single bug and more by oversized files, mixed responsibilities, and unclear state
boundaries.

The largest root cause in `plan-execution` has been addressed. The rest of the
execution system still has architecture debt, especially in contracts and graph
runtime.

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
- Advance command construction moved to `runtime/advance-dispatch-command.ts`.
- Runtime outcome helpers moved to `runtime/runtime-outcome.ts`.
- Terminal command validation moved to `runtime/terminal-command.ts`.
- Execution lifecycle handling moved to `use-cases/execution-lifecycle.ts`.
- Advance outcome handling moved to `use-cases/advance-outcome.ts`.
- Runtime command action dispatch moved to
  `use-cases/dispatch-runtime-command-action.ts`.
- Current execution lookup moved to `use-cases/get-current-execution.ts`.
- Checkpoint transition handling moved to
  `use-cases/resolve-checkpoint-transition.ts`.
- Terminal node result submission moved to
  `use-cases/submit-terminal-node-result.ts`.
- Runtime result sync moved to `use-cases/sync-runtime-result.ts`.

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

## Remaining Debt In `plan-execution`

The core file has been fixed, but the directory is not fully optimized yet.

Current largest non-test files in `packages/engine/src/modules/plan-execution`:

| File | Approx. lines | Remaining issue |
| --- | ---: | --- |
| `task-plan-execution.ts` | 670 | Better, but still a public use-case aggregation point |
| `ai-runtime-invoker.ts` | 398 | AI runtime invocation boundary still thick |
| `runtime/advance-dispatch-command.ts` | 319 | Command construction can be split by command family |
| `use-cases/sync-runtime-result.ts` | 263 | Runtime result sync still has several persistence outcomes |
| `execution-state-machine.ts` | 256 | Pure logic, acceptable but switch-heavy |
| `plan-run-store.ts` | 254 | Persistence conversion still dense |
| `execution-checkpoint.ts` | 245 | Checkpoint derivation still dense |
| `use-cases/execution-lifecycle.ts` | 239 | Acceptable use-case module, but can be split if it grows |
| `use-cases/resolve-checkpoint-transition.ts` | 239 | Still has lint complexity warnings |
| `use-cases/advance-outcome.ts` | 208 | Acceptable now, but can be split by outcome status |

Recommended next `plan-execution` cleanup:

1. Split `resolve-checkpoint-transition.ts` into transition handlers:
   `continue-next-ready`, `resume-current-node`, `rerun-current-node`,
   `mark-current-completed`, `fail-task`, `cancel-session`, `stay-paused`.
2. Split `sync-runtime-result.ts` into external-result construction, runtime
   dispatch, completion handling, running handling, and paused/failed handling.
3. Split `advance-dispatch-command.ts` into external result commands and
   resume/retry/cancel/start commands.
4. Split `runtime-event-store.ts` by event type if runtime event persistence grows
   further.

## Remaining Original Hotspots Outside `plan-execution`

These were part of the original diagnosis and are not yet solved.

| File | Approx. lines | Why it matters |
| --- | ---: | --- |
| `packages/contracts/src/ai-plan-runtime.ts` | 1471 | Largest unresolved hotspot; 100+ exports in one contract file |
| `packages/graph-runtime/src/graph-runner.ts` | 1369 | Pure runtime, but mixes execution loop, validation, commands, reducers, facade |
| `packages/graph-runtime/src/graph-runtime.bun.test.ts` | 1142 | Runtime regression tests are too large |
| `packages/engine/src/modules/plan-execution/plan-runner.task-executor.bun.test.ts` | 1003 | Execution test scenarios are dense and hard to navigate |
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

Priority file: `packages/contracts/src/ai-plan-runtime.ts`.

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

Priority file: `packages/graph-runtime/src/graph-runner.ts`.

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

### 3. Finish `plan-execution` Internal Cleanup

After contracts and graph runtime are stable, finish smaller splits in
`plan-execution`:

- Turn checkpoint transitions into handler functions.
- Turn sync runtime result outcomes into handler functions.
- Keep `task-plan-execution.ts` as the composition root for public use cases.
- Avoid adding DB writes back into runtime or projection modules.

### 4. Reduce Test Fixture Weight

Priority files:

- `packages/graph-runtime/src/graph-runtime.bun.test.ts`
- `packages/engine/src/modules/plan-execution/plan-runner.task-executor.bun.test.ts`
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

1. `packages/contracts/src/ai-plan-runtime.ts`
2. `packages/graph-runtime/src/graph-runner.ts`
3. `plan-execution` remaining use-case hotspots
4. Runtime and plan execution test fixtures
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
The next optimal move is not more facade work in `task-plan-execution.ts`; it is
splitting the shared runtime contracts and graph runtime so execution behavior,
types, and reducers are independently understandable.
