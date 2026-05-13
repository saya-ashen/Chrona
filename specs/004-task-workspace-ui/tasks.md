---

description: "Task list for Task Workspace UI Functionality"
---

# Tasks: Task Workspace UI Functionality

**Input**: Design documents from `/specs/004-task-workspace-ui/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/task-workspace-action-contract.md, quickstart.md

**Tests**: Required by the feature specification and constitution. Include tests for retained action success/failure/loading/disabled behavior, empty states, removed controls, and any backend action added during implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel because it touches different files or depends only on completed prerequisites
- **[Story]**: User story label for story-phase tasks only
- Every task includes an exact file path

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish the task workspace audit source of truth and locate existing UI/action ownership before story implementation.

- [X] T001 Create the initial workspace action inventory file in `specs/004-task-workspace-ui/action-inventory.md`
- [X] T002 Audit visible task workspace controls in `apps/web/src/components/tasks/task-workspace-page.tsx` and record each control in `specs/004-task-workspace-ui/action-inventory.md`
- [X] T003 Audit header and plan section controls in `apps/web/src/components/tasks/task-workspace-header-card.tsx` and `apps/web/src/components/tasks/task-workspace-plan-section.tsx` and record each control in `specs/004-task-workspace-ui/action-inventory.md`
- [X] T004 Audit plan content controls in `apps/web/src/components/tasks/task-workspace-plan-content.tsx` and record each control in `specs/004-task-workspace-ui/action-inventory.md`
- [X] T005 Audit graph and inspector controls in `apps/web/src/components/task/panels/task-plan-graph-panel.tsx` and `apps/web/src/components/task/plan/task-plan-graph/index.tsx` and record each control in `specs/004-task-workspace-ui/action-inventory.md`
- [X] T006 Audit inspector detail/run controls in `apps/web/src/components/task/plan/task-plan-graph/inspector.tsx`, `apps/web/src/components/task/plan/task-plan-graph/inspector-details.tsx`, and `apps/web/src/components/task/plan/task-plan-graph/inspector-run-panel.tsx` and record each control in `specs/004-task-workspace-ui/action-inventory.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Create shared action availability/status helpers and inventory tests that all user stories depend on.

**CRITICAL**: No user story implementation should begin until every visible control has an inventory decision and the shared helper/test scaffolding exists.

- [X] T007 Define `WorkspaceActionInventory`, `WorkspaceComponentInventoryItem`, `WorkspaceActionContract`, and `TaskWorkspaceState` UI types in `apps/web/src/components/tasks/task-workspace-types.ts`
- [X] T008 Implement pure workspace action availability and duplicate-submission helpers in `apps/web/src/components/tasks/task-workspace-actions.ts`
- [X] T009 [P] Add unit tests for action availability, disabled reasons, and duplicate-submission guards in `apps/web/src/components/tasks/task-workspace-actions.test.ts`
- [X] T010 Add inventory coverage assertions for current workspace regions in `apps/web/src/components/tasks/task-workspace-page.test.tsx`
- [X] T011 Classify every item in `specs/004-task-workspace-ui/action-inventory.md` as keep-working, wire, disable-with-reason, convert-to-info, or remove
- [X] T012 Confirm whether retained actions need existing loaders only or backend changes by documenting action contract decisions in `specs/004-task-workspace-ui/action-inventory.md`

**Checkpoint**: Inventory complete, shared action rules testable, user story work can begin.

---

## Phase 3: User Story 1 - Complete Core Workspace Actions (Priority: P1) MVP

**Goal**: Every visible primary task workspace control performs a meaningful action or shows a clear unavailable state.

**Independent Test**: Open a populated task workspace, activate each primary control in the main task flow, and verify visible success, failure, loading, disabled, and duplicate-submission behavior without a full manual refresh.

### Tests for User Story 1

- [X] T013 [P] [US1] Add tests for task-level action success, failure, loading, disabled, and duplicate-submission behavior in `apps/web/src/components/tasks/task-workspace-page.test.tsx`
- [X] T014 [P] [US1] Add tests for workspace query refresh and action result mapping in `apps/web/src/components/tasks/task-workspace-query.test.ts`
- [X] T015 [P] [US1] Add tests for graph node selection and retained flow controls in `apps/web/src/components/task/plan/task-plan-graph/task-plan-graph.test.tsx`

