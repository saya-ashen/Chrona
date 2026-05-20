# Tasks: Shadcn UI Refactor

**Input**: Design documents from `/specs/011-shadcn-ui-refactor/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/ui-component-governance.md`, `quickstart.md`

**Tests**: Required by the feature specification and constitution: `bun run typecheck`, `bun run lint`, `bun run test`; run `bun run test:e2e` if task, schedule, or navigation flows change during replacement.

**Organization**: Tasks are grouped by user story so each story can be implemented and tested independently after setup and foundational gates.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel with other marked tasks because it touches different files and has no dependency on incomplete tasks.
- **[Story]**: Required only for user story phases.
- Every task includes a concrete repository path or command working directory.

## Phase 1: Setup (Shared Evidence And Inventory)

**Purpose**: Establish context, pre-edit evidence, and the concrete migration inventory before changing UI code.

- [X] T001 Record branch, feature context, and no-backend-change constraint in `specs/011-shadcn-ui-refactor/verification/context.md`
- [X] T002 Capture pre-edit `agent-browser` observations and screenshots for affected schedule, tasks/work, inbox, memory, shell/access-key surfaces in `specs/011-shadcn-ui-refactor/verification/pre-edit-browser.md`
- [X] T003 Build active legacy UI consumer inventory for `buttonVariants`, `StatusBadge`, `SurfaceCard`, `Field`, `inputClassName`, `textareaClassName`, and `selectClassName` in `specs/011-shadcn-ui-refactor/ui-inventory.md`
- [X] T004 Classify each inventory item as `shared-foundation`, `chrona-wrapper`, `page-composition`, or `remove` with replacement targets in `specs/011-shadcn-ui-refactor/ui-inventory.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Define safe edit scope and canonical shadcn primitive targets before any user story migration.

**CRITICAL**: No user story implementation can begin until this phase is complete.

- [X] T005 Run and document GitNexus upstream impact for existing UI primitive symbols before editing `buttonVariants`, `StatusBadge`, `SurfaceCard`, and `Field` in `specs/011-shadcn-ui-refactor/verification/gitnexus-impact.md`
- [X] T006 Define canonical shadcn primitive API targets for button, badge, card, input, textarea, select, label, and field composition in `specs/011-shadcn-ui-refactor/ui-inventory.md`
- [X] T007 [P] Verify `components.json` aliases and `apps/web/src/lib/utils.ts` support shadcn primitive generation in `specs/011-shadcn-ui-refactor/verification/shadcn-config.md`
- [X] T008 [P] Identify current tests that mock removed UI primitive paths and list required updates in `specs/011-shadcn-ui-refactor/test-inventory.md`

**Checkpoint**: Foundation target and migration inventory are ready; user story implementation can begin.

---

## Phase 3: User Story 1 - Consolidate Duplicate Foundation Components (Priority: P1) MVP

**Goal**: Replace duplicate foundational primitives and all active imports with shadcn primitives or approved thin wrappers, with no legacy compatibility aliases.

**Independent Test**: Search active source after migration and verify removed names/import paths have zero consumers, retained wrappers are documented, and automated type/lint/test checks pass for migrated code.

### Tests For User Story 1

- [X] T009 [P] [US1] Add or update component tests for shadcn `Button`, `Badge`, `Card`, `Input`, `Textarea`, `Select`, and `Label` exports in `apps/web/src/components/ui/__tests__/shadcn-primitives.test.tsx`
- [X] T010 [P] [US1] Update legacy UI mocks in shell, inbox, and memory tests in `apps/web/src/components/__tests__/control-plane-shell.test.tsx`, `apps/web/src/components/inbox/__tests__/inbox-list.test.tsx`, and `apps/web/src/components/memory/__tests__/memory-console.test.tsx`
- [X] T011 [P] [US1] Update legacy UI mocks in schedule tests in `apps/web/src/components/schedule/__tests__/conflict-card.test.tsx`, `apps/web/src/components/schedule/__tests__/preparation-checklist.test.tsx`, `apps/web/src/components/schedule/__tests__/schedule-action-rail.test.tsx`, `apps/web/src/components/schedule/__tests__/schedule-editor-form.test.tsx`, `apps/web/src/components/schedule/__tests__/schedule-task-list.test.tsx`, `apps/web/src/components/schedule/__tests__/selected-block-sheet.test.tsx`, and `apps/web/src/components/schedule/schedule-mini-calendar.test.tsx`
- [X] T012 [P] [US1] Update legacy UI mocks in work tests in `apps/web/src/components/work/task-plan-side-panel.test.tsx` and `apps/web/src/components/work/work-inspector.test.tsx`

### Implementation For User Story 1

- [X] T013 [US1] Replace `buttonVariants` implementation with shadcn `Button` and `buttonVariants` removal in `apps/web/src/components/ui/button.tsx`
- [X] T014 [P] [US1] Add shadcn `Badge` primitive without legacy `StatusBadge` API in `apps/web/src/components/ui/badge.tsx`
- [X] T015 [P] [US1] Add shadcn `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, and `CardFooter` primitives in `apps/web/src/components/ui/card.tsx`
- [X] T016 [P] [US1] Add shadcn `Input`, `Textarea`, `Select`, and `Label` primitives in `apps/web/src/components/ui/input.tsx`, `apps/web/src/components/ui/textarea.tsx`, `apps/web/src/components/ui/select.tsx`, and `apps/web/src/components/ui/label.tsx`
- [X] T017 [US1] Replace shell/access-key/locale/inbox/memory legacy imports with shadcn primitives in `apps/web/src/components/access-key-unlock.tsx`, `apps/web/src/components/control-plane-shell.tsx`, `apps/web/src/components/i18n/locale-switcher.tsx`, `apps/web/src/components/inbox/inbox-list.tsx`, and `apps/web/src/components/memory/memory-console.tsx`
- [X] T018 [US1] Replace schedule legacy imports with shadcn primitives or documented domain wrappers in `apps/web/src/components/schedule/dialogs/task-create-dialog.tsx`, `apps/web/src/components/schedule/forms/schedule-editor-form.tsx`, `apps/web/src/components/schedule/forms/schedule-inline-quick-create.tsx`, `apps/web/src/components/schedule/forms/task-config-form.tsx`, `apps/web/src/components/schedule/panels/selected-block-sheet/selected-block-main-column.tsx`, and `apps/web/src/components/schedule/panels/selected-block-sheet/selected-block-sheet-header.tsx`
- [X] T019 [US1] Replace schedule panel and timeline legacy imports with shadcn primitives or documented domain wrappers in `apps/web/src/components/schedule/panels/ai-insights-panel.tsx`, `apps/web/src/components/schedule/panels/conflict-card.tsx`, `apps/web/src/components/schedule/panels/preparation-checklist.tsx`, `apps/web/src/components/schedule/panels/schedule-page-panels.tsx`, `apps/web/src/components/schedule/panels/schedule-page-sidebar.tsx`, and `apps/web/src/components/schedule/timeline/schedule-timeline-primitives.tsx`
- [X] T020 [US1] Replace schedule page legacy imports with shadcn primitives or documented domain wrappers in `apps/web/src/components/schedule/schedule-action-rail.tsx`, `apps/web/src/components/schedule/schedule-command-bar.tsx`, `apps/web/src/components/schedule/schedule-mini-calendar.tsx`, `apps/web/src/components/schedule/schedule-page-main-panel.tsx`, and `apps/web/src/components/schedule/schedule-task-list.tsx`
- [X] T021 [US1] Replace tasks AI and panel legacy imports with shadcn primitives or documented domain wrappers in `apps/web/src/components/tasks/ai/task-plan-empty-state.tsx`, `apps/web/src/components/tasks/ai/task-plan-result-panel.tsx`, `apps/web/src/components/tasks/panels/task-ai-plan-panel.tsx`, and `apps/web/src/components/tasks/panels/task-edit-panel.tsx`
- [X] T022 [US1] Replace task plan graph and shared legacy imports with shadcn primitives or documented domain wrappers in `apps/web/src/components/tasks/plan/task-plan-graph/frame.tsx`, `apps/web/src/components/tasks/plan/task-plan-graph/inspector-run-panel.tsx`, and `apps/web/src/components/tasks/shared/task-context-links.tsx`
- [X] T023 [US1] Replace task workspace legacy imports with shadcn primitives or documented domain wrappers in `apps/web/src/components/tasks/workspace/assistant/task-ai-workspace-panel.tsx`, `apps/web/src/components/tasks/workspace/assistant/task-workspace-assistant.tsx`, `apps/web/src/components/tasks/workspace/assistant/task-workspace-diff-preview.tsx`, `apps/web/src/components/tasks/workspace/execution/task-workspace-execution-overview.tsx`, and `apps/web/src/components/tasks/workspace/execution/task-workspace-node-detail-panel.tsx`
- [X] T024 [US1] Replace remaining task workspace and task list legacy imports with shadcn primitives or documented domain wrappers in `apps/web/src/components/tasks/workspace/page/task-workspace-header-card.tsx`, `apps/web/src/components/tasks/workspace/sections/task-workspace-ai-section.tsx`, `apps/web/src/components/tasks/workspace/sections/task-workspace-edit-section.tsx`, `apps/web/src/components/tasks/workspace/sections/task-workspace-plan-content.tsx`, and `apps/web/src/components/tasks/task-list-page.tsx`
- [X] T025 [US1] Replace work page legacy imports with shadcn primitives or documented domain wrappers in `apps/web/src/components/work/work-page/work-composer-card.tsx`, `apps/web/src/components/work/work-page/work-page-composer-dock.tsx`, `apps/web/src/components/work/work-page/work-page-header-card.tsx`, `apps/web/src/components/work/work-page/work-page-main-tabs.tsx`, and `apps/web/src/components/work/work-page/work-page-right-rail.tsx`
- [X] T026 [US1] Replace work inspector and result legacy imports with shadcn primitives or documented domain wrappers in `apps/web/src/components/work/latest-result-panel.tsx`, `apps/web/src/components/work/task-plan-side-panel.tsx`, `apps/web/src/components/work/work-inspector-sections.tsx`, and `apps/web/src/components/work/work-inspector.tsx`
- [X] T027 [US1] Delete duplicate legacy primitive files after consumers are migrated in `apps/web/src/components/ui/status-badge.tsx`, `apps/web/src/components/ui/surface-card.tsx`, and `apps/web/src/components/ui/field.tsx`
- [X] T028 [US1] Search and record zero active references to removed names and import paths in `specs/011-shadcn-ui-refactor/verification/legacy-reference-check.md`
- [ ] T029 [US1] Run `bun run typecheck`, `bun run lint`, and `bun run test` from `/home/saya/workspace/Chrona` and record results in `specs/011-shadcn-ui-refactor/verification/automated-checks.md`

