---

description: "Task list for plan execution orchestration implementation"
---

# Tasks: Plan Execution Orchestration

**Input**: Design documents from `/specs/001-plan-execution-orchestration/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/current-api-surfaces.md`, `quickstart.md`

**Tests**: Automated coverage is required by the spec for plan generation/editing, work-block scheduling and start, automatic step advancement, missing-input pause and resume, review outcomes, and continuation across later work blocks.

**Organization**: Tasks are grouped by user story so each increment can be implemented and validated independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel after dependencies are satisfied
- **[Story]**: User story label for traceability (`[US1]`, `[US2]`, `[US3]`)
- Every task includes an exact repo path

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Add shared fixtures, exports, and terminology scaffolding used across the execution-orchestration implementation.

- [X] T001 Add shared execution-orchestration sample fixtures in `apps/server/src/__tests__/api/plan-execution-fixtures.ts`
- [X] T002 [P] Export feature contract entry points from `packages/contracts/src/index.ts`
- [X] T003 [P] Centralize work-state terminology for the UI in `apps/web/src/components/work/work-page/work-page-copy.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Establish the persistence, contracts, and projection foundation required by all user stories.

**⚠️ CRITICAL**: No user story work should begin until this phase is complete.

- [X] T004 Extend execution-layer persistence for `WorkBlock`, `ExecutionSession`, and step review metadata in `prisma/schema.prisma`
- [X] T005 Regenerate Prisma exports for the new execution-layer models in `packages/db/src/generated/prisma/models.ts`
- [X] T006 [P] Add provider-neutral work-block and execution-session contracts in `packages/contracts/src/ai.ts`
- [X] T007 Add execution-layer repository exports in `packages/db/src/index.ts`
- [X] T008 Establish shared task/work projection state mapping in `packages/runtime/src/modules/projections/rebuild-task-projection.ts`

**Checkpoint**: Persistence, contracts, and projection foundations are ready for independent story work.

---

## Phase 3: User Story 1 - Turn a task into an actionable plan (Priority: P1) 🎯 MVP

**Goal**: Let users generate, inspect, edit, and save structured plans whose steps include dependencies, required information, execution classification, readiness, and next-action guidance.

**Independent Test**: Create a task, generate a plan, edit step details, save the plan, and verify the saved plan remains the source of truth for later scheduling and execution.

### Tests for User Story 1

- [ ] T009 [P] [US1] Extend plan lifecycle API coverage in `apps/server/src/__tests__/api/plan-lifecycle-workflow.bun.test.ts`
- [ ] T010 [P] [US1] Extend structured plan generation coverage in `packages/runtime/src/modules/commands/generate-task-plan-for-task.bun.test.ts`
- [ ] T011 [P] [US1] Add plan review and editing UI coverage in `apps/web/src/components/tasks/task-page.test.tsx`

### Implementation for User Story 1

- [ ] T012 [P] [US1] Add required-information, dependency, execution classification, and next-action fields to plan graph types in `packages/contracts/src/ai.ts`
- [ ] T013 [P] [US1] Normalize and persist enriched plan-node metadata in `packages/runtime/src/modules/tasks/task-plan-graph-store.ts`
- [ ] T014 [US1] Update plan generation output shaping in `packages/runtime/src/modules/commands/generate-task-plan-for-task.ts`
- [ ] T015 [P] [US1] Support structured plan editing and save operations in `apps/server/src/routes/plans.routes.ts`
- [ ] T016 [P] [US1] Expose enriched plan-state reads in `apps/server/src/routes/tasks.routes.ts`
- [ ] T017 [P] [US1] Render editable plan-step metadata and recommended next actions in `apps/web/src/components/tasks/task-page.tsx`
- [ ] T018 [P] [US1] Show readiness, dependency, and execution-type detail in `apps/web/src/components/work/task-plan-graph.tsx`

**Checkpoint**: User Story 1 is independently functional and ready to demo as the MVP.

---

## Phase 4: User Story 2 - Start scheduled work intelligently (Priority: P2)

**Goal**: Let users schedule a task or plan into actionable work blocks, start execution automatically or manually from the next eligible step, and clearly explain blocked starts.

**Independent Test**: Link a plan to a work block, trigger scheduled start or manual start, and verify Chrona either advances the next eligible automatic steps or reports the specific blocking reason without treating normal events as work.

### Tests for User Story 2

- [ ] T019 [P] [US2] Add API coverage for work-block scheduling and intelligent start in `apps/server/src/__tests__/api/work-block-execution-workflow.bun.test.ts`
- [ ] T020 [P] [US2] Extend scheduled auto-start coverage in `packages/runtime/src/modules/commands/auto-start-scheduled-plan.bun.test.ts`
- [ ] T021 [P] [US2] Add actionable work-block UI coverage in `apps/web/src/components/schedule/schedule-page.test.tsx`

### Implementation for User Story 2

- [ ] T022 [US2] Add first-class `WorkBlock` schema and task/plan linkage in `prisma/schema.prisma`
- [ ] T023 [US2] Implement work-block persistence helpers in `packages/db/src/work-block-repository.ts`
- [ ] T024 [P] [US2] Replace task-window scheduling writes with work-block creation in `packages/runtime/src/modules/commands/apply-schedule.ts`
- [ ] T025 [US2] Evaluate scheduled work-block starts from the next eligible plan step in `packages/runtime/src/modules/commands/auto-start-scheduled-plan.ts`
- [ ] T026 [US2] Continue consecutive automatic steps and stop on provider-neutral blocking conditions in `packages/runtime/src/modules/plan-execution/orchestrator.ts`
- [ ] T027 [US2] Expose work-block scheduling and manual-start APIs in `apps/server/src/routes/execution.routes.ts`
- [ ] T028 [P] [US2] Distinguish actionable work blocks from normal calendar events in `packages/runtime/src/modules/queries/get-schedule-page.ts`
- [ ] T029 [US2] Show work-block status, blocking reason, and start controls in `apps/web/src/components/schedule/schedule-page-timeline.tsx`
- [ ] T030 [P] [US2] Surface active execution state and manual-start entry points in `apps/web/src/components/work/work-page-client.tsx`

**Checkpoint**: User Story 2 can be validated independently with both scheduled and manual execution starts.

---

## Phase 5: User Story 3 - Continue execution with human review (Priority: P3)

**Goal**: Pause execution for missing input or final-output review, resume from saved progress, and restore unfinished work in later work blocks without losing context.

**Independent Test**: Run a mixed automatic/human-dependent plan, verify pause for missing input, resume after user response, require review for final AI outputs, and restore progress in a later session.

### Tests for User Story 3

- [ ] T031 [P] [US3] Add API coverage for pause, review, and continuation flows in `apps/server/src/__tests__/api/plan-execution-review-workflow.bun.test.ts`
- [ ] T032 [P] [US3] Extend resumable execution-session coverage in `packages/runtime/src/modules/plan-execution/session-policy.bun.test.ts`
- [ ] T033 [P] [US3] Add work-inspector review and continuation UI coverage in `apps/web/src/components/work/work-inspector.test.tsx`

### Implementation for User Story 3

- [ ] T034 [US3] Add first-class `ExecutionSession` persistence and review-state fields in `prisma/schema.prisma`
- [ ] T035 [US3] Implement execution-session persistence helpers in `packages/db/src/execution-session-repository.ts`
- [ ] T036 [US3] Persist pause reason, current node, and continuation metadata in `packages/runtime/src/modules/plan-execution/plan-state-store.ts`
- [ ] T037 [P] [US3] Resume paused execution from provided step input in `packages/runtime/src/modules/commands/provide-input.ts`
- [ ] T038 [P] [US3] Standardize accept, reject, and request-changes outcomes for final step results in `packages/runtime/src/modules/plan-execution/settle-node-run.ts`
- [ ] T039 [US3] Expose execution-session resume and step-review APIs in `apps/server/src/routes/execution.routes.ts`
- [ ] T040 [US3] Rebuild task/work visibility from persisted execution-session state in `packages/runtime/src/modules/projections/rebuild-task-projection.ts`
- [ ] T041 [P] [US3] Show missing-input prompts, review controls, and resume actions in `apps/web/src/components/work/work-inspector.tsx`
- [ ] T042 [P] [US3] Restore later-session progress and next-action history in `apps/web/src/components/work/execution-timeline.tsx`

**Checkpoint**: User Story 3 supports trusted human review and multi-session continuation without regressing earlier stories.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Finish sample-scenario coverage, consistency, and implementation validation across all stories.

- [ ] T043 [P] Update implementation guidance and follow-up docs in `specs/001-plan-execution-orchestration/quickstart.md`
- [ ] T044 Add end-to-end curated scenario coverage for product launch and competitor research in `apps/server/src/__tests__/api/plan-execution-sample-scenarios.bun.test.ts`
- [ ] T045 [P] Align execution-state badge rendering across plan, schedule, and work surfaces in `apps/web/src/components/ui/status-badge.tsx`
- [ ] T046 [P] Add regression coverage for unavailable execution capability blocking in `apps/server/src/routes/__tests__/task-execution-runtime.bun.test.ts`
- [ ] T047 Run `bun run typecheck`, `bun run lint`, and `bun run test`, then record any feature-specific validation notes in `specs/001-plan-execution-orchestration/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1: Setup**: No dependencies; can begin immediately.
- **Phase 2: Foundational**: Depends on Phase 1; blocks all user stories.
- **Phase 3: User Story 1**: Depends on Phase 2; provides the MVP.
- **Phase 4: User Story 2**: Depends on Phase 2 and uses the structured plan behavior from US1.
- **Phase 5: User Story 3**: Depends on Phase 2 and builds on the execution flow introduced in US2.
- **Phase 6: Polish**: Depends on the stories selected for delivery.