### Implementation for User Story 1

- [X] T016 [US1] Wire primary task-level controls to existing task workspace state and action handlers in `apps/web/src/components/tasks/task-workspace-page.tsx`
- [X] T017 [US1] Render action progress, success, failure, disabled reasons, and duplicate-submission prevention through shared helpers in `apps/web/src/components/tasks/task-workspace-header-card.tsx`
- [X] T018 [US1] Update workspace data refresh and stale-result handling after retained actions in `apps/web/src/components/tasks/task-workspace-query.ts`
- [X] T019 [US1] Wire retained plan section and plan content controls to real selection, navigation, refresh, or detail outcomes in `apps/web/src/components/tasks/task-workspace-plan-section.tsx` and `apps/web/src/components/tasks/task-workspace-plan-content.tsx`
- [X] T020 [US1] Wire graph selection, fit/center/zoom, and selected-node updates for retained flow controls in `apps/web/src/components/task/panels/task-plan-graph-panel.tsx` and `apps/web/src/components/task/plan/task-plan-graph/index.tsx`
- [X] T021 [US1] If a retained primary action needs a new server mutation, add the shared Zod request/response contract in `packages/contracts/src/task-workspace.ts`
- [X] T022 [US1] If T021 is needed, implement the Hono action route with validation and permission/stale-state checks in `apps/server/src/routes/task-workspace.ts`
- [X] T023 [US1] If T021 is needed, implement pure action business rules in `packages/domain/src/task-workspace-actions.ts`
- [X] T024 [US1] If T021 is needed, add persistence access for the retained action in `packages/db/src/task-workspace.ts`
- [X] T025 [US1] Update `specs/004-task-workspace-ui/action-inventory.md` with test evidence for every retained primary action

**Checkpoint**: User Story 1 is fully functional and independently testable as the MVP.

---

## Phase 4: User Story 2 - Remove or Replace Nonfunctional Components (Priority: P2)

**Goal**: The workspace shows only currently useful controls, with no placeholder buttons, inactive menu items, decorative clickable regions, or unsupported future-only components.

**Independent Test**: Audit all visible task workspace controls and confirm each one is working, meaningfully disabled, converted to information, or absent as an interactive/focusable element.

### Tests for User Story 2

- [X] T026 [P] [US2] Add negative render tests for removed placeholder/redundant controls in `apps/web/src/components/tasks/task-workspace-page.test.tsx`
- [X] T027 [P] [US2] Add tests for removed graph inspector placeholder controls and retained tabs in `apps/web/src/components/task/plan/task-plan-graph/task-plan-graph.test.tsx`
- [X] T028 [P] [US2] Add tests for non-interactive informational replacements in `apps/web/src/components/tasks/task-workspace-page.test.tsx`

### Implementation for User Story 2

- [X] T029 [US2] Remove or convert no-op task workspace page controls listed in the inventory from `apps/web/src/components/tasks/task-workspace-page.tsx`
- [X] T030 [US2] Remove or convert unsupported header actions and duplicate affordances listed in the inventory from `apps/web/src/components/tasks/task-workspace-header-card.tsx`
- [X] T031 [US2] Remove or convert unsupported plan section/content controls listed in the inventory from `apps/web/src/components/tasks/task-workspace-plan-section.tsx` and `apps/web/src/components/tasks/task-workspace-plan-content.tsx`
- [X] T032 [US2] Remove or convert unsupported graph panel controls listed in the inventory from `apps/web/src/components/task/panels/task-plan-graph-panel.tsx`
- [X] T033 [US2] Remove or convert unsupported inspector controls, placeholder tabs, and decorative clickable regions from `apps/web/src/components/task/plan/task-plan-graph/inspector.tsx`, `apps/web/src/components/task/plan/task-plan-graph/inspector-details.tsx`, and `apps/web/src/components/task/plan/task-plan-graph/inspector-run-panel.tsx`
- [X] T034 [US2] Clean up obsolete types, props, and local placeholder state created by removed controls in `apps/web/src/components/tasks/task-workspace-types.ts`
- [X] T035 [US2] Update `specs/004-task-workspace-ui/action-inventory.md` with removal or conversion evidence for every nonfunctional component