**Checkpoint**: User Story 1 is complete when duplicate primitives are removed, imports are migrated, tests are updated, and no removed names remain in active source.

---

## Phase 4: User Story 2 - Preserve Chrona Visual Identity and Product Behavior (Priority: P2)

**Goal**: Verify migrated screens keep Chrona visual identity, state clarity, responsive behavior, dark mode, accessibility, and user-facing terminology.

**Independent Test**: Compare pre/post browser evidence for affected screens at desktop, tablet, and mobile sizes in light/dark modes; confirm primary actions and product states remain clear and mobile has no horizontal scrolling.

### Tests For User Story 2

- [X] T030 [P] [US2] Add or update product behavior regression assertions for migrated shell/inbox/memory surfaces in `apps/web/src/components/__tests__/control-plane-shell.test.tsx`, `apps/web/src/components/inbox/__tests__/inbox-list.test.tsx`, and `apps/web/src/components/memory/__tests__/memory-console.test.tsx`
- [X] T031 [P] [US2] Add or update product behavior regression assertions for migrated schedule surfaces in `apps/web/src/components/schedule/__tests__/schedule-task-list.test.tsx`, `apps/web/src/components/schedule/__tests__/selected-block-sheet.test.tsx`, and `apps/web/src/components/schedule/__tests__/schedule-action-rail.test.tsx`
- [X] T032 [P] [US2] Add or update product behavior regression assertions for migrated work surfaces in `apps/web/src/components/work/task-plan-side-panel.test.tsx` and `apps/web/src/components/work/work-inspector.test.tsx`