### User Story Dependencies

- **US1 (P1)**: Starts after foundational work and is independently testable.
- **US2 (P2)**: Starts after foundational work; it assumes the enriched plan structure from US1 exists.
- **US3 (P3)**: Starts after foundational work; it assumes the work-block start and orchestration path from US2 exists.

### Within Each User Story

- Write or extend tests before implementation and confirm they fail for the new behavior.
- Update contracts and persistence before command or route changes.
- Update runtime orchestration before UI wiring.
- Close each story only after API, runtime, and UI coverage passes.

### Suggested Execution Graph

`Setup -> Foundational -> US1 -> US2 -> US3 -> Polish`

---

## Parallel Opportunities

- **Setup**: `T002` and `T003` can run in parallel.
- **Foundational**: `T006` can run in parallel with `T004` while schema details are being finalized.
- **US1**: `T009`, `T010`, and `T011` can run in parallel; `T012` and `T013` can run in parallel; `T015`, `T016`, `T017`, and `T018` can be split across backend and frontend once `T014` lands.
- **US2**: `T019`, `T020`, and `T021` can run in parallel; `T024` and `T028` can run in parallel after `T023`; `T029` and `T030` can run in parallel after `T027`.
- **US3**: `T031`, `T032`, and `T033` can run in parallel; `T037` and `T038` can run in parallel after `T036`; `T041` and `T042` can run in parallel after `T040`.
- **Polish**: `T043`, `T045`, and `T046` can run in parallel.

