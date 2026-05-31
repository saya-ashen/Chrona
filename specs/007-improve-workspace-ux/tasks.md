---

description: "Task list for Improve Workspace UX implementation"
---

# Tasks: Improve Workspace UX

**Input**: Design documents from `/specs/007-improve-workspace-ux/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/workspace-ux-contract.md, quickstart.md

**Tests**: This frontend UX feature requires targeted workspace tests plus `bun run typecheck`, `bun run lint`, and `bun run test`. Run `bun run test:e2e` if task navigation or workflow interactions are changed.

**Organization**: Tasks are grouped by user story so each story can be implemented and tested independently after shared setup and foundation tasks.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel because it touches different files and has no dependency on incomplete tasks
- **[Story]**: User story label for story-phase tasks only
- Every task includes an exact file path or artifact path

## Path Conventions

- **Web workspace UI**: `apps/web/src/components/tasks/workspace/`
- **Plan graph UI**: `apps/web/src/components/tasks/plan/task-plan-graph/`
- **Localization**: `apps/web/src/i18n/messages/`
- **Browser evidence**: `specs/007-improve-workspace-ux/`
- **E2E checks**: `e2e/specs/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish baseline evidence, implementation guardrails, and file ownership before UI edits.

- [X] T001 Review feature constraints and expected edit areas in specs/007-improve-workspace-ux/plan.md
- [X] T002 Review UI behavior contract in specs/007-improve-workspace-ux/contracts/workspace-ux-contract.md
- [X] T003 Verify existing pre-edit screenshots exist in specs/007-improve-workspace-ux/pre-desktop-1440x900.png, specs/007-improve-workspace-ux/pre-tablet-1024x768.png, and specs/007-improve-workspace-ux/pre-mobile-390x844.png
- [X] T004 Capture or refresh the pre-edit interactive snapshot for the representative route and save notes in specs/007-improve-workspace-ux/browser-evidence.md
- [X] T005 Inspect current workspace component boundaries in apps/web/src/components/tasks/workspace/page/task-workspace-page.tsx
- [X] T006 [P] Inspect current plan graph component boundaries in apps/web/src/components/tasks/plan/task-plan-graph/node-card.tsx
- [X] T007 [P] Inspect current workspace localization keys in apps/web/src/i18n/messages/en.json and apps/web/src/i18n/messages/zh.json

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Build shared presentation primitives and coverage that all workspace UX stories depend on.

**CRITICAL**: No user story work can begin until this phase is complete.

- [X] T008 Add baseline tests for task identity, current state, active node, and primary action rendering in apps/web/src/components/tasks/workspace/page/task-workspace-page.test.tsx
- [X] T009 Add baseline tests for blocked, review-required, completed, empty, loading, and error presentation in apps/web/src/components/tasks/workspace/execution/task-workspace-execution-overview.test.tsx
- [X] T010 Add baseline tests for active and non-active node detail presentation in apps/web/src/components/tasks/workspace/execution/task-workspace-node-detail-panel.test.tsx
- [X] T011 [P] Extend long-text and mobile-safe workspace fixtures in apps/web/src/components/tasks/workspace/test-support/task-workspace-test-fixtures.ts
- [X] T012 Define shared presentation fields for task status, primary action priority, and active-node summary in apps/web/src/components/tasks/workspace/model/task-workspace-types.ts
- [X] T013 Implement shared workspace presentation derivation in apps/web/src/components/tasks/workspace/model/task-workspace-actions.ts
- [X] T014 Add localization keys for workspace state labels, primary action cues, blocked guidance, review guidance, empty guidance, and completed guidance in apps/web/src/i18n/messages/en.json
- [X] T015 Add matching Chinese localization keys for workspace state labels, primary action cues, blocked guidance, review guidance, empty guidance, and completed guidance in apps/web/src/i18n/messages/zh.json

**Checkpoint**: Foundation ready. User story implementation can now begin in priority order or in parallel if staffing allows.

---

## Phase 3: User Story 1 - Understand Current Workspace State (Priority: P1) MVP

**Goal**: Users can immediately identify the current task, overall state, active plan node, and primary next action without reading every panel.

**Independent Test**: Open an in-progress workspace on desktop, tablet, and mobile; task title, state, active node, and primary action are visually prominent above secondary details and identifiable within 5 seconds.

