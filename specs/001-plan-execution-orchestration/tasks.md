# Tasks: Plan Execution Orchestration

**Input**: Design documents from `/specs/001-plan-execution-orchestration/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`
**Tests**: Required by constitution. Each story includes automated coverage before implementation tasks where practical.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel because task touches different files and has no direct dependency
- **[US1]**: Turn a task into an actionable plan
- **[US2]**: Start scheduled work intelligently
- **[US3]**: Continue execution with human review

## Phase 1: Setup

**Purpose**: Establish baseline validation and confirm current source/API surfaces before implementation.

- [X] T001 Run baseline validation commands from `/home/saya/workspace/Chrona/specs/001-plan-execution-orchestration/quickstart.md` and record failing pre-existing checks in `/home/saya/workspace/Chrona/specs/001-plan-execution-orchestration/quickstart.md`
- [X] T002 Inspect current task workspace component boundaries and note confirmed editable files in `/home/saya/workspace/Chrona/specs/001-plan-execution-orchestration/contracts/task-workspace-execution-console.md`
- [X] T003 Inspect current task detail, plan-state, execution, artifacts, approvals, and run data availability in `apps/web/src/components/tasks/task-workspace-query.ts`
- [X] T004 Inspect server route contracts for task detail, plan-state, plan generation, scheduling, and execution in `apps/server/src/routes/tasks.routes.ts`
- [X] T005 [P] Inspect execution route response surfaces and missing console data candidates in `apps/server/src/routes/execution.routes.ts`
- [X] T006 [P] Inspect plan route response surfaces and missing graph metadata candidates in `apps/server/src/routes/plans.routes.ts`

---

## Phase 2: Foundational

**Purpose**: Shared contracts and data mapping that all user stories depend on.

- [X] T007 Define task workspace execution console view-model types for header, graph, node detail, overview cards, artifacts, approvals, and timeline in `apps/web/src/components/tasks/task-workspace-types.ts`
- [X] T008 Add pure mapping helpers from existing task detail and plan-state responses into the console view model in `apps/web/src/components/tasks/task-workspace-query.ts`
- [X] T009 Add unit coverage for console view-model mapping empty, partial, active, blocked, and completed states in `apps/web/src/components/tasks/task-workspace-query.test.ts`
- [X] T010 Document each reference-inspired card as existing-data, expanded-field, or new-read-API backed in `/home/saya/workspace/Chrona/specs/001-plan-execution-orchestration/contracts/task-workspace-execution-console.md`
- [X] T011 If T010 identifies missing data, add narrow Zod response contracts for required task workspace read models in `packages/contracts/src/ai.ts`
- [X] T012 If T010 identifies missing data, add server tests for new or expanded task workspace read contracts covering empty, populated, and error responses in `apps/server/src/routes/tasks.routes.test.ts`
- [X] T013 If T010 identifies missing data, implement the narrow task-scoped read route or expanded detail fields in `apps/server/src/routes/tasks.routes.ts`
- [X] T014 If T010 identifies missing data, wire client query support for the new or expanded read data in `apps/web/src/components/tasks/task-workspace-query.ts`
- [X] T015 Update quickstart API evidence checklist with actual existing-data versus new-API decisions in `/home/saya/workspace/Chrona/specs/001-plan-execution-orchestration/quickstart.md`

**Checkpoint**: Console data contract is explicit; UI stories can proceed without guessing data sources.

---

## Phase 3: User Story 1 - Turn Task Into Actionable Plan (Priority: P1)

**Goal**: User can open a task workspace, understand task intent, generate/review a plan, and accept actionable work from the redesigned execution console.

**Independent Test**: Open a task with no accepted plan, generate a plan, review central graph and node details, accept the plan, and verify the task has a clear next action without relying on duplicate global navigation.

