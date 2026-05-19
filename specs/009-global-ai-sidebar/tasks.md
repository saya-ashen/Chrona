---

description: "Task list for Global AI Sidebar implementation"
---

# Tasks: Global AI Sidebar

**Input**: Design documents from `specs/009-global-ai-sidebar/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/ui-contract.md`, `quickstart.md`

**Tests**: Required by feature specification and constitution. Include domain/unit/component tests, Playwright e2e, `bun run typecheck`, `bun run lint`, `bun run test`, and `bun run test:e2e` because task, schedule, and navigation flows are affected.

**Organization**: Tasks are grouped by user story so each story can be implemented and tested independently after the shared foundation is complete.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel because it touches different files and does not depend on incomplete tasks
- **[Story]**: User-story label for traceability; setup, foundational, and polish tasks intentionally omit story labels
- Every task includes exact file paths

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Prepare evidence folders and inspect current UI before editing.

- [ ] T001 Create `specs/009-global-ai-sidebar/evidence/` for browser screenshots, snapshots, and validation notes
- [ ] T002 Capture pre-edit `agent-browser` task workspace evidence at 1440x900, 1024x768, and 390x844 in `specs/009-global-ai-sidebar/evidence/pre-edit-task.md`
- [ ] T003 Capture pre-edit `agent-browser` schedule page evidence at 1440x900, 1024x768, and 390x844 in `specs/009-global-ai-sidebar/evidence/pre-edit-schedule.md`
- [X] T004 [P] Review current global shell integration points in `apps/web/src/components/control-plane-shell.tsx`
- [X] T005 [P] Review current task workspace apply/proposal ownership in `apps/web/src/components/tasks/workspace/page/task-workspace-page.tsx`
- [X] T006 [P] Review current schedule apply/drag/drop ownership in `apps/web/src/components/schedule/schedule-page.tsx`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared contracts, domain rules, provider state, and i18n required before story work.

**Critical**: No user story implementation should begin until this phase is complete.

- [X] T007 [P] Add AI sidebar contract types for session, context summary, quick action, message, proposal preview, task preview, schedule ghost preview, and confirmation decision in `packages/contracts/src/ai-sidebar.ts`
- [X] T008 Export AI sidebar contract types from `packages/contracts/src/index.ts`
- [X] T009 [P] Add failing domain tests for context fingerprint comparison, stale proposal state, confirmability transitions, and one-pending-proposal guard in `packages/domain/src/ai-sidebar/proposal-state.bun.test.ts`
- [X] T010 Implement pure proposal state helpers in `packages/domain/src/ai-sidebar/proposal-state.ts`
- [X] T011 [P] Add failing domain tests for task and schedule context summary formatting in `packages/domain/src/ai-sidebar/summarize-context.bun.test.ts`
- [X] T012 Implement pure task and schedule summary helpers in `packages/domain/src/ai-sidebar/summarize-context.ts`
- [X] T013 Export AI sidebar domain helpers from `packages/domain/src/index.ts`
- [X] T014 [P] Add global AI sidebar i18n keys for entry, sections, states, actions, previews, and confirmation controls in `apps/web/src/i18n/messages/en.json`
- [X] T015 [P] Add matching global AI sidebar i18n keys in `apps/web/src/i18n/messages/zh.json`
- [X] T016 Create provider state reducer and context API for open/close, page context, messages, pending proposal, stale checks, and apply status in `apps/web/src/components/global-ai-sidebar/global-ai-sidebar-provider.tsx`
- [ ] T017 Add provider reducer tests for open/close, context switch, stale proposal marking, dismiss, refine, and apply status in `apps/web/src/components/global-ai-sidebar/__tests__/global-ai-sidebar-provider.test.tsx`

**Checkpoint**: Contracts, domain rules, and provider state are ready for user-story implementation.

---

## Phase 3: User Story 1 - Open Contextual AI Sidebar From Anywhere (Priority: P1) MVP

**Goal**: A product-native `Ask Chrona / ⌘K` entry opens a fixed right-side sidebar, preserves page state, updates context across supported pages, and closes without data changes.

**Independent Test**: Open from task and schedule pages, verify fixed right panel with context summary and quick actions, navigate while open, then close with no data mutation.

### Tests for User Story 1