### Tests for User Story 1

- [X] T016 [P] [US1] Add component test for dominant task identity and state region in apps/web/src/components/tasks/workspace/page/task-workspace-page.test.tsx
- [X] T017 [P] [US1] Add component test for primary action ranking over secondary controls in apps/web/src/components/tasks/workspace/page/task-workspace-page.test.tsx
- [X] T018 [P] [US1] Add plan graph test coverage for active, queued, completed, blocked, and review-required node distinction in apps/web/src/components/tasks/plan/task-plan-graph/node-card.test.tsx
- [X] T019 [P] [US1] Add view-model test for active node and primary action derivation in apps/web/src/components/tasks/workspace/model/task-workspace-actions.test.ts

### Implementation for User Story 1

- [X] T020 [US1] Refactor page hierarchy so task title, status, active node summary, and primary action appear first in apps/web/src/components/tasks/workspace/page/task-workspace-page.tsx
- [X] T021 [US1] Update header card visual hierarchy and action grouping in apps/web/src/components/tasks/workspace/page/task-workspace-header-card.tsx
- [X] T022 [US1] Surface active node context in the plan section without changing plan data flow in apps/web/src/components/tasks/workspace/sections/task-workspace-plan-section.tsx
- [X] T023 [US1] Strengthen active-node detail treatment in apps/web/src/components/tasks/workspace/execution/task-workspace-node-detail-panel.tsx
- [X] T024 [US1] Update execution overview summary to reinforce current state and next action in apps/web/src/components/tasks/workspace/execution/task-workspace-execution-overview.tsx
- [X] T025 [US1] Improve active, queued, completed, blocked, and review-required node card styling in apps/web/src/components/tasks/plan/task-plan-graph/node-card.tsx
- [X] T026 [US1] Update plan graph legend labels and visual mapping for node states in apps/web/src/components/tasks/plan/task-plan-graph/legend.tsx
- [X] T027 [US1] Wire US1 localized labels and action cues from apps/web/src/i18n/messages/en.json and apps/web/src/i18n/messages/zh.json into workspace components
- [X] T028 [US1] Verify US1 manually on the representative route and record findings in specs/007-improve-workspace-ux/browser-evidence.md

**Checkpoint**: User Story 1 is independently testable as the MVP.

---

## Phase 4: User Story 2 - Distinguish Workflow States (Priority: P2)

**Goal**: Users can distinguish loading, empty, error, blocked, review-required, completed, running, and idle states and understand what they can do next.

**Independent Test**: Render representative workspace states; each state has distinct label, visual treatment, explanatory copy, and appropriate action or next-step cue.

### Tests for User Story 2

- [X] T029 [P] [US2] Add loading, empty, and error state tests in apps/web/src/components/tasks/workspace/page/task-workspace-page.test.tsx
- [X] T030 [P] [US2] Add blocked, review-required, completed, running, and idle state tests in apps/web/src/components/tasks/workspace/execution/task-workspace-execution-overview.test.tsx
- [X] T031 [P] [US2] Add missing-active-node and unavailable-detail tests in apps/web/src/components/tasks/workspace/execution/task-workspace-node-detail-panel.test.tsx
- [X] T032 [P] [US2] Add state fixture variants for blocked, review-required, completed, failed, idle, loading, and empty cases in apps/web/src/components/tasks/workspace/test-support/task-workspace-test-fixtures.ts

### Implementation for User Story 2

- [X] T033 [US2] Implement distinct loading, empty, and error workspace page treatments in apps/web/src/components/tasks/workspace/page/task-workspace-page.tsx
- [X] T034 [US2] Implement distinct blocked, review-required, completed, running, and idle execution overview treatments in apps/web/src/components/tasks/workspace/execution/task-workspace-execution-overview.tsx
- [X] T035 [US2] Add clear missing-active-node and unavailable-detail guidance in apps/web/src/components/tasks/workspace/execution/task-workspace-node-detail-panel.tsx
- [X] T036 [US2] Keep blocked and review-required states visually distinct in apps/web/src/components/tasks/plan/task-plan-graph/node-card.tsx
- [X] T037 [US2] Update plan graph inspector state guidance in apps/web/src/components/tasks/plan/task-plan-graph/inspector.tsx
- [X] T038 [US2] Add or adjust US2 state guidance copy in apps/web/src/i18n/messages/en.json
- [X] T039 [US2] Add or adjust matching US2 state guidance copy in apps/web/src/i18n/messages/zh.json
- [X] T040 [US2] Verify representative state treatments with fixtures or local data and record findings in specs/007-improve-workspace-ux/browser-evidence.md

