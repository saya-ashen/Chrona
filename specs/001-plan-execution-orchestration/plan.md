# Implementation Plan: Plan Execution Orchestration

**Branch**: `[001-plan-execution-orchestration]` | **Date**: 2026-05-03 | **Spec**: `specs/001-plan-execution-orchestration/spec.md`
**Input**: Feature specification from `specs/001-plan-execution-orchestration/spec.md`

## Summary

This brownfield planning step documents how the current Chrona codebase already supports `Task -> Plan -> Schedule -> Execution`, where the architecture diverges from the target execution-layer product model, and which design improvements should be prioritized before implementation. This step is documentation-only: no production code, runtime behavior, or feature implementation is included.

## Technical Context

**Language/Version**: TypeScript strict, React 19.2, Hono 4.x, Bun 1.3.11  
**Primary Dependencies**: React Router 7, Prisma 7, SQLite, Zod 4, Vitest 4, Playwright, OpenClaw bridge integration  
**Storage**: SQLite via Prisma; accepted and draft plan graphs are currently stored in `Memory` records rather than first-class plan tables  
**Testing**: `bun test` helpers, Bun-native tests, Vitest, Playwright, route-level API tests  
**Target Platform**: Bun-hosted local API server plus Vite SPA and CLI on Linux/macOS/Windows  
**Project Type**: Monorepo web application with SPA frontend, local API server, runtime modules, provider integrations, and CLI packaging  
**Performance Goals**: Preserve the spec goals that task/plan execution start either advances the next eligible step(s) or reports the blocking reason within 1 minute for supported sample scenarios; preserve responsive plan review and work visibility for a single-user curated scope  
**Constraints**: Bun-only runtime; no business logic in React components or Hono routes; shared contracts in `packages/contracts`; DB access in `packages/db`; provider-specific code isolated from provider-agnostic runtime; this planning step must not change runtime behavior  
**Scale/Scope**: Single primary user, small curated execution scenarios, task-or-plan-level scheduling in v1, multiple execution backends hidden behind one UX, brownfield discovery based on the existing repository as source of truth

## Constitution Check

*GATE: Passed before Phase 0 research. Re-checked after Phase 1 design and still passed.*

- **Code Quality**: Passed. The plan stays documentation-only and keeps the future implementation boundary centered on `packages/runtime`, `packages/contracts`, `packages/db`, and `apps/server/src/routes/*` as thin adapters.
- **Testing**: Passed. No behavior changes are made in this step. Future implementation validation must cover unit and integration behavior for plan orchestration, schedule/work-block transitions, provider availability failures, and resumable execution. Expected commands for implementation work: `bun run typecheck`, `bun run lint`, `bun run test`, plus targeted `bun run test:api`, `bun run test:bun`, and `bun run test:e2e` where execution UX changes cross route or UI boundaries.
- **User Experience Consistency**: Passed. The plan preserves current task, schedule, and workbench flows as the brownfield baseline while documenting where terminology should converge around task, plan, work block, execution session, and review state.
- **Performance Budgets**: Passed. The future implementation must preserve the spec budget that supported sample scenarios resolve scheduled/manual execution start within 1 minute, avoid unnecessary provider-specific UX round-trips, and keep plan/schedule/work visibility immediate enough for a single-user curated scope.

## Brownfield Findings

### Current Architecture Snapshot

- `apps/server/src/index.bun.ts` boots the Bun server and `apps/server/src/app.ts` mounts the Hono API.
- `apps/server/src/routes/api.ts` composes route modules for tasks, projections, execution, plans, and AI endpoints.
- `packages/runtime/src/modules/commands/` owns task, planning, schedule, and run mutations.
- `packages/runtime/src/modules/queries/` builds read models for task pages, schedule, workbench, and workspace summaries.
- `packages/runtime/src/modules/plan-execution/` contains the accepted-plan orchestration loop that advances ready nodes and pauses on blocked, user-input, or approval conditions.
- `packages/runtime/src/modules/runtime-sync/` synchronizes provider runs back into Chrona state.
- `packages/runtime/src/modules/task-execution/` and `packages/common/runtime-core/src/contracts.ts` already define a provider abstraction layer, but plan execution still leaks OpenClaw-specific assumptions in several paths.

### Product Flow Mapping

