# Quickstart

## Purpose

Use this guide to repeat the brownfield discovery work for Chrona's plan-execution area without changing runtime behavior.

## Read Order

1. Read `specs/001-plan-execution-orchestration/spec.md`.
2. Read `specs/001-plan-execution-orchestration/plan.md`.
3. Read `specs/001-plan-execution-orchestration/research.md`.
4. Read `specs/001-plan-execution-orchestration/data-model.md`.
5. Read `specs/001-plan-execution-orchestration/contracts/current-api-surfaces.md`.

## Key Source Files

### Server and routes

- `apps/server/src/index.bun.ts`
- `apps/server/src/app.ts`
- `apps/server/src/routes/api.ts`
- `apps/server/src/routes/tasks.routes.ts`
- `apps/server/src/routes/plans.routes.ts`
- `apps/server/src/routes/execution.routes.ts`

### Runtime modules

- `packages/runtime/src/modules/commands/create-task.ts`
- `packages/runtime/src/modules/commands/generate-task-plan-for-task.ts`
- `packages/runtime/src/modules/commands/apply-schedule.ts`
- `packages/runtime/src/modules/commands/auto-start-scheduled-plan.ts`
- `packages/runtime/src/modules/plan-execution/orchestrator.ts`
- `packages/runtime/src/modules/runtime-sync/sync-run.ts`
- `packages/runtime/src/modules/tasks/task-plan-graph-store.ts`
- `packages/runtime/src/modules/queries/get-schedule-page.ts`
- `packages/runtime/src/modules/queries/work-page/get-work-page.ts`

### Contracts and persistence

- `packages/contracts/src/ai.ts`
- `packages/common/runtime-core/src/contracts.ts`
- `prisma/schema.prisma`

## Useful Validation Commands

These commands are for discovery and future implementation validation. This planning step does not require behavior-changing code.

```bash
bun run typecheck
bun run lint
bun run test
bun run test:api
bun run test:bun
```

## Brownfield Checks

1. Confirm whether the behavior is task-centric, plan-centric, schedule-centric, or provider-run-centric.
2. Confirm whether the source of truth lives in Prisma tables, projections, or serialized plan graphs in `Memory`.
3. Confirm whether a concept already exists explicitly or is only implied by naming in the UI.
4. Confirm whether a route or module is provider-neutral or still OpenClaw-specific.
5. Confirm whether a workflow uses task-level state, node-level state, or run-level state before proposing changes.

## What To Preserve In Future Implementation

1. Existing plan generation and review value.
2. Task-level scheduling behavior already used by the schedule page.
3. Accepted-plan execution behavior that already advances ready nodes.
4. Current waiting-for-input and waiting-for-approval intervention flows.
5. Projection-backed task and work visibility for the UI.

## Highest-Priority Follow-Up Work

1. Introduce first-class `WorkBlock` modeling.
2. Introduce first-class `ExecutionSession` modeling.
3. Remove remaining OpenClaw leakage from route/runtime orchestration paths.
4. Clarify the public contract for final step-result review.
5. Decide how plan persistence should evolve beyond the current `Memory`-backed graph store.
