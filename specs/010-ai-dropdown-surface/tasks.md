# Tasks: AI Dropdown Surface

**Input**: Design documents from `/specs/010-ai-dropdown-surface/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Required by the feature specification and Chrona constitution. Include `bun run typecheck`, `bun run lint`, `bun run test`, and `bun run test:e2e` because task, schedule, workbench, and navigation flows are affected.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Capture current behavior and prepare shared feature workspace before implementation.

- [ ] T001 Capture pre-edit baseline for current top-bar AI entry, sidebar open behavior, Schedule page, Task workspace page, and mobile overflow evidence in specs/010-ai-dropdown-surface/quickstart.md
- [X] T002 [P] Inventory all current global AI sidebar imports and usage sites in specs/010-ai-dropdown-surface/research.md
- [X] T003 [P] Review existing sidebar contracts and note migration mapping from packages/contracts/src/ai-sidebar.ts to Assistant Surface State in specs/010-ai-dropdown-surface/contracts/assistant-surface-state.md
- [X] T004 [P] Review existing schedule and task proposal preview ownership paths and document target routing in specs/010-ai-dropdown-surface/contracts/proposal-routing.md

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared contracts, domain rules, server/client seams, and i18n keys required before any user story can be implemented.

**CRITICAL**: No user story work can begin until this phase is complete.

- [X] T005 [P] Add Assistant Surface State, status summary, quick action, proposal route, and recent proposal types in packages/contracts/src/assistant-surface.ts
- [X] T006 [P] Export assistant surface contracts from packages/contracts/src/index.ts
- [X] T007 [P] Add contract tests for AssistantSurfaceState and AssistantActionResult shape in packages/contracts/src/assistant-surface.bun.test.ts
- [X] T008 [P] Add severity priority and summary ordering helpers in packages/domain/src/assistant-surface/summary-priority.ts
- [X] T009 [P] Add quick-action mapping and validation helpers in packages/domain/src/assistant-surface/action-mapping.ts
- [X] T010 [P] Add proposal route validation helpers in packages/domain/src/assistant-surface/proposal-routing.ts
- [X] T011 Export assistant surface domain helpers from packages/domain/src/index.ts
- [X] T012 [P] Add domain tests for severity ordering, action mapping validation, disabled actions, and preview-required actions in packages/domain/src/assistant-surface/assistant-surface.bun.test.ts
- [X] T013 [P] Add server assistant surface aggregation service scaffold using existing page projections/events in apps/server/src/services/assistant-surface.service.ts
- [X] T014 [P] Add assistant surface route scaffold for state lookup and action requests in apps/server/src/routes/assistant-surface.routes.ts
- [X] T015 Register assistant surface routes in apps/server/src/routes/api.ts
- [X] T016 [P] Add web client helper for assistant surface state and action requests
- [X] T017 [P] Add shared web proposal routing helper
- [X] T018 [P] Add assistant surface i18n message keys in apps/web/src/i18n/messages/en.json
- [X] T019 [P] Add assistant surface i18n message keys in apps/web/src/i18n/messages/zh.json

**Checkpoint**: Shared contracts, domain rules, route seams, client helpers, and copy keys exist for story work.

---

## Phase 3: User Story 1 - Use One Page-Aware AI Entry (Priority: P1) MVP

**Goal**: Users see exactly one global top-bar Chrona AI trigger with active-page status, and clicking it opens a dropdown instead of the current sidebar.

**Independent Test**: Visit Schedule, Task workspace, Workbench/result context, and unsupported pages; confirm one top-bar AI trigger exists, no global sidebar opens, the trigger reflects current page status, and the dropdown opens as a menu.

### Tests for User Story 1

- [ ] T020 [P] [US1] Add component tests for trigger status text, emoji icon, dropdown open behavior, unsupported state, and no sidebar panel rendering in apps/web/src/components/assistant-surface/assistant-surface-dropdown.test.tsx
- [ ] T021 [P] [US1] Add shell integration test proving ControlPlaneShell renders the dropdown trigger and not GlobalAiSidebar in apps/web/src/components/control-plane-shell.test.tsx
- [ ] T022 [P] [US1] Add Schedule page regression test for top-bar trigger summary and removed sidebar open path in apps/web/src/components/schedule/schedule-page.test.tsx
- [ ] T023 [P] [US1] Add Task workspace regression test for review/running status summary and removed sidebar open path in apps/web/src/components/tasks/workspace/page/task-workspace-page.test.tsx
- [ ] T024 [P] [US1] Add e2e coverage for one AI entry, dropdown open, and no sidebar on schedule/task routes in apps/web/e2e/assistant-surface.spec.ts

### Implementation for User Story 1

- [X] T025 [P] [US1] Create AssistantSurfaceProvider with transient open/input/rotation UI state only in apps/web/src/components/assistant-surface/assistant-surface-provider.tsx
- [X] T026 [P] [US1] Create Chrona AI top-bar trigger component with emoji icon and prioritized/rotating summary text in apps/web/src/components/assistant-surface/assistant-surface-trigger.tsx
- [X] T027 [P] [US1] Create lightweight dropdown menu shell with page summary, top-priority state, loading/unavailable/error/empty states, and no complex preview area in apps/web/src/components/assistant-surface/assistant-surface-dropdown.tsx
- [X] T028 [US1] Replace GlobalAiSidebarProvider wiring with AssistantSurfaceProvider wiring in apps/web/src/app-shell.tsx
- [X] T029 [US1] Replace GlobalAiSidebarEntry with AssistantSurfaceTrigger and remove GlobalAiSidebar rendering from apps/web/src/components/control-plane-shell.tsx
- [X] T030 [US1] Replace current sidebar page-context registration with assistant surface state hydration for Schedule in apps/web/src/components/schedule/schedule-page.tsx
- [X] T031 [US1] Replace current sidebar page-context registration with assistant surface state hydration for Task workspace in apps/web/src/components/tasks/workspace/page/task-workspace-page.tsx
- [X] T032 [US1] Remove or stop importing standalone sidebar panel components from apps/web/src/components/global-ai-sidebar/global-ai-sidebar.tsx
- [X] T033 [US1] Apply assistant surface localized strings in apps/web/src/i18n/messages/en.json
- [X] T034 [US1] Apply assistant surface localized strings in apps/web/src/i18n/messages/zh.json
- [X] T035 [US1] Capture post-edit for US1 at desktop 1440x900, tablet 1024x768, and mobile 390x844 in specs/010-ai-dropdown-surface/quickstart.md

**Checkpoint**: User Story 1 works independently as the MVP: one top-bar dropdown entry, no sidebar, visible active-page status.

---

## Phase 4: User Story 2 - Choose Server-Provided Quick Actions (Priority: P2)

**Goal**: Dropdown quick actions, disabled reasons, and top-priority state come from assistant surface state derived from active page data and severity mapping, not hardcoded front-end presentation logic.

**Independent Test**: Change Schedule/Task/Workbench state severity and confirm returned quick actions, disabled reasons, and highest-priority status update according to AssistantSurfaceState.

### Tests for User Story 2

- [ ] T036 [P] [US2] Add server tests for Schedule assistant surface summaries, action mapping, disabled reasons, and safe unavailable state in apps/server/src/__tests__/api/assistant-surface-schedule.bun.test.ts
- [ ] T037 [P] [US2] Add server tests for Task assistant surface review/running/blocked summaries, action mapping, disabled reasons, and stale state in apps/server/src/__tests__/api/assistant-surface-task.bun.test.ts
- [ ] T038 [P] [US2] Add server tests for Workbench result waiting/failure summaries and actions in apps/server/src/__tests__/api/assistant-surface-workbench.bun.test.ts
- [ ] T039 [P] [US2] Add component tests for quick action rendering, disabled action prevention, preview expectation labels, and short input availability in apps/web/src/components/assistant-surface/assistant-surface-actions.test.tsx
- [ ] T040 [P] [US2] Add e2e coverage for severity-prioritized quick actions and disabled reasons in apps/web/e2e/assistant-surface-actions.spec.ts

### Implementation for User Story 2

- [ ] T041 [US2] Implement Schedule AssistantSurfaceState aggregation from existing schedule page/projection signals in apps/server/src/services/assistant-surface.service.ts
- [ ] T042 [US2] Implement Task AssistantSurfaceState aggregation from existing task workspace/projection signals in apps/server/src/services/assistant-surface.service.ts
- [ ] T043 [US2] Implement Workbench/result AssistantSurfaceState aggregation from execution result signals in apps/server/src/services/assistant-surface.service.ts
- [ ] T044 [US2] Implement assistant surface state lookup route and safe fallback responses in apps/server/src/routes/assistant-surface.routes.ts
- [ ] T045 [US2] Implement assistant surface quick action request route returning informational result or proposal result envelope in apps/server/src/routes/assistant-surface.routes.ts
- [ ] T046 [US2] Update web client helper to fetch server-provided AssistantSurfaceState and action results
- [ ] T047 [US2] Render server-provided quick actions, descriptions, severity, preview expectation, disabled reasons, and empty state in apps/web/src/components/assistant-surface/assistant-surface-dropdown.tsx
- [ ] T048 [US2] Remove hardcoded quick-action derivation from Schedule AI sidebar adapter path in apps/web/src/components/schedule/adapters/schedule-ai-sidebar-adapter.ts
- [ ] T049 [US2] Remove hardcoded quick-action derivation from Task AI sidebar adapter path in apps/web/src/components/tasks/workspace/adapters/task-ai-sidebar-adapter.ts
- [ ] T050 [US2] Capture post-edit for server-provided actions on Schedule, Task, and Workbench states in specs/010-ai-dropdown-surface/quickstart.md

**Checkpoint**: User Story 2 works independently: quick actions and disabled reasons are supplied through AssistantSurfaceState and match active page severity.

---

## Phase 5: User Story 3 - Review AI Proposals On Owning Pages (Priority: P3)

**Goal**: Any AI result that can modify tasks, plans, schedules, or execution state becomes a proposal routed to its owning page preview surface before explicit confirmation.

**Independent Test**: Trigger representative mutating actions from the dropdown and confirm each creates a proposal entry, navigates/highlights the correct preview surface, and does not mutate state until the owning page confirmation is used.

### Tests for User Story 3

- [ ] T051 [P] [US3] Add proposal-routing unit tests for `schedule.timeline`, `task.config`, `task.graph`, and `workbench.result` routes
- [ ] T052 [P] [US3] Add server no-mutation-before-confirm tests for assistant action proposal results in apps/server/src/__tests__/api/assistant-surface-proposals.bun.test.ts
- [ ] T053 [P] [US3] Add Schedule timeline proposal route and ghost preview tests in apps/web/src/components/schedule/schedule-page.test.tsx
- [ ] T054 [P] [US3] Add Task config and graph proposal route tests in apps/web/src/components/tasks/workspace/page/task-workspace-page.test.tsx
- [ ] T055 [P] [US3] Add Workbench result proposal route tests in apps/web/src/components/tasks/workspace/execution/task-workspace-execution-overview.test.tsx
- [ ] T056 [P] [US3] Add e2e coverage for proposal creation, route to owning preview, rejection no-op, and confirm-from-page-only behavior in apps/web/e2e/assistant-surface-proposals.spec.ts

### Implementation for User Story 3

- [X] T057 [US3] Implement proposal route creation and validation for all preview surfaces
- [X] T058 [US3] Render recent proposal entries as brief route links without complex diffs in apps/web/src/components/assistant-surface/assistant-surface-dropdown.tsx
- [ ] T059 [US3] Route Schedule proposal results to timeline ghost preview mode and page-owned confirmation in apps/web/src/components/schedule/schedule-page.tsx
- [ ] T060 [US3] Route Task configuration proposal results to task config preview mode and page-owned confirmation in apps/web/src/components/tasks/workspace/page/task-workspace-page.tsx
- [ ] T061 [US3] Route Task graph proposal results to graph preview mode and page-owned confirmation in apps/web/src/components/tasks/workspace/page/task-workspace-page.tsx
- [ ] T062 [US3] Route Workbench result proposal results to result preview/review panel in apps/web/src/components/tasks/workspace/execution/task-workspace-execution-overview.tsx
- [ ] T063 [US3] Remove dropdown confirm/dismiss/refine mutation controls from the old sidebar provider path in apps/web/src/components/global-ai-sidebar/global-ai-sidebar-provider.tsx
- [X] T064 [US3] Ensure assistant action result handling creates proposal route entries and never applies commands from dropdown code in apps/web/src/components/assistant-surface/assistant-surface-provider.tsx
- [ ] T065 [US3] Capture post-edit for proposal routing and no dropdown mutation at desktop 1440x900, tablet 1024x768, and mobile 390x844 in specs/010-ai-dropdown-surface/quickstart.md

**Checkpoint**: User Story 3 works independently: dropdown initiates proposals only, and page surfaces own preview and confirmation.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Repository cleanup, docs alignment, full validation, and performance/UX evidence across stories.

- [ ] T066 [P] Remove obsolete sidebar UI files or leave compatibility shims with no render path in apps/web/src/components/global-ai-sidebar/global-ai-sidebar.tsx
- [ ] T067 [P] Remove obsolete conversation/proposal preview/sidebar action components or update imports in apps/web/src/components/global-ai-sidebar/conversation-thread.tsx
- [ ] T068 [P] Remove obsolete global sidebar tests or replace them with assistant surface tests in apps/web/src/components/global-ai-sidebar/global-ai-sidebar.test.tsx
- [ ] T069 [P] Update exported contract references and migration notes from `AiSidebar*` to assistant surface names in packages/contracts/src/ai-sidebar.ts
- [X] T070 [P] Update documentation references to the new dropdown behavior in specs/010-ai-dropdown-surface/quickstart.md
- [ ] T071 Verify dropdown open latency under warm page data stays within 150 ms and record result in specs/010-ai-dropdown-surface/quickstart.md
- [ ] T072 Verify assistant surface state resolution adds no more than one page-scoped backend request and record result in specs/010-ai-dropdown-surface/quickstart.md
- [ ] T073 Verify summary rotation causes no visible top-bar layout shift and record result in specs/010-ai-dropdown-surface/quickstart.md
- [X] T074 Run `bun run typecheck` and record result in specs/010-ai-dropdown-surface/quickstart.md
- [X] T075 Run `bun run lint` and record result in specs/010-ai-dropdown-surface/quickstart.md
- [ ] T076 Run `bun run test` and record result in specs/010-ai-dropdown-surface/quickstart.md
- [ ] T077 Run `bun run test:e2e` and record result in specs/010-ai-dropdown-surface/quickstart.md
- [X] T078 Run `gitnexus_detect_changes()` before any commit and record affected scope in specs/010-ai-dropdown-surface/quickstart.md

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup completion; blocks all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational; recommended MVP.
- **User Story 2 (Phase 4)**: Depends on Foundational and can be developed after US1 shell exists; server/domain pieces are independently testable.
- **User Story 3 (Phase 5)**: Depends on Foundational and proposal route contracts; integrates best after US1 dropdown and US2 action result envelopes exist.
- **Polish (Phase 6)**: Depends on selected user stories being complete.

### User Story Dependencies

- **US1 (P1)**: Establishes single dropdown entry and removes visible sidebar. No dependency on US2 or US3.
- **US2 (P2)**: Requires AssistantSurfaceState contracts/domain helpers. Can be validated independently by mocked or server-provided surface state.
- **US3 (P3)**: Requires proposal route contracts and benefits from US2 action result envelopes. Can still be tested independently through direct proposal route fixtures.

### Within Each User Story

- Tests first; verify they fail before implementation when feasible.
- Contracts/domain helpers before server aggregation.
- Server/client seams before React rendering that consumes them.
- Rendering before browser verification.
- Page preview routing before no-mutation validation.

---

## Parallel Execution Examples

### User Story 1

```bash
# Parallel tests
Task: "T020 apps/web/src/components/assistant-surface/assistant-surface-dropdown.test.tsx"
Task: "T021 apps/web/src/components/control-plane-shell.test.tsx"
Task: "T022 apps/web/src/components/schedule/schedule-page.test.tsx"
Task: "T023 apps/web/src/components/tasks/workspace/page/task-workspace-page.test.tsx"

