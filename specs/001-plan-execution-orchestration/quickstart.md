# Quickstart

## Purpose

Use this guide to repeat the brownfield discovery work for Chrona's plan-execution area without changing runtime behavior.

## Read Order

1. Read `specs/001-plan-execution-orchestration/spec.md`.
2. Read `specs/001-plan-execution-orchestration/plan.md`.
3. Read `specs/001-plan-execution-orchestration/execution-architecture.md`.
4. Read `specs/001-plan-execution-orchestration/research.md`.
5. Read `specs/001-plan-execution-orchestration/data-model.md`.
6. Read `specs/001-plan-execution-orchestration/contracts/current-api-surfaces.md`.
7. Read `specs/001-plan-execution-orchestration/contracts/task-workspace-execution-console.md` before implementing the task workspace redesign.

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

### Task workspace redesign

- `docs/assets/设计参考.png`
- `apps/web/src/components/tasks/task-workspace-page.tsx`
- `apps/web/src/components/tasks/task-workspace-header-card.tsx`
- `apps/web/src/components/tasks/task-workspace-plan-section.tsx`
- `apps/web/src/components/tasks/task-workspace-plan-content.tsx`
- `apps/web/src/components/tasks/task-workspace-ai-section.tsx`
- `apps/web/src/components/tasks/task-workspace-types.ts`
- `apps/web/src/components/task/panels/task-plan-graph-panel.tsx`
- `apps/web/src/components/task/plan/task-plan-graph/inspector.tsx`
- `apps/web/src/components/task/plan/task-plan-graph/inspector-details.tsx`
- `apps/web/src/components/task/plan/task-plan-graph/inspector-run-panel.tsx`

## Useful Validation Commands

These commands are for discovery and future implementation validation. This planning step does not require behavior-changing code.

```bash
bun run typecheck
bun run lint
bun run test
bun run test:api
bun run test:bun
```

### Baseline Validation Snapshot

Recorded during implementation setup on `main` after the Spec Kit prerequisite branch check was bypassed by user choice:

- `bun run typecheck`: PASS.
- `bun run lint`: PASS with existing warnings only (`612 problems`, `0 errors`, `612 warnings`).
- `bun run test`: PASS (`37` test files, `186` tests).
- `bun run test:api`: PASS.
- `bun run test:bun`: FAIL before feature implementation. Output shows Prisma missing-record errors in existing Bun suites such as `apps/server/src/__tests__/api/ai-client-crud.bun.test.ts`, `packages/engine/src/modules/tasks/get-task-page.ts`, `packages/engine/src/modules/scheduling/propose-schedule.ts`, `packages/engine/src/modules/scheduling/decide-schedule-proposal.ts`, `packages/engine/src/modules/tasks/update-task.ts`, and `packages/engine/src/modules/plan-execution/compiled-plan-store.ts`; later suites still report `0 fail`, but the script exits with code `1`.

For the task workspace redesign increment, run targeted validation before the full suite when iterating:

```bash
bun run test -- apps/web/src/components/task/plan/task-plan-graph.test.tsx
bun run test -- apps/web/src/components/work/task-plan-side-panel.test.tsx
bun run test -- apps/web/src/components/tasks
```

Note: the graph and side-panel tests use Vitest mocks, so run them through `bun run test -- ...` rather than Bun's native `bun test` runner.

## Brownfield Checks

1. Confirm whether the behavior is task-centric, plan-centric, schedule-centric, or provider-run-centric.
2. Confirm whether the source of truth lives in Prisma tables, projections, or serialized plan graphs in `Memory`.
3. Confirm whether a concept already exists explicitly or is only implied by naming in the UI.
4. Confirm whether a route or module is provider-neutral or still OpenClaw-specific.
5. Confirm whether a workflow uses task-level state, node-level state, or run-level state before proposing changes.
6. For task workspace UI work, confirm whether each visible card has reliable existing data before deciding no API is needed.

## What To Preserve In Future Implementation

1. Existing plan generation and review value.
2. The target design boundary in `execution-architecture.md`, especially source-of-truth ownership.
3. Accepted-plan execution behavior that already advances ready nodes.
4. Current waiting-for-input and waiting-for-approval intervention flows.
5. Projection-backed task and work visibility for the UI.
6. Current task workspace AI panel, task editing, graph selection, plan acceptance, and execution dispatch behavior during visual redesign.

## Highest-Priority Follow-Up Work