- [ ] T018 [P] [US1] Add component tests for fixed sidebar sections, close behavior, unsupported context, and no bottom chat bubble in `apps/web/src/components/global-ai-sidebar/__tests__/global-ai-sidebar.test.tsx`
- [ ] T019 [P] [US1] Add component tests for `Ask Chrona / ⌘K` entry click and keyboard shortcut behavior in `apps/web/src/components/global-ai-sidebar/__tests__/global-ai-sidebar-entry.test.tsx`
- [ ] T020 [P] [US1] Add e2e test for opening sidebar from task and schedule routes and preserving page state in `tests/e2e/global-ai-sidebar.spec.ts`

### Implementation for User Story 1

- [X] T021 [US1] Implement fixed right-side sidebar shell with context summary, quick actions, conversation, proposal preview region, and confirmation region in `apps/web/src/components/global-ai-sidebar/global-ai-sidebar.tsx`
- [X] T022 [P] [US1] Implement global entry button with shortcut hint and accessible label in `apps/web/src/components/global-ai-sidebar/global-ai-sidebar-entry.tsx`
- [X] T023 [P] [US1] Implement context summary card for task, schedule, and unsupported summaries in `apps/web/src/components/global-ai-sidebar/context-summary-card.tsx`
- [X] T024 [P] [US1] Implement quick action list with enabled, disabled, informational, and mutating-preview affordances in `apps/web/src/components/global-ai-sidebar/quick-action-list.tsx`
- [X] T025 [P] [US1] Implement conversation thread empty, loading, informational, proposal, error, and success message states in `apps/web/src/components/global-ai-sidebar/conversation-thread.tsx`
- [X] T026 [US1] Wire `GlobalAiSidebarProvider`, `GlobalAiSidebarEntry`, and `GlobalAiSidebar` into the top-level app chrome in `apps/web/src/components/control-plane-shell.tsx`
- [ ] T027 [US1] Ensure route navigation updates sidebar context without closing the panel in `apps/web/src/router.tsx`
- [ ] T028 [US1] Capture post-edit `agent-browser` evidence for global entry, open, close, navigation context switching, and no mobile horizontal scroll in `specs/009-global-ai-sidebar/evidence/us1-post-edit.md`

**Checkpoint**: MVP is usable independently and does not apply any data changes.

---

## Phase 4: User Story 2 - Get Task-Aware Assistance With Previewed Changes (Priority: P1)

**Goal**: On task pages, the sidebar understands task, active node, blocked/review state, and exposes task quick actions where every mutation is previewed before confirmation.

**Independent Test**: Open on a task page with active, blocked, and review nodes; use quick actions; verify explanatory responses are informational and mutating actions show a task change preview requiring confirm or dismiss.

### Tests for User Story 2

- [ ] T029 [P] [US2] Add task adapter tests for context fields, available actions, disabled reasons, and fingerprint changes in `apps/web/src/components/tasks/workspace/adapters/task-ai-sidebar-adapter.test.ts`
- [ ] T030 [P] [US2] Add component tests for task change preview, confirm disabled when stale, dismiss without mutation, and refine replacement in `apps/web/src/components/global-ai-sidebar/__tests__/task-proposal-preview.test.tsx`
- [ ] T031 [P] [US2] Add task e2e coverage for blocker explanation, mutating task preview, confirm, dismiss, and stale protection in `tests/e2e/global-ai-sidebar.spec.ts`

### Implementation for User Story 2

- [X] T032 [US2] Implement task page context adapter for task title, active node, node state, blocker/review state, primary action, actions, and fingerprint in `apps/web/src/components/tasks/workspace/adapters/task-ai-sidebar-adapter.ts`
- [X] T033 [US2] Wire task adapter and sidebar action callbacks into existing task workspace state without changing apply ownership in `apps/web/src/components/tasks/workspace/page/task-workspace-page.tsx`
- [X] T034 [US2] Implement task preview rendering for plan modifications, node retry intent, added steps, blocker changes, affected areas, and risks in `apps/web/src/components/global-ai-sidebar/proposal-preview-card.tsx`
- [X] T035 [US2] Route task confirm, dismiss, and refine controls through existing task proposal/apply handlers while blocking stale confirmations in `apps/web/src/components/tasks/workspace/page/task-workspace-page.tsx`
- [ ] T036 [US2] Add task-specific loading, unavailable, success, failure, and safe retry copy to `apps/web/src/i18n/messages/en.json`
- [ ] T037 [US2] Add task-specific loading, unavailable, success, failure, and safe retry copy to `apps/web/src/i18n/messages/zh.json`
- [ ] T038 [US2] Capture post-edit `agent-browser` evidence for task context, blocker/review visibility, task preview, confirm, dismiss, stale state, and mobile no-horizontal-scroll in `specs/009-global-ai-sidebar/evidence/us2-post-edit.md`

