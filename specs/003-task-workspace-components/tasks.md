---

description: "Task list for Task Workspace Component Parity"
---

# Tasks: Task Workspace Component Parity

**Input**: Design documents from `/specs/003-task-workspace-components/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/task-workspace-component-contract.md`, `quickstart.md`

**Tests**: Automated tests are required because `spec.md` requires coverage for running, waiting, approval-needed, empty, artifact-present, stale/error, permission-limited, and responsive workspace states.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel with other marked tasks in the same phase because it touches different files or only adds isolated fixtures/tests.
- **[Story]**: User story label from `spec.md`; only user story phase tasks include this label.
- **File paths**: Every task names the exact target file path.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm existing Chrona workspace stack and establish implementation notes before changing code.

- [X] T001 Review current task workspace implementation in `apps/web/src/components/tasks/task-workspace-page.tsx`
- [X] T002 Review current task graph implementation in `apps/web/src/components/task/plan/task-plan-graph/index.tsx`
- [ ] T003 [P] Document any implementation-only dependency decision in `specs/003-task-workspace-components/quickstart.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Create the shared view-model and component scaffolding that all user stories use. No user story implementation should begin until this phase is complete.

**Critical**: Keep business/state mapping logic out of React render bodies; use pure helpers in `task-workspace-query.ts` and shared types in `task-workspace-types.ts`.

- [ ] T004 Extend execution-console view model types for navigation, task header actions, flow controls, node detail tabs, overview freshness, permissions, and empty/error states in `apps/web/src/components/tasks/task-workspace-types.ts`
- [ ] T005 Implement pure status mapping helpers for completed, running, waiting, approval-needed, and blocked user-facing states in `apps/web/src/components/tasks/task-workspace-query.ts`
- [ ] T006 Implement pure `createTaskWorkspaceExecutionConsoleView` fields for header, navigation, flow summary, selected node, overview, and state fallbacks in `apps/web/src/components/tasks/task-workspace-query.ts`
- [ ] T007 [P] Add shared task workspace test fixtures for running, waiting, approval-needed, empty, artifact-present, stale/error, and permission-limited states in `apps/web/src/components/tasks/task-workspace-test-fixtures.ts`
- [ ] T008 [P] Add view-model tests for progress, status mapping, attention derivation, artifacts, activity, and empty states in `apps/web/src/components/tasks/task-workspace-query.test.ts`
- [X] T009 Create reference-aligned shell component exports for workspace navigation, main console, and right overview in `apps/web/src/components/tasks/task-workspace-execution-console.tsx`
- [X] T010 Replace old duplicate workspace layout assumptions with the new execution-console composition entry point in `apps/web/src/components/tasks/task-workspace-page.tsx`

**Checkpoint**: Shared view model and page scaffold exist; user stories can render independently from the same source of truth.

---

## Phase 3: User Story 1 - Understand task execution at a glance (Priority: P1) MVP

**Goal**: Operators can open a task workspace and immediately see task title, editable-title affordance, execution status, progress, task-level controls, and visual execution flow.

**Independent Test**: Open a running task workspace and confirm the header, progress, execution controls, and flow map communicate current state and next actions without relying on US2 or US3 panels.

### Tests for User Story 1

- [ ] T011 [P] [US1] Add header/progress/control component tests for running, waiting, empty, and permission-limited task states in `apps/web/src/components/tasks/task-workspace-page.test.tsx`
- [ ] T012 [P] [US1] Add graph state mapping tests for completed, running, waiting, approval-needed, blocked, artifact, and attention node markers in `apps/web/src/components/task/plan/task-plan-graph/task-plan-graph.test.tsx`
- [ ] T013 [P] [US1] Add flow control tests for zoom, fit/center, expand, legend, and selected-node preservation in `apps/web/src/components/task/plan/task-plan-graph/task-plan-graph.test.tsx`

### Implementation for User Story 1

- [ ] T014 [US1] Implement reference-aligned task header region with breadcrumb, title edit affordance, status, completed/total steps, percentage, continue, pause, export, and more actions in `apps/web/src/components/tasks/task-workspace-header-card.tsx`
- [ ] T015 [US1] Wire task header region to `TaskWorkspaceExecutionConsoleView` data and existing edit/delete/run callbacks in `apps/web/src/components/tasks/task-workspace-page.tsx`
- [ ] T016 [US1] Update flow node card to show step number, title, state label, time/update label, artifact indicator, and required-action indicator in `apps/web/src/components/task/plan/task-plan-graph/node-card.tsx`
- [ ] T017 [US1] Update graph frame to expose legend, zoom, fit/center, and expand controls with accessible labels and stable test ids in `apps/web/src/components/task/plan/task-plan-graph/frame.tsx`
- [ ] T018 [US1] Preserve selected-node context across graph zoom, fit/center, expand, and outside-click behavior in `apps/web/src/components/task/plan/task-plan-graph/index.tsx`
- [ ] T019 [US1] Replace the old plan-section-first visual hierarchy with header plus execution-flow map hierarchy in `apps/web/src/components/tasks/task-workspace-plan-section.tsx`
- [ ] T020 [US1] Add explicit no-node, loading, stale, permission-denied, and graph error states for the at-a-glance workspace regions in `apps/web/src/components/tasks/task-workspace-execution-console.tsx`

**Checkpoint**: User Story 1 is functional and testable as the MVP.

---

## Phase 4: User Story 2 - Act on the current node (Priority: P2)

**Goal**: Reviewers can select a node and use a lower detail panel with result, evidence, action, configuration, auto-refresh, and decision controls.

**Independent Test**: Select a node with outputs and verify the lower panel updates in place with tabs, summaries, evidence, actions, refresh state, and decision affordances.

### Tests for User Story 2

- [ ] T021 [P] [US2] Add node selection and detail-panel update tests in `apps/web/src/components/tasks/task-workspace-page.test.tsx`
- [ ] T022 [P] [US2] Add result, evidence, action, configuration tab and empty-state tests in `apps/web/src/components/tasks/task-workspace-node-detail-panel.test.tsx`
- [ ] T023 [P] [US2] Add node action permission and disabled-reason view-model tests in `apps/web/src/components/tasks/task-workspace-query.test.ts`

### Implementation for User Story 2

- [ ] T024 [US2] Add selected-node state plumbing from `TaskPlanGraph` to the workspace console in `apps/web/src/components/tasks/task-workspace-page.tsx`
- [ ] T025 [US2] Implement lower current-node panel with selected node title, status, step position, and auto-refresh state in `apps/web/src/components/tasks/task-workspace-node-detail-panel.tsx`
- [ ] T026 [US2] Implement result tab with summary, primary findings, copy action, full-result affordance, and no-result state in `apps/web/src/components/tasks/task-workspace-node-detail-panel.tsx`
- [ ] T027 [US2] Implement evidence tab with supporting artifacts/references, source metadata, open affordance, and no-evidence state in `apps/web/src/components/tasks/task-workspace-node-detail-panel.tsx`
- [ ] T028 [US2] Implement action tab with accept, retry, block, view approval, supplement information, disabled permission reasons, and no-action state in `apps/web/src/components/tasks/task-workspace-node-detail-panel.tsx`
- [ ] T029 [US2] Implement configuration tab with node objective, inputs, outputs, dependencies, runtime/config summary, and no-config state in `apps/web/src/components/tasks/task-workspace-node-detail-panel.tsx`
- [ ] T030 [US2] Wire node detail actions to existing execution action dispatch and approval affordances without adding duplicate data paths in `apps/web/src/components/tasks/task-workspace-page.tsx`
- [ ] T031 [US2] Remove obsolete inline inspector reliance where the new lower panel provides current-node review in `apps/web/src/components/task/plan/task-plan-graph/index.tsx`

**Checkpoint**: User Story 2 works independently with graph selection plus lower node action surface.

---

## Phase 5: User Story 3 - Monitor outcomes and workspace context (Priority: P3)

**Goal**: Project members can use global navigation/account context and a persistent side overview with latest result, attention, artifacts, and activity timeline.

**Independent Test**: Open the workspace and confirm navigation, top account/notification context, and right overview categories match the reference without depending on node-detail actions.

### Tests for User Story 3

- [ ] T032 [P] [US3] Add global navigation and member/notification context tests in `apps/web/src/components/tasks/task-workspace-page.test.tsx`
- [ ] T033 [P] [US3] Add right overview latest-result, attention, artifact, activity, stale, and empty-state tests in `apps/web/src/components/tasks/task-workspace-execution-overview.test.tsx`
- [ ] T034 [P] [US3] Add responsive reachability test for navigation, graph, node detail, and overview regions in `apps/web/src/components/tasks/task-workspace-page.test.tsx`

### Implementation for User Story 3

- [X] T035 [US3] Implement left workspace navigation with Chrona identity, primary sections, active task section, notifications, and settings in `apps/web/src/components/tasks/task-workspace-navigation.tsx`
- [ ] T036 [US3] Add notification state and active member identity to the top workspace context in `apps/web/src/components/tasks/task-workspace-header-card.tsx`
- [X] T037 [US3] Implement right overview latest result card with update time and full-result affordance in `apps/web/src/components/tasks/task-workspace-execution-overview.tsx`
- [X] T038 [US3] Implement right overview attention-needed card with blocking/approval node, reason, status, and next actions in `apps/web/src/components/tasks/task-workspace-execution-overview.tsx`
- [X] T039 [US3] Implement right overview artifact summary with name, type, size/comparable metadata, update time, and full-list affordance in `apps/web/src/components/tasks/task-workspace-execution-overview.tsx`
- [X] T040 [US3] Implement right overview execution activity timeline with time, node context, status, description, and empty state in `apps/web/src/components/tasks/task-workspace-execution-overview.tsx`
- [X] T041 [US3] Wire navigation and overview regions into the execution console desktop and narrow viewport layout in `apps/web/src/components/tasks/task-workspace-execution-console.tsx`
- [ ] T042 [US3] Preserve task context when using overview links, navigation affordances, detail tabs, and flow node selection in `apps/web/src/components/tasks/task-workspace-page.tsx`

**Checkpoint**: User Story 3 completes the reference top-level component categories.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Validate quality gates, remove obsolete workspace paths, and document implementation-specific decisions.

- [ ] T043 [P] Update manual verification notes with final workspace behavior and any dependency decisions in `specs/003-task-workspace-components/quickstart.md`
- [X] T044 [P] Add or update accessibility labels for task header, graph controls, node detail tabs, overview cards, and navigation landmarks in `apps/web/src/components/tasks/task-workspace-execution-console.tsx`
- [ ] T045 Verify and remove obsolete task workspace layout code that is no longer used after the new hierarchy in `apps/web/src/components/tasks/task-workspace-plan-content.tsx`
- [X] T046 Run targeted workspace tests for query helpers, page rendering, node detail panel, graph controls, and overview in `apps/web/src/components/tasks/task-workspace-page.test.tsx`
- [X] T047 Run required proof command `bun run typecheck` from repository root
- [X] T048 Run required proof command `bun run lint` from repository root
- [X] T049 Run required proof command `bun run test` from repository root
- [ ] T050 Perform quickstart manual verification for desktop and narrow viewport in `specs/003-task-workspace-components/quickstart.md`
- [X] T051 Run GitNexus change detection for expected affected workspace symbols before any commit in repository root

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup**: No dependencies; start immediately.
- **Phase 2 Foundational**: Depends on Phase 1; blocks all story implementation.
- **Phase 3 US1**: Depends on Phase 2; MVP scope.
- **Phase 4 US2**: Depends on Phase 2 and graph selection contract from US1; can start after T018 if staffed separately.
- **Phase 5 US3**: Depends on Phase 2 and console layout scaffold from US1; can start after T019 if staffed separately.
- **Phase 6 Polish**: Depends on all desired user stories being complete.

### User Story Dependencies

- **US1 (P1)**: MVP; no dependency on US2 or US3 after foundational work.
- **US2 (P2)**: Uses selected-node state and graph selection from US1 but remains independently testable through direct fixtures.
- **US3 (P3)**: Uses shared overview view-model and console shell; independent from US2 node action implementation.

### Within Each User Story

- Tests should be added before implementation and fail against missing behavior.
- View-model helpers precede component wiring.
- Component regions precede page-level integration.
- Empty, loading, stale, permission, and error states must be verified before closing the story.

---

## Parallel Opportunities

- T003 can run after T001/T002 because it only updates feature documentation.
- T007 and T008 can run in parallel after type changes are agreed because fixtures and query tests are isolated.
- T011, T012, and T013 can run in parallel because they target page/graph behavior from separate test scopes.
- T021, T022, and T023 can run in parallel because they cover page selection, node detail component behavior, and query permission mapping.
- T032, T033, and T034 can run in parallel because they target navigation/member context, overview behavior, and responsive reachability.
- T035 can proceed alongside T037-T040 because navigation and overview components live in separate files.
- T047, T048, and T049 are sequential proof commands during final validation to keep output and failure diagnosis clear.

## Parallel Example: User Story 1

```bash
Task: "T011 [P] [US1] Add header/progress/control component tests in apps/web/src/components/tasks/task-workspace-page.test.tsx"
Task: "T012 [P] [US1] Add graph state mapping tests in apps/web/src/components/task/plan/task-plan-graph/task-plan-graph.test.tsx"
Task: "T013 [P] [US1] Add flow control tests in apps/web/src/components/task/plan/task-plan-graph/task-plan-graph.test.tsx"
```

## Parallel Example: User Story 2

```bash
Task: "T021 [P] [US2] Add node selection tests in apps/web/src/components/tasks/task-workspace-page.test.tsx"
Task: "T022 [P] [US2] Add node detail panel tests in apps/web/src/components/tasks/task-workspace-node-detail-panel.test.tsx"
Task: "T023 [P] [US2] Add permission view-model tests in apps/web/src/components/tasks/task-workspace-query.test.ts"
```

## Parallel Example: User Story 3

```bash
Task: "T032 [P] [US3] Add navigation/member tests in apps/web/src/components/tasks/task-workspace-page.test.tsx"
Task: "T033 [P] [US3] Add overview tests in apps/web/src/components/tasks/task-workspace-execution-overview.test.tsx"
Task: "T034 [P] [US3] Add responsive reachability tests in apps/web/src/components/tasks/task-workspace-page.test.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 setup checks.
2. Complete Phase 2 shared view-model and console scaffold.
3. Complete Phase 3 User Story 1.
4. Stop and validate header, progress, controls, flow map, graph states, and graph controls independently.

### Incremental Delivery

1. Deliver US1 as the at-a-glance execution console MVP.
2. Add US2 node detail panel and action surface without changing US1 acceptance behavior.
3. Add US3 navigation/account context and right overview without changing US1/US2 data sources.
4. Run full proof commands and quickstart validation after all desired stories.

### Quality Gates

1. Preserve existing task execution behavior; presentation changes only unless a task explicitly documents a required behavior change.
2. Do not introduce a duplicate graph renderer or old/new workspace compatibility layout.
3. Use existing data first; add shared contracts only if a required visible field cannot be derived.
4. Before editing implementation symbols, run GitNexus impact analysis on the target symbol as required by `AGENTS.md`.
5. Before committing, run GitNexus change detection and verify affected flows match workspace expectations.