---

## Parallel Example: User Story 1

```bash
# Parallel test work
Task: "T009 Extend plan lifecycle API coverage in apps/server/src/__tests__/api/plan-lifecycle-workflow.bun.test.ts"
Task: "T010 Extend structured plan generation coverage in packages/runtime/src/modules/commands/generate-task-plan-for-task.bun.test.ts"
Task: "T011 Add plan review and editing UI coverage in apps/web/src/components/tasks/task-page.test.tsx"

# Parallel implementation work after plan output shaping
Task: "T015 Support structured plan editing and save operations in apps/server/src/routes/plans.routes.ts"
Task: "T016 Expose enriched plan-state reads in apps/server/src/routes/tasks.routes.ts"
Task: "T017 Render editable plan-step metadata and recommended next actions in apps/web/src/components/tasks/task-page.tsx"
Task: "T018 Show readiness, dependency, and execution-type detail in apps/web/src/components/work/task-plan-graph.tsx"
```

## Parallel Example: User Story 2

```bash
# Parallel test work
Task: "T019 Add API coverage for work-block scheduling and intelligent start in apps/server/src/__tests__/api/work-block-execution-workflow.bun.test.ts"
Task: "T020 Extend scheduled auto-start coverage in packages/runtime/src/modules/commands/auto-start-scheduled-plan.bun.test.ts"
Task: "T021 Add actionable work-block UI coverage in apps/web/src/components/schedule/schedule-page.test.tsx"

# Parallel implementation work after work-block persistence exists
Task: "T024 Replace task-window scheduling writes with work-block creation in packages/runtime/src/modules/commands/apply-schedule.ts"
Task: "T028 Distinguish actionable work blocks from normal calendar events in packages/runtime/src/modules/queries/get-schedule-page.ts"
Task: "T030 Surface active execution state and manual-start entry points in apps/web/src/components/work/work-page-client.tsx"
```

## Parallel Example: User Story 3

```bash
# Parallel test work
Task: "T031 Add API coverage for pause, review, and continuation flows in apps/server/src/__tests__/api/plan-execution-review-workflow.bun.test.ts"
Task: "T032 Extend resumable execution-session coverage in packages/runtime/src/modules/plan-execution/session-policy.bun.test.ts"
Task: "T033 Add work-inspector review and continuation UI coverage in apps/web/src/components/work/work-inspector.test.tsx"

# Parallel implementation work after execution-session state persistence lands
Task: "T037 Resume paused execution from provided step input in packages/runtime/src/modules/commands/provide-input.ts"
Task: "T038 Standardize accept, reject, and request-changes outcomes for final step results in packages/runtime/src/modules/plan-execution/settle-node-run.ts"
Task: "T041 Show missing-input prompts, review controls, and resume actions in apps/web/src/components/work/work-inspector.tsx"
Task: "T042 Restore later-session progress and next-action history in apps/web/src/components/work/execution-timeline.tsx"
```

---

## Implementation Strategy

### MVP First

1. Complete Phase 1 and Phase 2.
2. Deliver Phase 3 (US1) as the first end-to-end increment.
3. Validate plan generation, editing, and saved-plan reuse before moving on.

### Incremental Delivery

1. Deliver US1 to make structured plans the source of truth.
2. Deliver US2 to convert planning into actionable scheduled or manual execution starts.
3. Deliver US3 to add human review, pause/resume, and later-session continuation.
4. Finish with cross-cutting scenario coverage and validation.

### Parallel Team Strategy

1. One engineer can own persistence/contracts (`T004`-`T008`).
2. A second engineer can focus on API/runtime flow per story.
3. A third engineer can focus on story-specific UI and test coverage once contracts settle.

---

## Notes

- All tasks follow the required checklist format.
- Story phases map directly to the P1, P2, and P3 user stories from `spec.md`.
- The task list keeps DB access in `packages/db`, server adapters in `apps/server/src/routes`, runtime logic in `packages/runtime`, and shared contracts in `packages/contracts`.
- The sample scenarios called out in the spec are covered explicitly in `T044`.