**Checkpoint**: Task assistance is independently testable and every task mutation requires explicit confirmation.

---

## Phase 5: User Story 3 - Get Schedule-Aware Assistance With Ghost Blocks (Priority: P1)

**Goal**: On schedule pages, the sidebar understands selected date, queue, free time, and conflicts, and renders schedule proposals as preview cards plus ghost blocks before confirmation.

**Independent Test**: Open on schedule page, request smart scheduling or conflict handling, verify ghost blocks are view-only until confirmation, and confirm or dismiss without leaking preview state into scheduled arrays.

### Tests for User Story 3

- [ ] T039 [P] [US3] Add schedule adapter tests for selected date, queue count, free-time summary, conflict count, action availability, and fingerprint changes in `apps/web/src/components/schedule/adapters/schedule-ai-sidebar-adapter.test.ts`
- [ ] T040 [P] [US3] Add component tests for schedule preview card, ghost-block layer, dismiss cleanup, stale disablement, and no drag/drop persistence before confirm in `apps/web/src/components/global-ai-sidebar/__tests__/schedule-ghost-block-layer.test.tsx`
- [ ] T041 [P] [US3] Add schedule e2e coverage for smart schedule, ghost blocks, unplaced explanation, conflict preview, confirm, dismiss, and mobile no-horizontal-scroll in `tests/e2e/global-ai-sidebar.spec.ts`

### Implementation for User Story 3

- [X] T042 [US3] Implement schedule page context adapter for selected date, unscheduled count, free minutes, largest idle window, conflict count, active view, primary action, actions, and fingerprint in `apps/web/src/components/schedule/adapters/schedule-ai-sidebar-adapter.ts`
- [X] T043 [US3] Wire schedule adapter and sidebar action callbacks into existing schedule page state without changing confirmed schedule mutation ownership in `apps/web/src/components/schedule/schedule-page.tsx`
- [X] T044 [US3] Implement schedule ghost block overlay from pending proposal placements in `apps/web/src/components/global-ai-sidebar/schedule-ghost-block-layer.tsx`
- [X] T045 [US3] Render schedule ghost blocks in the timeline as non-draggable preview blocks without inserting them into persisted `items` in `apps/web/src/components/schedule/timeline/schedule-page-timeline.tsx`
- [X] T046 [US3] Implement schedule preview rendering for placements, unplaced items, resolved conflicts, remaining conflicts, reasons, and confidence in `apps/web/src/components/global-ai-sidebar/proposal-preview-card.tsx`
- [X] T047 [US3] Route schedule confirm, dismiss, and refine controls through existing schedule apply/refresh paths while removing ghost blocks on dismiss, regenerate, route change, or successful confirm in `apps/web/src/components/schedule/schedule-page.tsx`
- [ ] T048 [US3] Add schedule-specific quick action and preview copy to `apps/web/src/i18n/messages/en.json`
- [ ] T049 [US3] Add schedule-specific quick action and preview copy to `apps/web/src/i18n/messages/zh.json`
- [ ] T050 [US3] Capture post-edit `agent-browser` evidence for schedule context, ghost blocks, conflicts, confirm, dismiss, stale state, and mobile no-horizontal-scroll in `specs/009-global-ai-sidebar/evidence/us3-post-edit.md`

**Checkpoint**: Schedule assistance is independently testable and ghost blocks never persist before confirmation.

---

## Phase 6: User Story 4 - Continue a Contextual Conversation Around Proposed Plans (Priority: P2)

**Goal**: Users can ask follow-up questions, distinguish informational answers from actionable previews, and refine task or schedule proposals without applying previous proposals.

**Independent Test**: Ask an alternative after a task or schedule proposal and verify the old preview is replaced or marked stale; ask an explanatory question and verify no confirm controls appear unless a proposal is shown.

### Tests for User Story 4

- [ ] T051 [P] [US4] Add component tests for follow-up input, informational responses without confirm controls, proposal replacement, and refine loading state in `apps/web/src/components/global-ai-sidebar/__tests__/conversation-thread.test.tsx`
- [ ] T052 [P] [US4] Add provider tests for replacing prior proposals during refine and retaining conversation messages in `apps/web/src/components/global-ai-sidebar/__tests__/global-ai-sidebar-provider.test.tsx`
- [ ] T053 [P] [US4] Add e2e coverage for follow-up explanation and alternative proposal refinement in `tests/e2e/global-ai-sidebar.spec.ts`