**Checkpoint**: User Stories 1 and 2 both work independently.

---

## Phase 5: User Story 3 - Use Workspace on Mobile (Priority: P3)

**Goal**: Users on a 390px-wide viewport can operate the main task workflow without horizontal scrolling or losing access to the primary action.

**Independent Test**: Open the workspace at 390x844; panels, text, and controls fit within viewport width, long content wraps or truncates safely, and the primary action remains easy to find.

### Tests for User Story 3

- [X] T041 [P] [US3] Add mobile layout and long-content component tests in apps/web/src/components/tasks/workspace/page/task-workspace-page.test.tsx
- [X] T042 [P] [US3] Add compact plan graph rendering test for long node labels in apps/web/src/components/tasks/plan/task-plan-graph/compact-view.test.tsx
- [X] T043 [P] [US3] Add e2e mobile no-horizontal-scroll coverage for workspace layout in e2e/specs/task-workspace-layout.spec.ts

### Implementation for User Story 3

- [X] T044 [US3] Refactor workspace page responsive grid and panel stacking in apps/web/src/components/tasks/workspace/page/task-workspace-page.tsx
- [X] T045 [US3] Update header card wrapping, truncation, and mobile action layout in apps/web/src/components/tasks/workspace/page/task-workspace-header-card.tsx
- [X] T046 [US3] Update plan section responsive layout and overflow handling in apps/web/src/components/tasks/workspace/sections/task-workspace-plan-section.tsx
- [X] T047 [US3] Update plan content wrapping and compact layout behavior in apps/web/src/components/tasks/workspace/sections/task-workspace-plan-content.tsx
- [X] T048 [US3] Update execution overview mobile spacing and long-content handling in apps/web/src/components/tasks/workspace/execution/task-workspace-execution-overview.tsx
- [X] T049 [US3] Update node detail panel mobile spacing and long-content handling in apps/web/src/components/tasks/workspace/execution/task-workspace-node-detail-panel.tsx
- [X] T050 [US3] Update compact plan graph responsive behavior in apps/web/src/components/tasks/plan/task-plan-graph/compact-view.tsx
- [X] T051 [US3] Verify mobile viewport at 390x844 has no horizontal page scroll and record result in specs/007-improve-workspace-ux/browser-evidence.md

**Checkpoint**: User Stories 1, 2, and 3 are independently functional across desktop, tablet, and mobile layouts.

---

## Phase 6: User Story 4 - Preserve Existing Workflow Behavior (Priority: P4)

**Goal**: Existing task creation, plan generation, plan acceptance, execution, assistant interaction, schedule information, and navigation remain available and behave as before.

**Independent Test**: Run existing main task workflow before and after the redesign; the same user-visible actions remain available and complete successfully with no new console errors or broken network requests.

### Tests for User Story 4

- [X] T052 [P] [US4] Run existing workspace page regression tests in apps/web/src/components/tasks/workspace/page/task-workspace-page.test.tsx
- [X] T053 [P] [US4] Run existing task workspace action tests in apps/web/src/components/tasks/workspace/model/task-workspace-actions.test.ts
- [X] T054 [P] [US4] Run existing task workspace layout e2e checks in e2e/specs/task-workspace-layout.spec.ts if navigation or workflow interactions changed
- [ ] T055 [P] [US4] Run existing task workspace chat e2e checks in e2e/specs/task-workspace-chat.spec.ts if assistant interaction changed

### Implementation for User Story 4

- [X] T056 [US4] Confirm no backend API, shared schema, or runtime-domain files were changed for visual polish in apps/server/src, packages/runtime/domain, and packages/schemas
- [X] T057 [US4] Confirm workspace action handlers and disabled/enabled semantics are preserved in apps/web/src/components/tasks/workspace/model/task-workspace-actions.ts
- [X] T058 [US4] Confirm assistant workspace access remains available after layout changes in apps/web/src/components/tasks/workspace/assistant/task-ai-workspace-panel.tsx
- [X] T059 [US4] Confirm edit section and schedule-related workspace content remain available in apps/web/src/components/tasks/workspace/sections/task-workspace-edit-section.tsx
- [X] T060 [US4] Confirm workspace navigation controls remain available
- [X] T061 [US4] Check browser console, page errors, and network requests on the representative route and record diagnostics in specs/007-improve-workspace-ux/browser-evidence.md