### Implementation For User Story 2

- [X] T033 [US2] Capture post-edit `agent-browser` evidence for desktop `1440x900`, tablet `1024x768`, and mobile `390x844` in `specs/011-shadcn-ui-refactor/verification/post-edit-browser.md`
- [X] T034 [US2] Verify light and dark mode contrast, borders, focus rings, and muted backgrounds for affected screens in `specs/011-shadcn-ui-refactor/verification/post-edit-browser.md`
- [X] T035 [US2] Verify mobile `390x844` has no horizontal scrolling for affected screens in `specs/011-shadcn-ui-refactor/verification/post-edit-browser.md`
- [X] T036 [US2] Verify current task, active node, blocked/review state, status meaning, and primary action visibility on migrated task/work/schedule screens in `specs/011-shadcn-ui-refactor/verification/product-behavior.md`
- [X] T037 [US2] Verify loading, empty, partial, and error states touched by the migration in `specs/011-shadcn-ui-refactor/verification/product-behavior.md`
- [ ] T038 [US2] Run `bun run test:e2e` from `/home/saya/workspace/Chrona` if task, schedule, or navigation flows changed and record the result in `specs/011-shadcn-ui-refactor/verification/automated-checks.md`

**Checkpoint**: User Story 2 is complete when visual evidence and product behavior checks show no blocking regressions.

