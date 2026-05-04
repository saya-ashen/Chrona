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
- Chrona's OpenClaw integration boundary is the provider package layer under `packages/providers/openclaw/*` plus the provider client in `packages/providers/core/src/OpenClawClient.ts`.
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
2. `contracts/current-api-surfaces.md`: current plan/schedule/execution API contract inventory and where the public surface does not yet represent the target execution-layer concepts cleanly.
3. `quickstart.md`: repeatable repo-reading workflow, validation commands, and a checklist for future implementation discovery.
4. `AGENTS.md`: update the Speckit marker so future work reads this plan directly.

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
- `contracts/current-api-surfaces.md` captures the current external API surface for planning, scheduling, and execution.
- `quickstart.md` provides a repeatable discovery workflow for future planning and implementation work.

## Complexity Tracking

No constitution violations or exception-driven complexity are introduced in this planning step.