**Checkpoint**: User Stories 1 and 2 both work independently, and the workspace has no known dead controls.

---

## Phase 5: User Story 3 - Preserve Workspace Quality Across States (Priority: P3)

**Goal**: Loading, empty, success, failure, stale, and responsive states remain predictable after controls are wired or removed.

**Independent Test**: View populated, empty, loading, failed-action, stale-data, and narrow viewport states and confirm controls/messages remain accurate and reachable.

### Tests for User Story 3

- [X] T036 [P] [US3] Add tests for no-task, no-node, no-artifact, loading, and load-error states in `apps/web/src/components/tasks/task-workspace-page.test.tsx`
- [X] T037 [P] [US3] Add tests for inspector empty result/evidence/action/configuration states in `apps/web/src/components/task/plan/task-plan-graph/task-plan-graph.test.tsx`
- [X] T038 [P] [US3] Add tests for query stale-data and retry behavior in `apps/web/src/components/tasks/task-workspace-query.test.ts`

### Implementation for User Story 3

- [X] T039 [US3] Render useful empty-state guidance and hide or disable data-dependent controls in `apps/web/src/components/tasks/task-workspace-page.tsx`
- [X] T040 [US3] Normalize loading, refreshing, stale, success, and failure messages for workspace actions in `apps/web/src/components/tasks/task-workspace-header-card.tsx`
- [X] T041 [US3] Preserve selected-node context and recovery messaging after action failures in `apps/web/src/components/tasks/task-workspace-plan-content.tsx`
- [X] T042 [US3] Ensure graph and inspector empty states do not expose misleading controls in `apps/web/src/components/task/plan/task-plan-graph/inspector-details.tsx` and `apps/web/src/components/task/plan/task-plan-graph/inspector-run-panel.tsx`
- [X] T043 [US3] Verify retained controls remain reachable without layout gaps on narrow layouts in `apps/web/src/components/tasks/task-workspace-page.tsx` and `apps/web/src/components/task/panels/task-plan-graph-panel.tsx`
- [X] T044 [US3] Update `specs/004-task-workspace-ui/action-inventory.md` with state coverage evidence for populated, empty, loading, success, failure, stale, and responsive cases

**Checkpoint**: All user stories are independently functional with covered state behavior.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final validation, cleanup, and release proof across the completed workspace.

- [X] T045 [P] Reconcile `specs/004-task-workspace-ui/action-inventory.md` against `specs/004-task-workspace-ui/contracts/task-workspace-action-contract.md` and ensure no item remains unknown
- [X] T046 Run `bun run typecheck` and fix any type errors in affected files
- [X] T047 Run `bun run lint` and fix lint failures in affected files
- [X] T048 Run `bun run test` and fix failing tests in affected files
- [X] T049 Perform quickstart manual validation from `specs/004-task-workspace-ui/quickstart.md` and record results in `specs/004-task-workspace-ui/action-inventory.md`
- [X] T050 Review keyboard focus, accessible names, disabled explanations, and no-dead-control behavior in `apps/web/src/components/tasks/task-workspace-page.tsx` and `apps/web/src/components/task/plan/task-plan-graph/index.tsx`
- [X] T051 Remove obsolete exports or unused test utilities introduced by cleanup from `apps/web/src/components/tasks/task-workspace-types.ts` and `apps/web/src/components/task/plan/task-plan-graph/index.tsx`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies, starts immediately
- **Foundational (Phase 2)**: Depends on Setup completion, blocks user stories
- **User Story 1 (Phase 3)**: Depends on Foundational completion, MVP scope
- **User Story 2 (Phase 4)**: Depends on Foundational completion and should validate against US1 retained controls where implemented
- **User Story 3 (Phase 5)**: Depends on Foundational completion and can proceed once relevant state fixtures exist
- **Polish (Phase 6)**: Depends on all desired user stories being complete

### User Story Dependencies