- **Task**: `apps/server/src/routes/tasks.routes.ts` and `packages/runtime/src/modules/commands/create-task.ts` create and update tasks.
- **Plan**: `apps/server/src/routes/plans.routes.ts` and `packages/runtime/src/modules/commands/generate-task-plan-for-task.ts` generate and persist task plan graphs.
- **Schedule**: `apps/server/src/routes/execution.routes.ts` schedule endpoints and `packages/runtime/src/modules/commands/apply-schedule.ts` schedule tasks directly through `Task.scheduledStartAt`, `Task.scheduledEndAt`, and `ScheduleProposal`.
- **Execution**: `apps/server/src/routes/execution.routes.ts`, `packages/runtime/src/modules/plan-execution/orchestrator.ts`, and `packages/runtime/src/modules/commands/auto-start-scheduled-plan.ts` start and advance execution for accepted plans.

### OpenClaw Planning Contract

- The canonical plan-generation contract lives in `packages/contracts/src/ai.ts`.
- `AIPlanOutput` is the authoritative provider-facing shape for generated plan graphs and is the canonical payload for the `generate_task_plan_graph` business tool.
- `TaskPlanGraph` is a downstream runtime/storage model derived from `AIPlanOutput`; it is not the canonical provider/tool payload contract.
- Any provider-specific compatibility normalization (for example legacy field names) must remain explicitly transitional and must not redefine the canonical contract.
- Chrona's OpenClaw integration boundary is the provider package layer under `packages/providers/openclaw/*`, with shared runtime/provider foundations under `packages/providers/foundation/*`.
- Chrona sends planning requests to OpenClaw through the OpenResponses-compatible `/v1/responses` API shape.
- `generate_plan` is not allowed to depend on OpenClaw structured-output support. OpenClaw does not provide the required structured-output contract for Chrona's plan graph generation path.
- For `generate_plan`, Chrona must register the `generate_task_plan_graph` function tool and force `tool_choice: "required"`.
- The `generate_task_plan_graph` tool arguments must match the canonical `AIPlanOutput` shape: top-level `title`, `goal`, optional `summary`, `nodes`, `edges`, and optional `completionPolicy`; edges use `{ from, to, label? }`.
- The authoritative machine-readable plan graph must be extracted from `response.output[*]` items where `type === "function_call"` and `name === "generate_task_plan_graph"`, using the parsed `function_call.arguments` payload.
- Assistant free text may still exist for diagnostics or previews, but it is non-authoritative for plan graph extraction and must not be treated as the canonical result channel.
- Session continuity for this integration is carried through `sessionKey`, `previous_response_id`, and follow-up `function_call_output` acknowledgements, not through provider-specific structured-output state.

### Architecture Gaps Against The Target Spec

1. There is no first-class `WorkBlock` or general `CalendarEvent` model; scheduling is task-level only.
2. There is no first-class `ExecutionSession` aggregate tied to a work block or resumable execution window.
3. Accepted plan graphs are stored in `Memory`, which overloads memory storage with plan persistence.
4. Provider abstraction exists, but plan execution and route helpers still couple directly to OpenClaw in places.
5. Human-in-the-loop support exists mainly as run approval/input handling, not as a dedicated per-step review workflow for user-facing results.
6. The codebase currently mixes a run-centric execution model with a newer accepted-plan orchestration model, so canonical execution ownership is not fully settled.

## Phase 0 Research Plan

Phase 0 resolves the planning unknowns by treating the repository as the source of truth and documenting the decisions in `research.md`.

Research focus areas:

1. Confirm the canonical brownfield execution path and where legacy run-centric paths still overlap with plan-centric execution.
2. Confirm how current scheduling behaves, including the absence of a first-class work-block/calendar-event boundary.
3. Confirm where provider abstraction is already strong and where OpenClaw-specific leakage remains.
4. Confirm how plan graphs, session continuity, approvals, artifacts, and projection state are persisted today.
5. Confirm which API surfaces and tests already encode the existing task-plan-schedule-execution workflow.

Phase 0 artifact:

- `specs/001-plan-execution-orchestration/research.md`

## Phase 1 Design Plan

Phase 1 translates the research into brownfield design documentation without implementing feature code.

Design outputs:

1. `data-model.md`: current entities, relationships, state transitions, and target-model gaps for `Plan`, `PlanStep`, `WorkBlock`, `ExecutionSession`, and `ExecutionResult`.
2. `execution-architecture.md`: target execution-layer design, source-of-truth boundaries, unified orchestration model, and replan carry-forward design.
3. `contracts/current-api-surfaces.md`: current plan/schedule/execution API contract inventory and where the public surface does not yet represent the target execution-layer concepts cleanly.
4. `quickstart.md`: repeatable repo-reading workflow, validation commands, and a checklist for future implementation discovery.
5. `AGENTS.md`: update the Speckit marker so future work reads this plan directly.

## Phase 2 Prioritized Improvement Plan

This plan stops before task generation and implementation, but it records the recommended implementation order.

1. **Make accepted-plan orchestration the canonical execution model**
   - Reduce overlap between legacy run-centric flows and `packages/runtime/src/modules/plan-execution/*`.
   - Define which APIs and projections should be sourced from plan execution first.
2. **Introduce first-class work-block modeling**
   - Add an explicit boundary between normal calendar events and actionable work blocks.
   - Keep task-or-plan-level scheduling in v1 while making the triggering model explicit.
3. **Introduce first-class execution-session modeling**
   - Persist resumable execution state independently from provider runs.
   - Track pause reason, current node, linked work block, and continuation metadata.
4. **Finish provider isolation**
   - Move remaining OpenClaw-specific route/runtime dependencies behind the existing runtime adapter contracts.
   - Ensure unavailable capability handling is provider-neutral and user-facing.
5. **Define explicit human review contracts for step results**
   - Separate runtime approvals from product-level review of user-facing or final-deliverable outputs.
   - Standardize accept, reject, and request-changes outcomes at the plan-step level.
6. **Replace plan-in-memory persistence with explicit plan ownership**
   - Either introduce first-class plan persistence or formalize the existing graph store boundary with validation and migration rules.
   - Tighten direct graph mutation flows in the API surface.

## Project Structure

### Documentation (this feature)

```text
specs/001-plan-execution-orchestration/
|-- plan.md
|-- research.md
|-- data-model.md
|-- execution-architecture.md
|-- quickstart.md
|-- contracts/
|   `-- current-api-surfaces.md
`-- tasks.md
```

### Source Code (repository root)

```text
apps/
|-- server/
|   `-- src/
|       |-- app.ts
|       |-- index.bun.ts
|       `-- routes/
|           |-- api.ts
|           |-- execution.routes.ts
|           |-- plans.routes.ts
|           |-- projections.routes.ts
|           `-- tasks.routes.ts
`-- web/
    `-- src/
        |-- components/
        |   |-- schedule/
        |   |-- tasks/
        |   `-- work/
        |-- loaders.ts
        |-- pages.tsx
        `-- router.tsx

