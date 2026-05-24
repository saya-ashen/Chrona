# Execution Entrypoints To Gate

## Manual And Continuation Entrypoints

- `packages/engine/src/modules/plan-execution/task-plan-execution.ts`
- Main start/advance path via `startPlanExecution` and `continuePlanExecution`.
- Runtime command dispatch path through `dispatch-runtime-command-action.ts`.

## Runtime Callback Entrypoints

- `packages/engine/src/modules/plan-execution/use-cases/sync-runtime-result/sync-plan-run-runtime-result.ts`
- External runtime completion sync can mutate graph state and trigger downstream continuation.
- `packages/engine/src/modules/plan-execution/use-cases/submit-terminal-node-result.ts`
- Terminal result submission can continue execution after provider work completes.

## Scheduler Entrypoint

- `packages/engine/src/modules/orchestration/graph-advancement-worker.ts`
- Worker selects queued/running tasks and calls `taskPlanExecution.start`.

## Graph Runtime Entrypoints

- `packages/graph-runtime/src/execution/run-graph-execution.ts`
- `packages/graph-runtime/src/resolve.ts`
- These paths decide which ready node executes next and must observe active attempts/results.

## Persistence Entrypoints

- `packages/engine/src/modules/plan-execution/plan-run-store.ts`
- `packages/engine/src/modules/plan-execution/persistence/plan-runtime-store.ts`
- `packages/engine/src/modules/plan-execution/persistence/execution-session-store.ts`
- These paths need authoritative execution ownership, attempts, results, and event persistence semantics.