- **US1 Complete Core Workspace Actions (P1)**: Can start after Foundational; no dependency on US2 or US3
- **US2 Remove or Replace Nonfunctional Components (P2)**: Can start after Foundational; uses inventory decisions and should avoid removing controls US1 retains
- **US3 Preserve Workspace Quality Across States (P3)**: Can start after Foundational; verifies state quality for retained/removed controls from US1 and US2

### Within Each User Story

- Write or update tests before implementation tasks in that story
- Implement pure helpers before component wiring when behavior is shared
- Reuse existing loaders/actions before adding contracts, server routes, domain rules, or database code
- Update inventory evidence before closing the story
- Verify each story independently before continuing to lower-priority scope

---

## Parallel Opportunities

- T009 can run in parallel with T010 after T007 and T008 are complete
- T013, T014, and T015 can run in parallel because they target different test files
- T021, T022, T023, and T024 can run only if a backend action is needed; after the contract shape is clear, domain and db work can proceed in parallel before server integration
- T026, T027, and T028 can run in parallel because they cover separate removal test concerns
- T029 through T033 should be coordinated by file ownership but separate components can be edited in parallel by different implementers
- T036, T037, and T038 can run in parallel because they target different state test areas
- T039 through T043 can run in parallel when they touch distinct components and share completed Foundational helpers
- T045 can run in parallel with final accessibility review T050 after implementation evidence exists

## Parallel Example: User Story 1

```bash
Task: "T013 [US1] Add tests for task-level action success, failure, loading, disabled, and duplicate-submission behavior in apps/web/src/components/tasks/task-workspace-page.test.tsx"
Task: "T014 [US1] Add tests for workspace query refresh and action result mapping in apps/web/src/components/tasks/task-workspace-query.test.ts"
Task: "T015 [US1] Add tests for graph node selection and retained flow controls in apps/web/src/components/task/plan/task-plan-graph/task-plan-graph.test.tsx"
```

## Parallel Example: User Story 2

```bash
Task: "T026 [US2] Add negative render tests for removed placeholder/redundant controls in apps/web/src/components/tasks/task-workspace-page.test.tsx"
Task: "T027 [US2] Add tests for removed graph inspector placeholder controls and retained tabs in apps/web/src/components/task/plan/task-plan-graph/task-plan-graph.test.tsx"
Task: "T028 [US2] Add tests for non-interactive informational replacements in apps/web/src/components/tasks/task-workspace-page.test.tsx"
```

## Parallel Example: User Story 3

```bash
Task: "T036 [US3] Add tests for no-task, no-node, no-artifact, loading, and load-error states in apps/web/src/components/tasks/task-workspace-page.test.tsx"
Task: "T037 [US3] Add tests for inspector empty result/evidence/action/configuration states in apps/web/src/components/task/plan/task-plan-graph/task-plan-graph.test.tsx"
Task: "T038 [US3] Add tests for query stale-data and retry behavior in apps/web/src/components/tasks/task-workspace-query.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 inventory setup.
2. Complete Phase 2 shared action contracts/helpers/tests.
3. Complete Phase 3 US1 action wiring and evidence.
4. Stop and validate US1 independently with `bun run typecheck`, `bun run lint`, targeted tests, and manual action checks.

### Incremental Delivery

1. Deliver Setup + Foundational so every visible control has an inventory decision.
2. Deliver US1 so primary workspace actions work or explain unavailable states.
3. Deliver US2 so dead, duplicate, future-only, and decorative controls are removed or converted.
4. Deliver US3 so loading, empty, success, failure, stale, and responsive states stay consistent.
5. Complete Polish validation with proof commands and quickstart walkthrough.

### Backend Escalation Rule

Only execute T021 through T024 when inventory evidence proves a retained UI action cannot use existing task workspace loaders or action paths. If no backend action is needed, mark those tasks not applicable in implementation notes rather than adding speculative API surface.

## Notes

- [P] tasks use different files or can be handled independently after prerequisites.
- Tests should fail before the implementation they cover.
- Removed controls must be absent from render queries and keyboard focus paths.
- No Next.js patterns; keep Vite React, Hono, contracts/domain/db boundaries, and Bun runtime constraints.