- [X] T016 [P] [US1] Add component tests for no-plan, generating-plan, generated-plan, and accepted-plan workspace states in `apps/web/src/components/tasks/task-workspace-page.test.tsx`
- [X] T017 [P] [US1] Add component tests for graph panel empty, pending, selected-node, and accepted-node presentation in `apps/web/src/components/task/plan/task-plan-graph/task-plan-graph.test.tsx`
- [X] T018 [US1] Refactor page shell into execution-console layout while preserving `ControlPlaneShell` ownership of global navigation in `apps/web/src/components/tasks/task-workspace-page.tsx`
- [X] T019 [US1] Redesign top workspace header with task title, status, progress summary, primary action, and secondary task actions in `apps/web/src/components/tasks/task-workspace-header-card.tsx`
- [X] T020 [US1] Replace the current plan section frame with responsive graph, detail, and overview grid regions in `apps/web/src/components/tasks/task-workspace-plan-section.tsx`
- [X] T021 [US1] Adapt central plan content to reuse `TaskPlanGraphPanel` with execution-console empty, loading, generating, generated, and accepted plan states in `apps/web/src/components/tasks/task-workspace-plan-content.tsx`
- [X] T022 [US1] Add selected-node detail panel content for plan step summary, status, inputs, outputs, and action affordances in `apps/web/src/components/task/plan/task-plan-graph/inspector-details.tsx`
- [X] T023 [US1] Preserve graph inspector selection behavior and align inspector layout with the new lower detail region in `apps/web/src/components/task/plan/task-plan-graph/inspector.tsx`
- [X] T024 [US1] Add right-side execution overview cards for latest result, needs handling, artifacts, and activity using the console view model in `apps/web/src/components/tasks/task-workspace-plan-section.tsx`
- [X] T025 [US1] Update floating AI/task edit section placement so it supports the console layout without covering graph or overview content in `apps/web/src/components/tasks/task-workspace-ai-section.tsx`
- [X] T026 [US1] Ensure generate, stop, accept, and batch-apply plan actions remain wired after layout changes in `apps/web/src/components/tasks/task-workspace-page.tsx`
- [X] T027 [US1] Add responsive styling for desktop two-column console and mobile stacked regions in `apps/web/src/components/tasks/task-workspace-plan-section.tsx`
- [X] T028 [US1] Update graph panel visual states to match the reference-inspired execution flow language without changing graph behavior in `apps/web/src/components/task/panels/task-plan-graph-panel.tsx`

**Checkpoint**: US1 independently shippable as redesigned task-to-plan workspace.

---

## Phase 4: User Story 2 - Start Scheduled Work Intelligently (Priority: P2)

**Goal**: User can inspect scheduled work context, see readiness/current execution state, and start/retry work from the console with enough context to trust the action.

**Independent Test**: Open a scheduled task with an accepted plan, verify readiness/current node/timeline cards, start execution, and confirm progress updates do not regress plan review actions.

- [X] T029 [P] [US2] Add server or integration tests for schedule proposal and execution start data needed by the workspace console in `apps/server/src/routes/execution.routes.test.ts`
- [X] T030 [P] [US2] Add component tests for scheduled-ready, running, retryable, and no-runnable-node states in `apps/web/src/components/tasks/task-workspace-page.test.tsx`
- [X] T031 [US2] Map schedule proposal, runtime cursor, and execution session state into the workspace console view model in `apps/web/src/components/tasks/task-workspace-query.ts`
- [X] T032 [US2] Expose current work block, current node, next runnable action, and progress counts in the top header in `apps/web/src/components/tasks/task-workspace-header-card.tsx`
- [X] T033 [US2] Surface schedule readiness and start/retry actions in the right overview cards in `apps/web/src/components/tasks/task-workspace-plan-section.tsx`
- [X] T034 [US2] Highlight active, blocked, retryable, and completed nodes in the graph from runtime cursor data in `apps/web/src/components/task/panels/task-plan-graph-panel.tsx`
- [X] T035 [US2] Show run attempt status, retry guidance, and execution messages for selected nodes in `apps/web/src/components/task/plan/task-plan-graph/inspector-run-panel.tsx`
- [X] T036 [US2] Preserve execution run, retry, input, and message mutations through existing route calls in `apps/web/src/components/tasks/task-workspace-page.tsx`
- [X] T037 [US2] If scheduled-work data is not available from current routes, add the minimal task-scoped read response in `apps/server/src/routes/execution.routes.ts`
- [X] T038 [US2] If T037 adds or expands data, add matching client contract consumption in `apps/web/src/components/tasks/task-workspace-query.ts`

**Checkpoint**: US2 independently shippable as scheduled-work execution launch surface.

---

## Phase 5: User Story 3 - Continue Execution With Human Review (Priority: P3)

**Goal**: User can handle approvals, inputs, artifacts, and result acceptance from the workspace without losing execution context.

**Independent Test**: Open a task with pending approval/input and generated artifacts, resolve the human action, inspect artifacts, accept or reject results, and verify activity reflects the decision.

- [X] T039 [P] [US3] Add component tests for pending approval, pending input, artifact list, result acceptance, and activity timeline states in `apps/web/src/components/tasks/task-workspace-page.test.tsx`
- [X] T040 [P] [US3] Add server tests for approvals, input, artifact evidence, and result acceptance read data needed by the console in `apps/server/src/routes/execution.routes.test.ts`
- [X] T041 [US3] Map approvals, input requests, artifacts, latest result, and activity events into the workspace console view model in `apps/web/src/components/tasks/task-workspace-query.ts`
- [X] T042 [US3] Render needs-handling card with pending approvals, required input, and disabled/completed states in `apps/web/src/components/tasks/task-workspace-plan-section.tsx`
- [X] T043 [US3] Render latest-result card with accept/reject context and result status in `apps/web/src/components/tasks/task-workspace-plan-section.tsx`
- [X] T044 [US3] Render artifacts card with file/evidence metadata and empty state in `apps/web/src/components/tasks/task-workspace-plan-section.tsx`
- [X] T045 [US3] Render execution activity timeline with chronological run, approval, input, artifact, and result events in `apps/web/src/components/tasks/task-workspace-plan-section.tsx`
- [X] T046 [US3] Wire approval resolution, input submission, message send, and result acceptance actions into console cards without bypassing existing mutations in `apps/web/src/components/tasks/task-workspace-page.tsx`
- [X] T047 [US3] If approval/input/artifact/result data is unavailable or stale, add minimal task-scoped read data in `apps/server/src/routes/execution.routes.ts`
- [X] T048 [US3] If T047 adds or expands data, update shared response contracts in `packages/contracts/src/ai.ts`
- [X] T049 [US3] If T047 adds or expands data, update client query parsing and empty/error states in `apps/web/src/components/tasks/task-workspace-query.ts`