---

## Phase 5: User Story 3 - Prevent Reintroduction of Duplicate Primitives (Priority: P3)

**Goal**: Add durable guidance and a repeatable check so future contributors and AI agents do not recreate duplicate foundational primitives.

**Independent Test**: Introduce or simulate duplicate primitive patterns and verify documentation plus checks flag the issue before acceptance.

### Tests For User Story 3

- [X] T039 [P] [US3] Add tests for duplicate primitive detection patterns in `apps/web/src/test/ui-foundation-guard.test.ts`

### Implementation For User Story 3

- [X] T040 [US3] Add a repeatable UI foundation guard script that flags removed imports, generic `buttonVariants`, generic status badge variants, generic surface cards, and reusable field class helpers in `scripts/check-ui-foundation.mjs`
- [X] T041 [US3] Add a package script for the guardrail command in `package.json`
- [X] T042 [US3] Document the guardrail command and wrapper decision order in `AGENTS.md`
- [X] T043 [US3] Document any remaining Chrona-specific wrappers and their product/domain rationale in `specs/011-shadcn-ui-refactor/ui-inventory.md`
- [ ] T044 [US3] Run the UI foundation guardrail command from `/home/saya/workspace/Chrona` and record results in `specs/011-shadcn-ui-refactor/verification/guardrail-check.md`

**Checkpoint**: User Story 3 is complete when duplicate primitive reintroduction is discoverable through guidance and repeatable checks.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final cleanup, validation, and delivery readiness across all completed stories.