### Implementation for User Story 4

- [X] T054 [US4] Add follow-up composer, submit handling, and loading/error state to `apps/web/src/components/global-ai-sidebar/conversation-thread.tsx`
- [X] T055 [US4] Implement refine behavior that replaces or invalidates the existing pending proposal before showing a revised preview in `apps/web/src/components/global-ai-sidebar/global-ai-sidebar-provider.tsx`
- [X] T056 [US4] Ensure informational responses are visually distinct from actionable previews and never render confirm controls in `apps/web/src/components/global-ai-sidebar/proposal-preview-card.tsx`
- [ ] T057 [US4] Add follow-up, alternative, informational-only, and refine copy to `apps/web/src/i18n/messages/en.json`
- [ ] T058 [US4] Add follow-up, alternative, informational-only, and refine copy to `apps/web/src/i18n/messages/zh.json`
- [ ] T059 [US4] Capture post-edit `agent-browser` evidence for follow-up conversation, informational-only response, proposal refinement, and mobile no-horizontal-scroll in `specs/009-global-ai-sidebar/evidence/us4-post-edit.md`

**Checkpoint**: Conversation and refinement work without weakening preview-before-confirm safety.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final verification, accessibility, performance, and release evidence across all stories.

- [ ] T060 [P] Audit keyboard reachability, aria labels, polite status updates, and focus behavior in `apps/web/src/components/global-ai-sidebar/global-ai-sidebar.tsx`
- [ ] T061 [P] Audit responsive layout classes for desktop, tablet, and mobile no-horizontal-scroll in `apps/web/src/components/global-ai-sidebar/global-ai-sidebar.tsx`
- [ ] T062 [P] Audit i18n key parity between `apps/web/src/i18n/messages/en.json` and `apps/web/src/i18n/messages/zh.json`
- [ ] T063 [P] Document any justified backend API non-change or implementation gap in `specs/009-global-ai-sidebar/quickstart.md`
- [ ] T064 Validate sidebar open/close and context switch render budget and record timings in `specs/009-global-ai-sidebar/evidence/performance.md`
- [ ] T065 Run `bun run typecheck` and record result in `specs/009-global-ai-sidebar/evidence/validation.md`
- [ ] T066 Run `bun run lint` and record result in `specs/009-global-ai-sidebar/evidence/validation.md`
- [ ] T067 Run `bun run test` and record result in `specs/009-global-ai-sidebar/evidence/validation.md`
- [ ] T068 Run `bun run test:e2e` and record result in `specs/009-global-ai-sidebar/evidence/validation.md`
- [ ] T069 Run the acceptance smoke path from `specs/009-global-ai-sidebar/quickstart.md` and record result in `specs/009-global-ai-sidebar/evidence/smoke.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; starts immediately.
- **Foundational (Phase 2)**: Depends on Setup; blocks all user stories.
- **US1 (Phase 3)**: Depends on Foundational; MVP scope.
- **US2 (Phase 4)**: Depends on Foundational and can proceed after US1 shell/provider contracts are stable.
- **US3 (Phase 5)**: Depends on Foundational and can proceed after US1 shell/provider contracts are stable.
- **US4 (Phase 6)**: Depends on US1 plus either US2 or US3 proposal preview behavior.
- **Polish (Phase 7)**: Depends on all desired stories being complete.

### User Story Dependencies

- **User Story 1 (P1)**: Independent MVP after Phase 2.
- **User Story 2 (P1)**: Independent task increment after Phase 2 and shared US1 sidebar shell.
- **User Story 3 (P1)**: Independent schedule increment after Phase 2 and shared US1 sidebar shell.
- **User Story 4 (P2)**: Builds on the shared conversation area and proposal model from US1-US3.

### Within Each User Story

- Write story tests before implementation and verify failures where feasible.
- Implement adapters before wiring page integration.
- Keep confirmed mutations owned by existing task and schedule page flows.
- Capture story-specific `agent-browser` evidence before closing the story.
- Validate no mutating AI action runs before a visible preview and explicit confirmation.

---

## Parallel Opportunities

- T004, T005, and T006 can run in parallel after evidence capture.
- T007, T009, T011, T014, and T015 can run in parallel during foundation setup.
- T018, T019, and T020 can run in parallel for US1 tests.
- T022, T023, T024, and T025 can run in parallel after T021 establishes component interfaces.
- T029, T030, and T031 can run in parallel for US2 tests.
- T039, T040, and T041 can run in parallel for US3 tests.
- T051, T052, and T053 can run in parallel for US4 tests.
- US2 and US3 can be implemented in parallel once US1 shell/provider interfaces are stable.
- T060, T061, T062, and T063 can run in parallel during polish.

## Parallel Example: User Story 1

```bash
Task: "Add component tests for fixed sidebar sections, close behavior, unsupported context, and no bottom chat bubble in apps/web/src/components/global-ai-sidebar/__tests__/global-ai-sidebar.test.tsx"
Task: "Add component tests for Ask Chrona entry click and keyboard shortcut behavior in apps/web/src/components/global-ai-sidebar/__tests__/global-ai-sidebar-entry.test.tsx"
Task: "Add e2e test for opening sidebar from task and schedule routes and preserving page state in tests/e2e/global-ai-sidebar.spec.ts"
```

## Parallel Example: User Story 2

```bash
Task: "Add task adapter tests for context fields, available actions, disabled reasons, and fingerprint changes in apps/web/src/components/tasks/workspace/adapters/task-ai-sidebar-adapter.test.ts"
Task: "Add component tests for task change preview, confirm disabled when stale, dismiss without mutation, and refine replacement in apps/web/src/components/global-ai-sidebar/__tests__/task-proposal-preview.test.tsx"
Task: "Add task e2e coverage for blocker explanation, mutating task preview, confirm, dismiss, and stale protection in tests/e2e/global-ai-sidebar.spec.ts"
```

## Parallel Example: User Story 3

```bash
Task: "Add schedule adapter tests for selected date, queue count, free-time summary, conflict count, action availability, and fingerprint changes in apps/web/src/components/schedule/adapters/schedule-ai-sidebar-adapter.test.ts"
Task: "Add component tests for schedule preview card, ghost-block layer, dismiss cleanup, stale disablement, and no drag/drop persistence before confirm in apps/web/src/components/global-ai-sidebar/__tests__/schedule-ghost-block-layer.test.tsx"
Task: "Add schedule e2e coverage for smart schedule, ghost blocks, unplaced explanation, conflict preview, confirm, dismiss, and mobile no-horizontal-scroll in tests/e2e/global-ai-sidebar.spec.ts"
```

## Parallel Example: User Story 4

```bash
Task: "Add component tests for follow-up input, informational responses without confirm controls, proposal replacement, and refine loading state in apps/web/src/components/global-ai-sidebar/__tests__/conversation-thread.test.tsx"
Task: "Add provider tests for replacing prior proposals during refine and retaining conversation messages in apps/web/src/components/global-ai-sidebar/__tests__/global-ai-sidebar-provider.test.tsx"
Task: "Add e2e coverage for follow-up explanation and alternative proposal refinement in tests/e2e/global-ai-sidebar.spec.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 setup and browser observation.
2. Complete Phase 2 contracts, domain helpers, provider state, and i18n foundation.
3. Complete Phase 3 global entry/sidebar shell/context switching.
4. Stop and validate US1 independently with component tests, e2e open/navigation checks, and browser evidence.

### Incremental Delivery

1. Add US1 global shell and entry as the MVP.
2. Add US2 task-aware previews while preserving existing task apply ownership.
3. Add US3 schedule-aware ghost blocks while preserving existing schedule apply ownership.
4. Add US4 follow-up conversation and refinement.
5. Complete polish, accessibility, responsive, performance, and required command validation.

### Parallel Team Strategy

1. One developer owns shared contracts/domain/provider foundation.
2. One developer owns US1 shell and global entry.
3. After US1 interfaces stabilize, one developer owns US2 task adapter/previews while another owns US3 schedule adapter/ghost blocks.
4. US4 conversation/refine starts after proposal preview interfaces are stable.

## Notes

- Existing backend APIs remain unchanged unless an implementation gap is documented before coding.
- Existing task and schedule mutation paths remain authoritative; sidebar confirm handlers call those paths only after a visible preview and explicit confirmation.
- `agent-browser` evidence is mandatory for UI changes at 1440x900, 1024x768, and 390x844.
- Mobile layouts must not horizontally scroll while the sidebar is open.