**Checkpoint**: Existing product behavior is preserved after UX changes.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final verification, browser evidence, and consistency checks across all stories.

- [X] T062 [P] Review final English copy for Chrona terminology and consistency in apps/web/src/i18n/messages/en.json
- [X] T063 [P] Review final Chinese copy for key parity with English strings in apps/web/src/i18n/messages/zh.json
- [X] T064 [P] Review visual consistency across workspace page, plan section, execution overview, node detail panel, and plan graph in apps/web/src/components/tasks/workspace/page/task-workspace-page.tsx
- [X] T065 Run `bun run typecheck` from repository root
- [X] T066 Run `bun run lint` from repository root
- [X] T067 Run `bun run test` from repository root
- [ ] T068 Run `bun run test:e2e` from repository root if task navigation, task interactions, schedule flow, or assistant flow changed
- [X] T069 Capture post-edit desktop screenshot at 1440x900 in specs/007-improve-workspace-ux/post-desktop-1440x900.png
- [X] T070 Capture post-edit tablet screenshot at 1024x768 in specs/007-improve-workspace-ux/post-tablet-1024x768.png
- [X] T071 Capture post-edit mobile screenshot at 390x844 in specs/007-improve-workspace-ux/post-mobile-390x844.png
- [X] T072 Capture post-edit `agent-browser snapshot -i` output and final diagnostics in specs/007-improve-workspace-ux/browser-evidence.md
- [X] T073 Validate every acceptance scenario and success criterion in specs/007-improve-workspace-ux/spec.md against implementation evidence in specs/007-improve-workspace-ux/browser-evidence.md
- [X] T074 Run final git diff review to confirm changed files match planned scope in specs/007-improve-workspace-ux/plan.md

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; can start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion; blocks all user story work.
- **User Story 1 (Phase 3)**: Depends on Foundational; recommended MVP scope.
- **User Story 2 (Phase 4)**: Depends on Foundational; can be implemented independently but benefits from US1 presentation primitives.
- **User Story 3 (Phase 5)**: Depends on Foundational; can be implemented independently but should verify all visible states after US1/US2.
- **User Story 4 (Phase 6)**: Depends on changed UI behavior; should run after selected UX stories are implemented.
- **Polish (Phase 7)**: Depends on all selected user stories being complete.

### User Story Dependencies

- **US1 (P1)**: Can start after Foundational; no dependency on other stories.
- **US2 (P2)**: Can start after Foundational; no hard dependency on US1, but should reuse shared state labels and guidance.
- **US3 (P3)**: Can start after Foundational; no hard dependency on US1/US2, but final mobile validation should include their states.
- **US4 (P4)**: Validates preservation after any UX story changes; run after selected implementation work.

### Within Each User Story

- Tests and fixture updates before implementation tasks.
- Shared view-model or presentation derivation before components that consume it.
- Component changes before browser evidence.
- Story-specific manual/browser validation before checkpoint closure.

### Parallel Opportunities

- T006 and T007 can run in parallel during Setup.
- T011, T014, and T015 can run in parallel once baseline tests are understood.
- US1 tests T016, T017, T018, and T019 can run in parallel.
- US2 tests T029, T030, T031, and T032 can run in parallel.
- US3 tests T041, T042, and T043 can run in parallel.
- US4 regression checks T052, T053, T054, and T055 can run in parallel.
- Final copy and visual reviews T062, T063, and T064 can run in parallel.

---

## Parallel Example: User Story 1

```bash
Task: "Add component test for dominant task identity and state region in apps/web/src/components/tasks/workspace/page/task-workspace-page.test.tsx"
Task: "Add plan graph test coverage for active, queued, completed, blocked, and review-required node distinction in apps/web/src/components/tasks/plan/task-plan-graph/node-card.test.tsx"
Task: "Add view-model test for active node and primary action derivation in apps/web/src/components/tasks/workspace/model/task-workspace-actions.test.ts"
```

## Parallel Example: User Story 2

