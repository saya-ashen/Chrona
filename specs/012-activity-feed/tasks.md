# Tasks: Workspace Activity Feed

**Input**: Design documents from `/specs/012-activity-feed/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/activity-feed-contract.md, quickstart.md

**Tests**: Required by the Chrona constitution and this feature plan. Include focused contract/model/component/integration coverage, `bun run typecheck`, `bun run lint`, `bun run test`, `bun run test:e2e`, `bun run check:ui-foundation` when shared controls change, and `agent-browser` verification for desktop `1440x900`, tablet `1024x768`, and mobile `390x844`.

**Organization**: Tasks are grouped by user story so each story can be implemented and tested independently after foundational work.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel with other marked tasks in the same phase when dependencies are complete
- **[Story]**: User story label for story phases only
- Every task includes an exact file path or artifact path

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Prepare evidence locations, confirm current workspace behavior, and capture baseline UX before edits.

- [X] T001 Create verification directory structure in specs/012-activity-feed/verification/
- [X] T002 [P] Capture pre-edit agent-browser desktop evidence for task workspace Activity surfaces in specs/012-activity-feed/verification/pre-desktop-1440x900.md
- [X] T003 [P] Capture pre-edit agent-browser tablet evidence for task workspace Activity surfaces in specs/012-activity-feed/verification/pre-tablet-1024x768.md
- [X] T004 [P] Capture pre-edit agent-browser mobile evidence for task workspace Activity surfaces in specs/012-activity-feed/verification/pre-mobile-390x844.md
- [X] T005 Document current task workspace state visibility and no-horizontal-scroll baseline in specs/012-activity-feed/verification/pre-edit-browser.md

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Establish the shared Activity model, shaping boundaries, and regression scaffolding needed by every user story.

**CRITICAL**: No user story work can begin until this phase is complete.

- [X] T006 Run CodeGraph/GitNexus impact analysis for getTaskPage in specs/012-activity-feed/verification/impact-get-task-page.md
- [X] T007 Run CodeGraph/GitNexus impact analysis for createTaskWorkspaceExecutionConsoleView in specs/012-activity-feed/verification/impact-workspace-query.md
- [X] T008 Run CodeGraph/GitNexus impact analysis for TaskWorkspaceExecutionOverview in specs/012-activity-feed/verification/impact-execution-overview.md
- [X] T009 Run CodeGraph/GitNexus impact analysis for TaskWorkspaceNodeDetailPanel in specs/012-activity-feed/verification/impact-node-detail-panel.md
- [X] T010 [P] Add WorkspaceActivityKind, WorkspaceActivityTone, WorkspaceToolActivity, WorkspaceAssistantActivity, and expanded WorkspaceActivityItem types in apps/web/src/components/tasks/workspace/model/task-workspace-types.ts
- [X] T011 [P] Add persisted activity contract/schema updates for task page responses in packages/contracts/src/api/tasks.schema.ts
- [X] T012 [P] Add runtime activity contract alignment tests in packages/contracts/src/api/tasks.schema.bun.test.ts
- [X] T013 Add shared activity identity, ordering, merge, and node-scope helpers in apps/web/src/components/tasks/workspace/model/task-workspace-activity.ts
- [X] T014 [P] Add unit tests for activity identity, ordering, merge boundaries, and node filtering in apps/web/src/components/tasks/workspace/model/task-workspace-activity.test.ts
- [X] T015 Update task workspace query model to consume structured activity helpers in apps/web/src/components/tasks/workspace/model/task-workspace-query.ts
- [X] T016 Update task workspace query tests for structured activity preservation in apps/web/src/components/tasks/workspace/model/task-workspace-query.test.ts

**Checkpoint**: Shared activity model ready; all user story work can now proceed.

---

## Phase 3: User Story 1 - Understand Task Progress From Command Center (Priority: P1) MVP

**Goal**: Command Center shows task-wide latest activity with meaningful provider/tool/assistant/run details so users can understand task progress without opening provider UI.

**Independent Test**: Open a running or completed task with provider events and verify Command Center Activity communicates task-wide progress, tool calls, assistant output, failures, approvals, and node context.

### Tests for User Story 1

- [X] T017 [P] [US1] Add backend activity mapping tests for assistant, reasoning, provider run, approval, node, and raw activity in packages/engine/src/modules/tasks/get-task-page-orchestrator.bun.test.ts
- [X] T018 [P] [US1] Add server task page activity payload integration tests in apps/server/src/__tests__/api/task-workspace-console.bun.test.ts
- [X] T019 [P] [US1] Add Command Center activity rendering tests for task-wide activity in apps/web/src/components/tasks/workspace/execution/task-workspace-execution-overview.test.tsx
- [X] T020 [P] [US1] Add live and persisted activity deduplication tests in apps/web/src/components/tasks/workspace/hooks/use-task-workspace-plan-state.test.tsx

### Implementation for User Story 1

- [X] T021 [US1] Expand persisted provider activity mapping to emit structured ActivityItem fields in packages/engine/src/modules/tasks/get-task-page.ts
- [X] T022 [US1] Include source node identity, provider identity, run identity, sequence, raw event type, and tone in task page activity output in packages/engine/src/modules/tasks/get-task-page.ts
- [X] T023 [US1] Update live runtime event state to produce structured activity-compatible entries in apps/web/src/components/tasks/workspace/hooks/use-task-workspace-plan-state.ts
- [X] T024 [US1] Create shared WorkspaceActivityFeed component for task scope in apps/web/src/components/tasks/workspace/execution/workspace-activity-feed.tsx
- [X] T025 [US1] Replace Command Center ActivityCard internals with WorkspaceActivityFeed in apps/web/src/components/tasks/workspace/execution/task-workspace-execution-overview.tsx
- [X] T026 [US1] Update task workspace section wiring to pass task-wide structured activity and runtime events in apps/web/src/components/tasks/workspace/sections/task-workspace-plan-section.tsx
- [X] T027 [US1] Add user-facing Activity feed strings for task-wide empty/loading/error states in apps/web/src/lib/i18n/messages.ts
- [X] T028 [US1] Verify Command Center Activity preserves current task, blocked/review state, active node context, and primary action visibility in specs/012-activity-feed/verification/us1-state-visibility.md
- [X] T029 [US1] Capture post-edit agent-browser evidence for Command Center Activity at desktop 1440x900 in specs/012-activity-feed/verification/us1-post-desktop-1440x900.md
- [X] T030 [US1] Capture post-edit agent-browser evidence for Command Center Activity at tablet 1024x768 in specs/012-activity-feed/verification/us1-post-tablet-1024x768.md
- [X] T031 [US1] Capture post-edit agent-browser evidence for Command Center Activity at mobile 390x844 in specs/012-activity-feed/verification/us1-post-mobile-390x844.md

**Checkpoint**: User Story 1 is independently functional as the MVP.

---

## Phase 4: User Story 2 - Inspect Node-Specific Activity From Node Drawer (Priority: P1)

**Goal**: The selected node drawer uses Activity, not Evidence, and shows only latest activity associated with the selected node.

**Independent Test**: Select a node with provider events and verify the drawer has an Activity tab, no Evidence tab, and a feed filtered to that node only.

### Tests for User Story 2

- [X] T032 [P] [US2] Update node detail panel tests to require Activity tab and reject Evidence tab in apps/web/src/components/tasks/workspace/execution/task-workspace-node-detail-panel.test.tsx
- [X] T033 [P] [US2] Add node-scoped activity filtering tests in apps/web/src/components/tasks/workspace/model/task-workspace-query.test.ts
- [X] T034 [P] [US2] Add task plan section drawer wiring tests for selected-node activity in apps/web/src/components/tasks/workspace/sections/task-workspace-plan-section.test.tsx

### Implementation for User Story 2

- [X] T035 [US2] Replace evidence tab state with activity tab state in apps/web/src/components/tasks/workspace/model/task-workspace-types.ts
- [X] T036 [US2] Build selected-node activity view model from structured task activity in apps/web/src/components/tasks/workspace/model/task-workspace-query.ts
- [X] T037 [US2] Replace Evidence tab with Activity tab and shared WorkspaceActivityFeed in apps/web/src/components/tasks/workspace/execution/task-workspace-node-detail-panel.tsx
- [X] T038 [US2] Remove drawer Evidence rendering path and unused evidence imports from apps/web/src/components/tasks/workspace/execution/task-workspace-node-detail-panel.tsx
- [X] T039 [US2] Add node-scoped Activity empty/loading strings in apps/web/src/lib/i18n/messages.ts
- [X] T040 [US2] Capture post-edit agent-browser evidence for node drawer Activity at desktop 1440x900 in specs/012-activity-feed/verification/us2-post-desktop-1440x900.md
- [X] T041 [US2] Capture post-edit agent-browser evidence for node drawer Activity at tablet 1024x768 in specs/012-activity-feed/verification/us2-post-tablet-1024x768.md
- [X] T042 [US2] Capture post-edit agent-browser evidence for node drawer Activity at mobile 390x844 in specs/012-activity-feed/verification/us2-post-mobile-390x844.md

**Checkpoint**: User Story 2 works independently with node selection and live updates.

---

## Phase 5: User Story 3 - Read Provider Tool Activity Without External UI (Priority: P2)

**Goal**: Provider tool calls display started/completed/failed states, useful preview/input/error/duration details, and expandable long content.

**Independent Test**: Run or inspect a task with started, completed, and failed provider tool calls and verify each state has distinct visual treatment and useful details.

### Tests for User Story 3

- [X] T043 [P] [US3] Add backend tests for tool started input/preview shaping in packages/engine/src/modules/tasks/get-task-page-orchestrator.bun.test.ts
- [X] T044 [P] [US3] Add backend tests for tool completed duration/error/tone shaping in packages/engine/src/modules/tasks/get-task-page-orchestrator.bun.test.ts
- [X] T045 [P] [US3] Add WorkspaceActivityFeed tool rendering tests for started/completed/failed and expandable details in apps/web/src/components/tasks/workspace/execution/workspace-activity-feed.test.tsx

### Implementation for User Story 3

- [X] T046 [US3] Preserve tool name, label, preview, input summary, duration, error, and state in provider activity mapping in packages/engine/src/modules/tasks/get-task-page.ts
- [X] T047 [US3] Add expandable tool detail rows to WorkspaceActivityFeed in apps/web/src/components/tasks/workspace/execution/workspace-activity-feed.tsx
- [X] T048 [US3] Add distinct visual treatment for tool started, completed, and failed tones using shadcn primitives in apps/web/src/components/tasks/workspace/execution/workspace-activity-feed.tsx
- [X] T049 [US3] Add safe truncation and expansion behavior for long tool previews, inputs, and errors in apps/web/src/components/tasks/workspace/model/task-workspace-activity.ts
- [X] T050 [US3] Add user-facing tool detail labels and expansion copy in apps/web/src/lib/i18n/messages.ts
- [X] T051 [US3] Capture provider tool Activity browser evidence across Command Center and node drawer in specs/012-activity-feed/verification/us3-tool-activity.md

**Checkpoint**: User Story 3 provides provider-TUI-like tool visibility inside Chrona.

---

## Phase 6: User Story 4 - Reach the Final Activity Model in Phases (Priority: P3)

**Goal**: Deliver the final clean model by adding deep history browsing and removing old Evidence/coarse/compatibility paths.

**Independent Test**: Review each phase exit criterion and audit final state for no Evidence tab, no old coarse activity model, no old-data compatibility fallback, and no unreliable node inference.

### Tests for User Story 4

- [X] T052 [P] [US4] Add activity pagination contract tests in packages/contracts/src/api/tasks.schema.bun.test.ts
- [X] T053 [P] [US4] Add activity history endpoint integration tests in apps/server/src/__tests__/api/task-workspace-activity.bun.test.ts
- [X] T054 [P] [US4] Add old Evidence label removal regression tests in apps/web/src/components/tasks/workspace/execution/task-workspace-node-detail-panel.test.tsx
- [X] T055 [P] [US4] Add no time-window inference regression tests in packages/engine/src/modules/tasks/get-task-page-orchestrator.bun.test.ts

### Implementation for User Story 4

- [X] T056 [US4] Add paged task activity read contract for task and node scopes in packages/contracts/src/api/tasks.schema.ts
- [X] T057 [US4] Implement paged activity history retrieval for task and node scopes in packages/engine/src/modules/tasks/get-task-page.ts
- [X] T058 [US4] Expose paged activity history route in apps/server/src/api/tasks.ts
- [X] T059 [US4] Add frontend activity history loader preserving task and node filters in apps/web/src/components/tasks/workspace/model/task-workspace-actions.ts
- [X] T060 [US4] Add Load older activity behavior to WorkspaceActivityFeed in apps/web/src/components/tasks/workspace/execution/workspace-activity-feed.tsx
- [X] T061 [US4] Remove old coarse-only activity rendering helpers from apps/web/src/components/tasks/workspace/execution/task-workspace-execution-overview.tsx
- [X] T062 [US4] Remove old Evidence drawer compatibility state from apps/web/src/components/tasks/workspace/model/task-workspace-types.ts
- [X] T063 [US4] Remove old-data compatibility fallback for provider events without node context from packages/engine/src/modules/tasks/get-task-page.ts
- [X] T064 [US4] Document final legacy removal audit in specs/012-activity-feed/verification/final-legacy-removal.md
- [X] T065 [US4] Validate 3,000-event initial feed budget and record results in specs/012-activity-feed/verification/performance-3000-events.md

**Checkpoint**: Final Activity model is clean, paged, and free of legacy Evidence/coarse/compatibility paths.

---

## Final Phase: Polish & Cross-Cutting Concerns

**Purpose**: Complete validation, cleanup, and release evidence across all stories.

- [X] T066 [P] Run bun run check:ui-foundation and record output in specs/012-activity-feed/verification/ui-foundation-check.md
- [X] T067 [P] Run bun run typecheck and record output in specs/012-activity-feed/verification/typecheck.md
- [X] T068 [P] Run bun run lint and record output in specs/012-activity-feed/verification/lint.md
- [X] T069 Run bun run test and record output in specs/012-activity-feed/verification/test.md
- [X] T070 Run bun run test:e2e and record output in specs/012-activity-feed/verification/test-e2e.md
- [X] T071 Run focused quickstart test command and record output in specs/012-activity-feed/verification/focused-tests.md
- [X] T072 Capture final agent-browser desktop verification in specs/012-activity-feed/verification/final-desktop-1440x900.md
- [X] T073 Capture final agent-browser tablet verification in specs/012-activity-feed/verification/final-tablet-1024x768.md
- [X] T074 Capture final agent-browser mobile verification with no horizontal scrolling in specs/012-activity-feed/verification/final-mobile-390x844.md
- [X] T075 Run GitNexus detect changes and record affected scope in specs/012-activity-feed/verification/gitnexus-detect-changes.md
- [X] T076 Update specs/012-activity-feed/quickstart.md with any final command or evidence corrections discovered during implementation

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; can start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion; blocks all user story implementation.
- **User Story 1 (Phase 3)**: Depends on Foundational; MVP and first independently releasable increment.
- **User Story 2 (Phase 4)**: Depends on Foundational; can run alongside US1 after shared feed primitives exist, but should be validated independently.
- **User Story 3 (Phase 5)**: Depends on Foundational and shared feed component from US1.
- **User Story 4 (Phase 6)**: Depends on US1, US2, and US3 because final removal and pagination audit require the full Activity model.
- **Polish**: Depends on all selected user stories being complete.

### User Story Dependencies

- **US1**: No dependency on other stories after Foundational; recommended MVP.
- **US2**: No product dependency on US1 after Foundational, but shares `WorkspaceActivityFeed` if US1 lands first.
- **US3**: Depends on structured tool fields from US1 and feed rendering from US1.
- **US4**: Depends on all earlier stories to complete final legacy removal safely.

### Within Each User Story

- Impact analysis before edits to touched symbols.
- Tests before implementation where feasible.
- Contracts/types before engine/server shaping.
- Model helpers before React rendering.
- Rendering before browser verification.
- Story-specific verification before checkpoint.

---

## Parallel Opportunities

- T002, T003, and T004 can run in parallel after T001.
- T010, T011, T012, and T014 can run in parallel after impact tasks are recorded.
- T017, T018, T019, and T020 can run in parallel before US1 implementation.
- T032, T033, and T034 can run in parallel before US2 implementation.
- T043, T044, and T045 can run in parallel before US3 implementation.
- T052, T053, T054, and T055 can run in parallel before US4 implementation.
- T066, T067, and T068 can run in parallel; T069 and T070 should run after focused implementation tests stabilize.

## Parallel Example: User Story 1

```bash
Task: "Add backend activity mapping tests for assistant, reasoning, provider run, approval, node, and raw activity in packages/engine/src/modules/tasks/get-task-page-orchestrator.bun.test.ts"
Task: "Add server task page activity payload integration tests in apps/server/src/__tests__/api/task-workspace-console.bun.test.ts"
Task: "Add Command Center activity rendering tests for task-wide activity in apps/web/src/components/tasks/workspace/execution/task-workspace-execution-overview.test.tsx"
Task: "Add live and persisted activity deduplication tests in apps/web/src/components/tasks/workspace/hooks/use-task-workspace-plan-state.test.tsx"
```

## Parallel Example: User Story 2

```bash
Task: "Update node detail panel tests to require Activity tab and reject Evidence tab in apps/web/src/components/tasks/workspace/execution/task-workspace-node-detail-panel.test.tsx"
Task: "Add node-scoped activity filtering tests in apps/web/src/components/tasks/workspace/model/task-workspace-query.test.ts"
Task: "Add task plan section drawer wiring tests for selected-node activity in apps/web/src/components/tasks/workspace/sections/task-workspace-plan-section.test.tsx"
```

## Parallel Example: User Story 3

```bash
Task: "Add backend tests for tool started input/preview shaping in packages/engine/src/modules/tasks/get-task-page-orchestrator.bun.test.ts"
Task: "Add backend tests for tool completed duration/error/tone shaping in packages/engine/src/modules/tasks/get-task-page-orchestrator.bun.test.ts"
Task: "Add WorkspaceActivityFeed tool rendering tests for started/completed/failed and expandable details in apps/web/src/components/tasks/workspace/execution/workspace-activity-feed.test.tsx"
```

## Parallel Example: User Story 4

```bash
Task: "Add activity pagination contract tests in packages/contracts/src/api/tasks.schema.bun.test.ts"
Task: "Add activity history endpoint integration tests in apps/server/src/__tests__/api/task-workspace-activity.bun.test.ts"
Task: "Add old Evidence label removal regression tests in apps/web/src/components/tasks/workspace/execution/task-workspace-node-detail-panel.test.tsx"
Task: "Add no time-window inference regression tests in packages/engine/src/modules/tasks/get-task-page-orchestrator.bun.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 setup and Phase 2 foundational activity model.
2. Complete Phase 3 User Story 1.
3. Stop and validate Command Center Activity independently.
4. Demo task-wide provider/tool/assistant/run visibility before node drawer replacement or deep history work.

### Incremental Delivery

1. Deliver US1 for task-wide Command Center visibility.
2. Deliver US2 for selected-node drawer Activity and Evidence replacement.
3. Deliver US3 for provider-TUI-like tool details and expandable content.
4. Deliver US4 for deep history and final removal of old models and compatibility paths.
5. Complete final verification and release evidence.

### Parallel Team Strategy

1. One developer owns contracts/engine activity shaping.
2. One developer owns web model deduplication/filtering.
3. One developer owns shared feed UI and browser verification.
4. One developer owns server integration, e2e, and final legacy audit.