**Checkpoint**: US3 independently shippable as human-review continuation surface.

---

## Phase 6: Polish & Cross-Cutting

**Purpose**: Verify quality gates, documentation, performance, accessibility, and brownfield safety.

- [X] T050 [P] Update task workspace quickstart manual checks with completed no-plan, accepted-plan, running, blocked, artifact, and responsive layout evidence in `/home/saya/workspace/Chrona/specs/001-plan-execution-orchestration/quickstart.md`
- [X] T051 [P] Update current API surfaces documentation for any new or expanded task workspace read APIs in `/home/saya/workspace/Chrona/specs/001-plan-execution-orchestration/contracts/current-api-surfaces.md`
- [X] T052 Validate accessibility semantics, keyboard focus order, and reduced-motion behavior for the redesigned workspace in `apps/web/src/components/tasks/task-workspace-page.tsx`
- [X] T053 Validate performance budget and avoid unnecessary extra round trips for the task workspace console in `apps/web/src/components/tasks/task-workspace-query.ts`
- [X] T054 Run required validation commands `bun run typecheck`, `bun run lint`, `bun run test`, `bun run test:api`, and `bun run test:bun` from `/home/saya/workspace/Chrona/package.json`
- [X] T055 Run targeted workspace validations `bun test apps/web/src/components/task/plan/task-plan-graph.test.tsx`, `bun test apps/web/src/components/work/task-plan-side-panel.test.tsx`, and `bun run test -- apps/web/src/components/tasks` from `/home/saya/workspace/Chrona/package.json`

---

## Dependencies & Execution Order

### Phase Dependencies

- Phase 1 (Setup): No dependencies
- Phase 2 (Foundational): Depends on Phase 1 findings
- Phase 3 (US1): Depends on Phase 2 view model and data-source decisions
- Phase 4 (US2): Depends on Phase 2 and benefits from US1 layout regions
- Phase 5 (US3): Depends on Phase 2 and benefits from US1 overview-card regions
- Phase 6 (Polish): Depends on implemented stories

### Story Dependencies

- US1 is MVP and can ship independently after Phase 2.
- US2 can start after shared console regions exist; it should not require US3.
- US3 can start after shared console regions exist; it should not require US2 except for reused execution state conventions.

### Within Each Story

- Tests first where files are available.
- Mapping and contract tasks before UI consumption.
- UI layout before action wiring.
- Server/API additions only when documented data-source checks prove existing routes are insufficient.

---

## Parallel Examples

### Phase 1

```bash
# Different route files, no dependency
T005 apps/server/src/routes/execution.routes.ts
T006 apps/server/src/routes/plans.routes.ts
```

### US1

```bash
# Different test files, can run before implementation
T016 apps/web/src/components/tasks/task-workspace-page.test.tsx
T017 apps/web/src/components/task/plan/task-plan-graph/task-plan-graph.test.tsx
```

### US2

```bash
# Server route coverage and UI state coverage can proceed together
T029 apps/server/src/routes/execution.routes.test.ts
T030 apps/web/src/components/tasks/task-workspace-page.test.tsx
```

### US3

```bash
# Human-review UI states and server read data coverage can proceed together
T039 apps/web/src/components/tasks/task-workspace-page.test.tsx
T040 apps/server/src/routes/execution.routes.test.ts
```

---

## Implementation Strategy

### MVP First

Complete Phase 1, Phase 2, and Phase 3 (US1). This delivers the redesigned task workspace console for task-to-plan flow while preserving existing global navigation and plan actions.

### Incremental Delivery

1. Ship US1 after tests pass for no-plan, generate, accept, graph, node detail, and responsive layout.
2. Add US2 scheduled execution start/readiness behavior.
3. Add US3 human-review continuation behavior.
4. Finish cross-cutting docs, accessibility, performance, and full validation.

### API Addition Rule

Do not assume current APIs are sufficient. For every overview card or node-detail section, first document whether data is existing, stale/ambiguous, or missing. Add only narrow task-scoped read data when the visible component cannot be reliably derived from existing task detail, plan-state, execution, artifact, approval, or run summaries.