```bash
Task: "Add loading, empty, and error state tests in apps/web/src/components/tasks/workspace/page/task-workspace-page.test.tsx"
Task: "Add blocked, review-required, completed, running, and idle state tests in apps/web/src/components/tasks/workspace/execution/task-workspace-execution-overview.test.tsx"
Task: "Add state fixture variants in apps/web/src/components/tasks/workspace/test-support/task-workspace-test-fixtures.ts"
```

## Parallel Example: User Story 3

```bash
Task: "Add mobile layout and long-content component tests in apps/web/src/components/tasks/workspace/page/task-workspace-page.test.tsx"
Task: "Add compact plan graph rendering test for long node labels in apps/web/src/components/tasks/plan/task-plan-graph/compact-view.test.tsx"
Task: "Add e2e mobile no-horizontal-scroll coverage in e2e/specs/task-workspace-layout.spec.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational.
3. Complete Phase 3: User Story 1.
4. Stop and validate that current task, state, active node, and primary action are identifiable within 5 seconds.
5. Demo MVP with automated tests and browser notes.

### Incremental Delivery

1. Complete Setup and Foundational tasks.
2. Deliver US1 to fix current workspace orientation and primary action clarity.
3. Deliver US2 to make workflow states distinct and actionable.
4. Deliver US3 to harden mobile layout and long-content behavior.
5. Deliver US4 to confirm all existing task workflows remain intact.
6. Complete Polish tasks and final evidence capture.

### Parallel Team Strategy

1. Shared team completes Setup and Foundational tasks.
2. Developer A implements US1 page hierarchy and primary action clarity.
3. Developer B implements US2 state treatments and guidance.
4. Developer C implements US3 responsive/mobile hardening.
5. One reviewer owns US4 behavior preservation and final evidence.

---

## Notes

- Backend APIs, shared schemas, database, and runtime-domain code are out of scope unless a concrete blocker is documented.
- New user-facing strings belong in `apps/web/src/i18n/messages/en.json` and `apps/web/src/i18n/messages/zh.json`.
- Browser verification must use the same representative route when feasible: `http://localhost:3100/en/workspaces/cmp72s4oy0007hgfu74srky2u/tasks/cmp72tzoq00008hfurndtr5q9`.
- Mobile verification must confirm no horizontal page scroll at `390x844`.
- Use existing `fetch-json-event-source` helper for any SSE path touched by implementation.

---

## Deferred Follow-ups

### DF-1: Model-layer i18n for execution console view (deferred)

**Status:** Deferred. Component-layer i18n is complete (85 keys under
`components.taskWorkspace` in `en.json` + `zh.json`, full parity). The
view-model layer still emits hardcoded English.

**Gap:** `apps/web/src/components/tasks/workspace/model/task-workspace-query.ts`
and `task-workspace-actions.ts` build the execution console view with ~20-25
hardcoded English literals that render to the execution overview UI via
`consoleView.readiness` / `.attention` / `.latestResult` / `.progress`
(consumed in `sections/task-workspace-plan-section.tsx:453-455` →
`execution/task-workspace-execution-overview.tsx`). Examples: `No plan yet`,
`Latest result`, `Latest run`, `Needs handling`, `Blocked`,
`Ready to schedule`, `Current work`, `Execution readiness`,
`Open action controls`, `Open run controls`, `Resolve in node panel`,
`Review result actions`, `Review run context`, `No execution result yet.`,
plus `nodeDetail` fallbacks (`No plan node selected`, etc.) and
`buildTaskHeaderView` disabled-reason strings.

**Why deferred:** Larger than a string swap. Requires threading a `copy`
param into `createTaskWorkspaceExecutionConsoleView`
(`task-workspace-query.ts:443`) and every builder
(`buildProgressSummary`, `buildLatestResultCard`, `buildAttentionCard`,
`buildReadinessCard`, `buildTaskHeaderView`, `nodeDetail`), adding ~22 keys to
both `en.json` + `zh.json`, AND updating `task-workspace-query.test.ts` /
`task-workspace-actions.test.ts` which assert the exact English literals
(e.g. `title: "Current work"`, `label: "No plan yet"`).

**Scope when resumed:** thread `copy` → builders; add keys (en+zh parity);
migrate test assertions to reference `copy`. Verify with
`bunx vitest run apps/web/src/components/tasks/workspace`.