1. Introduce first-class `WorkBlock` modeling.
2. Introduce first-class `ExecutionSession` modeling.
3. Remove remaining OpenClaw leakage from route/runtime orchestration paths.
4. Clarify the public contract for final step-result review.
5. Decide how plan persistence should evolve beyond the current `Memory`-backed graph store.
6. Implement the task workspace execution-console layout using the UI contract in `contracts/task-workspace-execution-console.md`.

## Task Workspace Redesign Manual Checks

1. Open a task with no generated plan and verify the empty graph state plus generate-plan action.
2. Open a task with an accepted plan and verify the top progress header, central graph, lower node details, right overview cards, and AI workspace entry.
3. Select completed, active, waiting, and blocked nodes and verify the lower detail panel and right overview update consistently.
4. Resize below `xl` width and verify all cards stack without unreachable content.
5. Confirm the page does not render duplicate global navigation inside the task content area.
6. For every reference-inspired card, record whether it uses existing data or requires a new/expanded read API.
7. If a new API is added, verify its empty, loading, error, and populated states with automated tests.

### Implementation Evidence Snapshot

Recorded after the execution-console implementation on `main`:

- No-plan state: covered by `apps/web/src/components/tasks/task-workspace-page.test.tsx`; header shows `No plan yet`, current node is empty, and plan generation remains available.
- Accepted-plan state: covered by `apps/web/src/components/tasks/task-workspace-page.test.tsx`; header progress reaches `100% complete`, and accepted plan status remains reviewable.
- Running/current work state: covered by `apps/web/src/components/tasks/task-workspace-query.test.ts`; readiness maps active nodes and latest run summary into the console cards.
- Blocked/needs-handling state: covered by `apps/web/src/components/tasks/task-workspace-query.test.ts`; blocked task reasons, waiting nodes, and pending approvals map to warning/critical cards.
- Artifact state: covered by `apps/web/src/components/tasks/task-workspace-query.test.ts`; node outputs and task artifacts feed the artifacts card.
- Responsive layout: implemented in `apps/web/src/components/tasks/task-workspace-plan-section.tsx` using stacked default layout and `xl` graph/overview grid regions.
- Accessibility/focus: right overview card actions are keyboard-focusable buttons and scroll to `#task-workspace-node-actions`, preserving existing inspector controls for approval, input, message, retry, and result actions.
- Reduced-motion risk: only the pre-existing smooth scroll in card actions was added; no persistent animation or auto-playing motion was introduced in the workspace layout.

### Final Validation Snapshot

Recorded after `T046` and polish tasks:

- `bun run typecheck`: PASS.
- `bun run lint`: PASS with existing warnings only (`625 problems`, `0 errors`, `625 warnings`).
- `bun run test`: PASS (`39` test files, `202` tests).
- `bun run test:api`: PASS. Prisma missing-record diagnostics still appear in stderr during negative-path tests, but the script exits `0`.
- `bun run test:bun`: FAIL, pre-existing Prisma/runtime failures remain; script exits `1` after suites that individually report pass counts.
- `bun run test -- apps/web/src/components/task/plan/task-plan-graph.test.tsx`: PASS (`1` file, `7` tests).
- `bun run test -- apps/web/src/components/work/task-plan-side-panel.test.tsx`: PASS (`1` file, `1` test).
- `bun run test -- apps/web/src/components/tasks`: PASS (`2` files, `14` tests).
- `bun test apps/server/src/__tests__/api/task-workspace-console.bun.test.ts`: PASS (`2` tests).

## Task Workspace API Evidence

- Top progress header: existing plan-state graph data.
- Current node detail: existing graph selection/current-node data.
- Latest result card: existing node result/completion summary with latest run summary fallback.
- Needs handling card: existing approvals, task block reason, and waiting/blocked graph node state.
- Artifacts card: existing node outputs plus task artifacts.
- Execution activity card: existing latest run summary plus graph node statuses for MVP.
- Console card actions: existing inspector/run-panel mutations; right-side cards focus the node action panel instead of dispatching separate mutations.
- New API required for first increment: no. Future event-timeline, normalized latest-result, action metadata, or node-attributed artifact APIs remain allowed if later UI scope requires them.
- Performance decision: no extra task workspace network round trips were added; `fetchTaskWorkspaceTask`, `fetchTaskPlanState`, and existing execution SSE dispatch remain the only client data/action paths used by the redesigned console.