# Parallel component implementation
Task: "T025 apps/web/src/components/assistant-surface/assistant-surface-provider.tsx"
Task: "T026 apps/web/src/components/assistant-surface/assistant-surface-trigger.tsx"
Task: "T027 apps/web/src/components/assistant-surface/assistant-surface-dropdown.tsx"
```

### User Story 2

```bash
# Parallel server tests
Task: "T036 apps/server/src/__tests__/api/assistant-surface-schedule.bun.test.ts"
Task: "T037 apps/server/src/__tests__/api/assistant-surface-task.bun.test.ts"
Task: "T038 apps/server/src/__tests__/api/assistant-surface-workbench.bun.test.ts"

# Parallel state aggregation work after foundational contracts
Task: "T041 apps/server/src/services/assistant-surface.service.ts schedule aggregation"
Task: "T042 apps/server/src/services/assistant-surface.service.ts task aggregation"
Task: "T043 apps/server/src/services/assistant-surface.service.ts workbench aggregation"
```

### User Story 3

```bash
# Parallel route tests
Task: "T051 proposal-routing unit tests"
Task: "T053 apps/web/src/components/schedule/schedule-page.test.tsx"
Task: "T054 apps/web/src/components/tasks/workspace/page/task-workspace-page.test.tsx"
Task: "T055 apps/web/src/components/tasks/workspace/execution/task-workspace-execution-overview.test.tsx"