packages/
|-- common/
|   |-- ai-features/
|   `-- runtime-core/
|-- contracts/
|-- db/
|-- domain/
|-- providers/
|   |-- hermes/
|   `-- openclaw/
`-- runtime/
    `-- src/modules/
        |-- ai/
        |-- commands/
        |-- plan-execution/
        |-- queries/
        |-- runtime-sync/
        |-- scheduler/
        |-- task-execution/
        `-- tasks/

prisma/
|-- migrations/
|-- schema.prisma
`-- seed.ts
```

**Structure Decision**: Use the existing Bun monorepo structure as-is. Future implementation should add new execution-layer concepts inside the existing boundaries rather than creating parallel feature stacks.

## Artifact Inventory

- `research.md` documents the brownfield architecture decisions discovered in the current codebase.
- `data-model.md` maps the current persistence model to the target execution-layer entities from the spec.
- `execution-architecture.md` records the recommended target execution design independent of current implementation constraints.
- `contracts/current-api-surfaces.md` captures the current external API surface for planning, scheduling, and execution.
- `quickstart.md` provides a repeatable discovery workflow for future planning and implementation work.

## Implementation Progress

**Status**: Phase 2 core implementation done. Remaining work is test-coverage rounding and older route/schedule test migrations.

### Completed

#### 1. Contracts — Layered Mutable Plan Graph (`packages/contracts/src/ai-plan-runtime.ts`)

- Added canonical types: `PlanGraph`, `PlanNode`, `NodeLayer` (union of `definition | invalidation | cancellation`), `PlanEdge`, `GraphMutation`, `GraphMutationOperation`, `NodeDefinition`, `NodeAttempt`, `NodeResult`, `ExecutionContextSnapshot`, `EffectivePlanGraph` (enriched), `EffectivePlanNode` (enriched), `WaitKind`, `ResolveEffectivePlanGraphInput`, `ExecutionActionType`, `ExecutionActionInput`, `GraphMutationRequest`.
- Legacy types (`CompiledPlan`, `PlanRun`, overlay layers) preserved as compatibility surface but no longer drive runtime.

#### 2. Contracts — Unified Execution API Schemas (`packages/contracts/src/api/execution.schema.ts`)

- Added `executionActionBodySchema` (discriminated union for `start_manual | start_scheduled | resume_with_input | resume_with_approval | resume_after_unblock | retry_node | cancel_session`).
- Added `planMutationBodySchema` for graph mutation requests.

#### 3. Domain — Effective Graph Resolution (`packages/domain/src/plan/effective-graph.ts`)

- Added new mutable-graph resolver path: `resolveEffectivePlanGraph({ graph, attempts, results })`.
- Legacy overload `resolveEffectivePlanGraph(compiledPlan, layers)` retained for existing overlay-based tests.
- New resolver builds effective nodes from `PlanNode.layers` + `NodeResult[]` + `NodeAttempt[]`, computes reachability, and handles wait-kinds.

#### 4. Domain — Legacy Cleanup

- Deleted `packages/domain/src/plan/run.ts` (old `createPlanRun`, `applyRuntimeCommand`).
- Removed `nodeStateToRuntimeLayer`, `nodeResultToResultLayer`, `planRunToLayers` from `effective-graph.ts` exports.
- Removed old helper re-exports from `packages/domain/src/plan/index.ts`.

#### 5. Engine — Native Persistence (`packages/engine/src/modules/plan-execution/plan-run-store.ts`)

- `savePlanRun(...)` / `getPlanRun(...)` now persist and read `{ graph: PlanGraph, attempts: NodeAttempt[], results: NodeResult[], executionContextSnapshots: ExecutionContextSnapshot[] }`.
- Lazy migration from legacy overlay rows supported when old persisted data is encountered.
- `createPlanGraphFromCompiledPlan(...)` builds native `PlanGraph` from `CompiledPlan`.

#### 6. Engine — Native Orchestrator (`packages/engine/src/modules/plan-execution/plan-runner.ts`)

- Fully rewritten: no overlay layers, no legacy runtime/result layer construction.
- `advancePlanExecution(...)` resolves effective graph via `resolveEffectivePlanGraph({ graph, attempts, results })`, creates `ExecutionContextSnapshot` + `NodeAttempt`, runs executor, and persists results/attempts.
- `dispatchExecutionAction(...)` implements all action types:
  - `start_manual` / `start_scheduled` → `startPlanExecution(...)`
  - `resume_with_input` / `resume_with_approval` / `resume_after_unblock` → `continuePlanExecution(...)`
  - `retry_node` → cancels active attempt, marks results obsolete, re-executes
  - `cancel_session` → cancels attempt, marks session `Abandoned`, sets task `Cancelled`

#### 7. Engine — Native Plan Mutations (`packages/engine/src/modules/commands/apply-plan-patch-command.ts`)

- `applyPlanMutationCommand(...)` operates directly on persisted `PlanGraph` state: `add_node`, `push_node_layer`, `add_edge`, `remove_edge`, `update_edge`, `delete_node`.
- Computes downstream invalidation via `hard_dependency` edge traversal.
- Cancels running attempts for affected nodes, marks stale/obsolete/invalidated on results, appends invalidation layers.

#### 8. Engine — Blueprint Compiler (`packages/engine/src/modules/tasks/plan-blueprint-compiler.ts`)

- No longer returns `initialLayer`. Returns only `{ compiledPlan, planId }`.

#### 9. Engine — Read Models (`packages/engine/src/modules/queries/task-plan-read-model.ts`)

- `resolveSavedPlanEffectiveGraph(...)` prefers native graph state, falls back to synthesizing from compiled plan when no run exists.
- `buildSavedTaskPlanReadModel(...)` and `getLatestTaskPlanReadModel(...)` use the new resolution path.

#### 10. Engine — Command Migration

- `progress-accepted-task-plan.ts`: uses `resolveSavedPlanEffectiveGraph` for all effective graph access.
- `materialize-generated-task-plan.ts`: seeds native graph via `savePlanRun({ graph, attempts, results, ... })`.
- `materialize-task-plan.ts`: pushes immutable definition layers for linked-task materialization.
- `sync-accepted-plan.ts`: writes `NodeResult`s directly; seeds native graph from compiled plan when no run exists yet.
- `dispatch-next-task-action.ts`: uses `resolveSavedPlanEffectiveGraph`.

#### 11. Engine — Compat (`packages/engine/src/modules/plan-execution/compat.ts`)

- Rewritten with native implementations. `getReadyAutoRunnableNodes` now accepts `EffectivePlanGraph` only. No legacy resolver path.

#### 12. Engine — Schedule Commands

- `apply-schedule.ts` / `clear-schedule.ts`: removed writes to nonexistent `Task.schedule*` fields. Schedule state lives in `WorkBlock` + `TaskProjection`.

#### 13. Routes

- `apps/server/src/routes/execution.routes.ts`: added `POST /tasks/:taskId/execution/actions`. Legacy endpoints (`/run`, `/retry`, `/input`, `/message`) now dispatch through unified `dispatchExecutionAction(...)`.
- `apps/server/src/routes/plans.routes.ts`: added `POST /tasks/:taskId/plan/mutations` and `POST /tasks/:taskId/plan/materialize`.
- `apps/server/src/routes/tasks.routes.ts`: added `POST /tasks/:taskId/schedule/proposals` and `POST /schedule/proposals/decision`.

#### 14. New Tests

- `packages/engine/src/modules/plan-execution/plan-runner.bun.test.ts` — 4 tests: `start_manual`, `resume_with_input`, `cancel_session`, `retry_node` (condition-only deterministic plans).
- `packages/engine/src/modules/plan-execution/plan-runner.task-executor.bun.test.ts` — 3 tests: approval-wait, resume-approval, replan_required (mocked task executor).

#### 15. Test Migrations

- `plan-operations.bun.test.ts`: rewritten for `/plan/mutations` + `/plan/materialize` with persisted compiled plans.
- `plan-lifecycle-workflow.bun.test.ts`: migrated from memory-based `seedDraftPlan`/`seedAcceptedPlan` to `saveCompiledPlan(...)`.
- `get-work-page.bun.test.ts`: migrated from old graph memory to native compiled plan + plan run.
- `get-schedule-page.bun.test.ts`, `get-schedule-page-runnable-state.bun.test.ts`: schedule fields moved from `Task` to `TaskProjection`.
- `task-execution-closure.bun.test.ts`: `scheduleStatus` now read from projection.
- `schedule-commands.bun.test.ts`: schedule state assertions moved to projection.
- Real smoke tests, execution-output tests, effective-graph tests updated for new model behavior.

#### 16. Frontend Preservation

- Graph display contract unchanged. Backend adapters (`buildTaskPlanFromGraph`, `buildTaskPlanReadModel`) keep `effectivePlan.nodes/edges` sufficiently compatible for the existing UI graph model.

### Remaining

- Legacy overlay/compiled types still exported from `packages/contracts/src/ai-plan-runtime.ts` (used by legacy test fixtures and migration bridge only; not on active runtime path).
- `layer-store.ts` still present for lazy migration of old persisted rows.
- Legacy resolver overload (`resolveEffectivePlanGraph(compiledPlan, layers)`) still used by domain unit tests.
- Some older query/route tests in unrelated areas (e.g., `get-schedule-page`, `real-router-smoke`) are still migrating to the split `Task + WorkBlock + TaskProjection` schedule model and may show Prisma validation errors from stale field references.
- Official `bun run test:bun` exit code not yet verified to be clean — last run showed many expected Prisma error logs for negative-path tests; real failure count needs precise extraction.

### Verification Commands

```bash
bunx tsc --noEmit                     # full typecheck (pre-existing errors outside changed files)
bun test <file>                       # individual Bun test suites
bun run test:bun                      # official serial Bun test runner
```

## Complexity Tracking

No constitution violations or exception-driven complexity are introduced in this planning step.