- [X] T045 [P] Remove stale documentation references to legacy primitive names outside migration evidence in `specs/011-shadcn-ui-refactor/quickstart.md`
- [ ] T046 Run GitNexus detect changes for all uncommitted UI refactor changes and record expected affected flows in `specs/011-shadcn-ui-refactor/verification/gitnexus-detect-changes.md`
- [ ] T047 Run final `bun run typecheck`, `bun run lint`, and `bun run test` from `/home/saya/workspace/Chrona` and record results in `specs/011-shadcn-ui-refactor/verification/automated-checks.md`
- [ ] T048 Run final quickstart acceptance checklist and record pass/fail status in `specs/011-shadcn-ui-refactor/verification/acceptance.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup**: No dependencies; must run before code edits.
- **Phase 2 Foundational**: Depends on Phase 1; blocks all user story work.
- **US1 (Phase 3)**: Depends on Phase 2; MVP scope.
- **US2 (Phase 4)**: Depends on the migrated surfaces from US1 for final post-edit verification.
- **US3 (Phase 5)**: Depends on US1 replacement decisions so guardrails target final forbidden names and paths.
- **Phase 6 Polish**: Depends on desired user stories being complete.

### User Story Dependencies

- **US1**: Independent after Phase 2; delivers the core component-system consolidation.
- **US2**: Verifies behavior independently but needs US1 migrated surfaces for post-edit evidence.
- **US3**: Verifies governance independently but needs US1 final replacement names and retained-wrapper rationale.

### Within Each User Story

- Tests and mock updates come before implementation tasks when practical.
- Shared primitives must exist before consumer migrations that import them.
- Delete legacy primitive files only after all active consumers are migrated.
- Browser verification closes frontend user stories after code and test changes.

---

## Parallel Opportunities

- T007 and T008 can run in parallel after T005-T006 planning begins because they write separate verification files.
- T009-T012 can run in parallel because they update separate test files or a new test file.
- T014-T016 can run in parallel after T013 design is known because they create separate primitive files.
- T017, T018-T020, T021-T024, and T025-T026 can be split by shell/schedule/tasks/work area after shared primitives exist.
- T030-T032 can run in parallel because they update separate test groups.
- T033-T035 can be collected in the same browser verification pass but documented as separate acceptance checks.
- T039 can run in parallel with T040-T043 once the guardrail patterns are agreed.

## Parallel Example: User Story 1

```bash
Task: "T010 Update shell, inbox, and memory tests"
Task: "T011 Update schedule tests"
Task: "T012 Update work tests"
```

```bash
Task: "T018 Replace schedule form and selected-block imports"
Task: "T021 Replace tasks AI and panel imports"
Task: "T025 Replace work page imports"
```

## Parallel Example: User Story 2

```bash
Task: "T030 Update shell/inbox/memory product behavior assertions"
Task: "T031 Update schedule product behavior assertions"
Task: "T032 Update work product behavior assertions"
```

## Parallel Example: User Story 3

```bash
Task: "T039 Add guardrail tests"
Task: "T042 Document guardrail command in AGENTS.md"
Task: "T043 Document retained wrappers in ui-inventory.md"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 setup and Phase 2 foundational gates.
2. Complete US1 shared primitive creation, consumer migration, legacy deletion, reference check, and automated checks.
3. Stop and validate that duplicate foundational components are gone before proceeding.

### Incremental Delivery

1. Deliver US1 to remove duplicate primitives and legacy imports.
2. Deliver US2 to prove product behavior and visual quality are preserved.
3. Deliver US3 to prevent future duplicate primitive reintroduction.
4. Complete polish validation and final acceptance evidence.

### Independent Test Criteria Summary

- **US1**: `ui-inventory.md` shows all duplicates replaced or documented; source search shows zero active removed names/import paths; `bun run typecheck`, `bun run lint`, and `bun run test` pass.
- **US2**: `post-edit-browser.md` and `product-behavior.md` show no desktop/tablet/mobile, dark-mode, state-clarity, or mobile-scroll regressions.
- **US3**: `scripts/check-ui-foundation.mjs`, `package.json`, `AGENTS.md`, and guardrail tests identify duplicate foundational components before acceptance.