# Parallel preview integrations after routing helper
Task: "T059 apps/web/src/components/schedule/schedule-page.tsx"
Task: "T060 apps/web/src/components/tasks/workspace/page/task-workspace-page.tsx task config"
Task: "T061 apps/web/src/components/tasks/workspace/page/task-workspace-page.tsx task graph"
Task: "T062 apps/web/src/components/tasks/workspace/execution/task-workspace-execution-overview.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 setup and browser baseline.
2. Complete Phase 2 foundational contracts/domain/server/client seams.
3. Complete Phase 3 User Story 1.
4. Stop and validate one top-bar AI dropdown, no sidebar, page status summary, responsive behavior, and no horizontal mobile scroll.

### Incremental Delivery

1. Deliver US1 as MVP: single global AI dropdown entry replaces sidebar.
2. Deliver US2: server/page-state supplied quick actions and disabled reasons.
3. Deliver US3: proposal-only mutation flow routed to owning page previews.
4. Run full validation and browser evidence after each delivered increment.

### Parallel Team Strategy

1. One engineer completes contracts/domain helpers while another captures browser baseline and shell inventory.
2. After foundational work, one engineer can own dropdown UI (US1), one can own server aggregation/actions (US2), and one can own proposal routing/page previews (US3).
3. Keep shared files coordinated: apps/web/src/components/control-plane-shell.tsx, apps/web/src/components/assistant-surface/assistant-surface-dropdown.tsx, apps/server/src/services/assistant-surface.service.ts, and apps/web/src/components/tasks/workspace/page/task-workspace-page.tsx.
