---

description: "Task list for hardening Chrona execution kernel"
---

# Tasks: Harden Execution Kernel

**Input**: Design documents from `specs/013-harden-execution-kernel/`  
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/execution-kernel-contract.md`, `quickstart.md`

**Tests**: Required by specification and constitution. Write regression tests before implementation and confirm they fail against the current behavior.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Prepare the execution-kernel work area and baseline failing evidence.

- [X] T001 Create `specs/013-harden-execution-kernel/verification/` for test outputs, focused command logs, and final validation notes
- [X] T002 [P] Record current execution-kernel baseline failure command in `specs/013-harden-execution-kernel/verification/baseline-duplicate-execution.md`
- [X] T003 [P] Review current DB schema fields for task plan runs, execution sessions, runs, and events in `packages/db/prisma/schema.prisma`
- [X] T004 [P] Review current execution entry points and list files to be gated in `specs/013-harden-execution-kernel/verification/execution-entrypoints.md`
- [X] T005 [P] Review existing plan-execution regression test helpers in `packages/engine/src/modules/plan-execution/plan-runner.task-executor.continuation.bun.test.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Add the shared model and helpers required by every user story.

**Critical**: No user story implementation can begin until this phase is complete.

- [X] T006 Add execution ownership, epoch, node attempt, and provider-run idempotency fields/models in `packages/db/prisma/schema.prisma`
- [X] T007 Generate/update database client artifacts for the schema changes under `packages/db/`
- [X] T008 Create execution ownership persistence helpers in `packages/engine/src/modules/plan-execution/persistence/execution-lease-store.ts`
- [X] T009 [P] Create execution fencing helper types and validation functions in `packages/engine/src/modules/plan-execution/runtime/execution-fencing.ts`
- [X] T010 [P] Create node attempt idempotency helper types and key derivation in `packages/engine/src/modules/plan-execution/runtime/node-attempt-idempotency.ts`
- [X] T011 [P] Add unit tests for fencing token validation in `packages/engine/src/modules/plan-execution/runtime/execution-fencing.bun.test.ts`
- [X] T012 [P] Add unit tests for node attempt idempotency key derivation in `packages/engine/src/modules/plan-execution/runtime/node-attempt-idempotency.bun.test.ts`
- [X] T013 Add shared execution event classification constants for accepted, ignored, stale, and diagnostic events in `packages/engine/src/modules/plan-execution/runtime/execution-events.ts`
- [X] T014 Update plan-run persistence to read/write the new authoritative execution fields in `packages/engine/src/modules/plan-execution/plan-run-store.ts`
- [X] T015 Update runtime-state persistence to remove conflicting unpublished legacy result authority in `packages/engine/src/modules/plan-execution/persistence/plan-runtime-store.ts`
- [X] T016 Run focused foundational tests for fencing and idempotency helpers and record output in `specs/013-harden-execution-kernel/verification/foundation-tests.md`

**Checkpoint**: Foundation ready. Execution ownership, fencing, idempotency helpers, and persistence fields exist.

---

## Phase 3: User Story 1 - Prevent duplicate node execution (Priority: P1) MVP

**Goal**: Each plan node executes at most once per intended attempt, even when execution triggers overlap.

**Independent Test**: Start the same task plan run through overlapping triggers and verify that exactly one owner, one node attempt, and one provider-side run are created for the active node.

### Tests for User Story 1

- [X] T017 [P] [US1] Add failing integration test for concurrent start/continue triggers in `packages/engine/src/modules/plan-execution/plan-runner.task-executor.continuation.bun.test.ts`
- [X] T018 [P] [US1] Add failing integration test for duplicate provider-run prevention on an existing running node attempt in `packages/engine/src/modules/plan-execution/plan-runner.task-executor.continuation.bun.test.ts`
- [X] T019 [P] [US1] Add failing integration test for completed-node resume not creating a new provider run in `packages/engine/src/modules/plan-execution/plan-runner.task-executor.continuation.bun.test.ts`

### Implementation for User Story 1

- [X] T020 [US1] Wrap manual start and continuation advancement with execution ownership acquisition in `packages/engine/src/modules/plan-execution/task-plan-execution.ts`
- [X] T021 [US1] Ensure overlapping owners return already-in-progress without executing provider work in `packages/engine/src/modules/plan-execution/task-plan-execution.ts`
- [X] T022 [US1] Persist node attempts before provider invocation in `packages/engine/src/modules/plan-execution/task-plan-execution.ts`
- [X] T023 [US1] Reuse existing provider run for the same node attempt in `packages/engine/src/modules/plan-execution/ai-runtime-invoker.ts`
- [X] T024 [US1] Pass stable node attempt identity into provider capability execution in `packages/engine/src/modules/plan-execution/node-ai-capabilities.ts`
- [X] T025 [US1] Prevent completed nodes from re-entering provider execution during resume or recovery in `packages/graph-runtime/src/resolve.ts`
- [X] T026 [US1] Update graph execution to observe existing running attempts instead of creating duplicates in `packages/graph-runtime/src/execution/run-graph-execution.ts`
- [X] T027 [US1] Record ignored overlapping execution triggers as diagnostic events in `packages/engine/src/modules/plan-execution/task-plan-execution.ts`
- [X] T028 [US1] Run US1 focused tests and record output in `specs/013-harden-execution-kernel/verification/us1-duplicate-execution.md`

**Checkpoint**: User Story 1 is independently complete when duplicate provider-side runs for the same node attempt are zero.

---

## Phase 4: User Story 2 - Make stop and pause authoritative (Priority: P1)

**Goal**: Stop and pause prevent automatic continuation until explicit user action, even when late callbacks or scheduler ticks arrive.

**Independent Test**: Pause or stop while provider work is active, deliver a late callback, and verify that no downstream node starts and prior completed results remain effective.

### Tests for User Story 2

- [X] T029 [P] [US2] Add failing integration test for pause with late provider callback not resuming execution in `packages/engine/src/modules/plan-execution/plan-runner.task-executor.continuation.bun.test.ts`
- [X] T030 [P] [US2] Add failing integration test for stop with late provider callback not starting downstream work in `packages/engine/src/modules/plan-execution/plan-runner.task-executor.continuation.bun.test.ts`
- [X] T031 [P] [US2] Add failing integration test that stop preserves earlier completed node results in `packages/engine/src/modules/plan-execution/plan-runner.task-executor.continuation.bun.test.ts`
- [X] T032 [P] [US2] Add scheduler regression test for stopped task not auto-advancing in `packages/engine/src/modules/orchestration/graph-advancement-worker.bun.test.ts`

### Implementation for User Story 2

- [X] T033 [US2] Apply fencing checks to runtime result sync before mutating execution state in `packages/engine/src/modules/plan-execution/use-cases/sync-runtime-result/sync-plan-run-runtime-result.ts`
- [X] T034 [US2] Prevent runtime result sync from creating a new active execution session after pause or stop in `packages/engine/src/modules/plan-execution/use-cases/sync-runtime-result/sync-plan-run-runtime-result.ts`
- [X] T035 [US2] Change cancel/stop state updates to affect active running work only in `packages/graph-runtime/src/commands/state-updates.ts`
- [X] T036 [US2] Ensure pause state blocks automatic terminal-result continuation in `packages/engine/src/modules/plan-execution/use-cases/submit-terminal-node-result.ts`
- [X] T037 [US2] Make scheduler advancement require execution ownership and skip paused/stopped tasks in `packages/engine/src/modules/orchestration/graph-advancement-worker.ts`
- [X] T038 [US2] Make restart recovery observe stopped/paused authority without auto-resuming in `packages/engine/src/modules/orchestration/restart-recovery-worker.ts`
- [X] T039 [US2] Record late callbacks after pause/stop as stale or ignored events in `packages/engine/src/modules/plan-execution/use-cases/sync-runtime-result/sync-plan-run-runtime-result.ts`
- [X] T040 [US2] Run US2 focused tests and record output in `specs/013-harden-execution-kernel/verification/us2-stop-pause.md`

**Checkpoint**: User Story 2 is independently complete when stop and pause stay authoritative across late callbacks and scheduler checks.

---

## Phase 5: User Story 3 - Keep node results stable and auditable (Priority: P2)

**Goal**: Completed node results remain stable, traceable, and tied to the exact attempt that produced them.

**Independent Test**: Run a multi-node task with callbacks, pause/resume, and recovery events, then verify that each node result, attempt, provider run, and ignored stale event remains consistent.

### Tests for User Story 3

- [X] T041 [P] [US3] Add integration test for completed node result stability through downstream failure/pause/stop in `packages/engine/src/modules/plan-execution/plan-runner.task-executor.continuation.bun.test.ts`
- [X] T042 [P] [US3] Add integration test for stale callback being recorded without overwriting effective result in `packages/engine/src/modules/plan-execution/plan-runner.task-executor.continuation.bun.test.ts`
- [X] T043 [P] [US3] Add explicit retry replacement test in `packages/engine/src/modules/plan-execution/plan-runner.retry.bun.test.ts`
- [X] T044 [P] [US3] Add projection consistency test for task detail and plan graph node result fields in `packages/engine/src/modules/tasks/task-projection.bun.test.ts`

### Implementation for User Story 3

- [X] T045 [US3] Replace current/obsolete result mutation rules with effective/superseded/stale semantics in `packages/graph-runtime/src/execution-state.ts`
- [X] T046 [US3] Update sync external result state to reject stale attempt results and preserve effective results in `packages/graph-runtime/src/commands/state-updates.ts`
- [X] T047 [US3] Update retry-node behavior to create a new node attempt and supersede result only through explicit retry in `packages/graph-runtime/src/commands/state-updates.ts`
- [X] T048 [US3] Update effective graph resolution to derive completion from authoritative node attempts/results in `packages/graph-runtime/src/resolve.ts`
- [X] T049 [US3] Update task plan graph view-model mapping for stable effective results in `apps/web/src/components/tasks/plan/task-plan-view-model.ts`
- [X] T050 [US3] Update inspector result panel copy or fields for stale/ignored result evidence if needed in `apps/web/src/components/tasks/plan/task-plan-graph/inspector-run-panel.tsx`
- [X] T051 [US3] Add or update localized messages for stale callbacks and ignored events in `apps/web/src/lib/i18n/messages.ts`
- [X] T052 [US3] Run US3 focused tests and record output in `specs/013-harden-execution-kernel/verification/us3-result-stability.md`
- [X] T053 [US3] If UI status/history changed, capture agent-browser desktop/tablet/mobile evidence in `specs/013-harden-execution-kernel/verification/us3-browser.md`

**Checkpoint**: User Story 3 is independently complete when completed results remain stable and stale events are auditable.

---

## Phase 6: User Story 4 - Preserve strict serial execution by default (Priority: P2)

**Goal**: A DAG with independent ready branches still runs only one provider-backed node at a time in default serial mode.

**Independent Test**: Use a plan with multiple ready independent nodes, trigger execution from multiple sources, and verify no more than one provider-backed node is running at any time.

### Tests for User Story 4

- [X] T054 [P] [US4] Add serial DAG branch test for one active provider-backed node in `packages/engine/src/modules/plan-execution/plan-runner.task-executor.continuation.bun.test.ts`
- [X] T055 [P] [US4] Add scheduler-overlap serial branch test in `packages/engine/src/modules/orchestration/graph-advancement-worker.bun.test.ts`
- [X] T056 [P] [US4] Add terminal-continuation overlap serial branch test in `packages/engine/src/modules/plan-execution/plan-runner.task-executor.continuation.bun.test.ts`

### Implementation for User Story 4

- [X] T057 [US4] Enforce serial provider-backed node limit at execution ownership boundary in `packages/engine/src/modules/plan-execution/task-plan-execution.ts`
- [X] T058 [US4] Ensure ready independent branches wait while another provider-backed node attempt is running in `packages/graph-runtime/src/resolve.ts`
- [X] T059 [US4] Ensure terminal-result continuation cannot start a second ready branch while a provider-backed attempt is running in `packages/engine/src/modules/plan-execution/use-cases/submit-terminal-node-result.ts`
- [X] T060 [US4] Ensure scheduler cannot bypass serial mode through direct task start in `packages/engine/src/modules/orchestration/graph-advancement-worker.ts`
- [X] T061 [US4] Run US4 focused tests and record output in `specs/013-harden-execution-kernel/verification/us4-serial-branches.md`

**Checkpoint**: User Story 4 is independently complete when serial execution remains strict across manual, scheduler, runtime callback, and terminal continuation triggers.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Remove legacy conflict paths, validate whole-system behavior, and capture release evidence.

- [X] T062 Remove unpublished legacy execution-session/result compatibility code that conflicts with the new model in `packages/engine/src/modules/plan-execution/persistence/execution-session-store.ts`
- [X] T063 Remove or rewrite legacy plan-run node state derivation that conflicts with authoritative attempts/results in `packages/engine/src/modules/plan-execution/plan-run-store.ts`
- [X] T064 [P] Update execution-kernel contract notes with final behavior in `specs/013-harden-execution-kernel/contracts/execution-kernel-contract.md`
- [X] T065 [P] Update quickstart validation notes with final commands in `specs/013-harden-execution-kernel/quickstart.md`
- [X] T066 Run `bun run typecheck` and record output in `specs/013-harden-execution-kernel/verification/typecheck.md`
- [X] T067 Run `bun run lint` and record output in `specs/013-harden-execution-kernel/verification/lint.md`
- [X] T068 Run `bun run test` and record output in `specs/013-harden-execution-kernel/verification/test.md`
- [X] T069 Run `bun run test:e2e` and record output in `specs/013-harden-execution-kernel/verification/test-e2e.md`
- [X] T070 Run the quickstart validation flow and record final results in `specs/013-harden-execution-kernel/verification/quickstart.md`
- [X] T071 Run GitNexus detect changes before commit and record affected scope in `specs/013-harden-execution-kernel/verification/gitnexus-detect-changes.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup completion and blocks all user stories.
- **US1 (Phase 3)**: Depends on Foundational; MVP scope.
- **US2 (Phase 4)**: Depends on Foundational; can run after or alongside US1 with care, but final stop/pause behavior must respect US1 ownership model.
- **US3 (Phase 5)**: Depends on Foundational and benefits from US1/US2 semantics, but result-stability tests can be written independently.
- **US4 (Phase 6)**: Depends on Foundational and US1 ownership behavior.
- **Polish (Phase 7)**: Depends on selected user stories being complete.

### User Story Dependencies

- **User Story 1 (P1)**: Required MVP; no dependency on other stories after foundation.
- **User Story 2 (P1)**: Depends on the same ownership/fencing foundation; integrates with US1 owner semantics.
- **User Story 3 (P2)**: Depends on authoritative attempt/result model from foundation and should verify behavior across US1/US2 flows.
- **User Story 4 (P2)**: Depends on US1 ownership semantics and serial-mode enforcement.

### Within Each User Story

- Tests must be written first and fail against current behavior.
- Persistence/model changes before service integration.
- Ownership/fencing before provider invocation changes.
- Provider idempotency before scheduler/recovery acceptance.
- Focused verification before moving to the next story checkpoint.

## Parallel Opportunities

- T002-T005 can run in parallel after T001.
- T009-T013 can run in parallel after T006-T008 are started, because they touch separate helper/test files.
- US1 tests T017-T019 can be written in parallel.
- US2 tests T029-T032 can be written in parallel.
- US3 tests T041-T044 can be written in parallel.
- US4 tests T054-T056 can be written in parallel.
- Documentation polish T064-T065 can run in parallel with final validation commands after implementation is complete.

## Parallel Example: User Story 1

```bash
Task: "Add failing integration test for concurrent start/continue triggers in packages/engine/src/modules/plan-execution/plan-runner.task-executor.continuation.bun.test.ts"
Task: "Add failing integration test for duplicate provider-run prevention on an existing running node attempt in packages/engine/src/modules/plan-execution/plan-runner.task-executor.continuation.bun.test.ts"
Task: "Add failing integration test for completed-node resume not creating a new provider run in packages/engine/src/modules/plan-execution/plan-runner.task-executor.continuation.bun.test.ts"
```

## Parallel Example: User Story 2

```bash
Task: "Add failing integration test for pause with late provider callback not resuming execution in packages/engine/src/modules/plan-execution/plan-runner.task-executor.continuation.bun.test.ts"
Task: "Add failing integration test for stop with late provider callback not starting downstream work in packages/engine/src/modules/plan-execution/plan-runner.task-executor.continuation.bun.test.ts"
Task: "Add scheduler regression test for stopped task not auto-advancing in packages/engine/src/modules/orchestration/graph-advancement-worker.bun.test.ts"
```

## Parallel Example: User Story 3

```bash
Task: "Add integration test for completed node result stability through downstream failure/pause/stop in packages/engine/src/modules/plan-execution/plan-runner.task-executor.continuation.bun.test.ts"
Task: "Add explicit retry replacement test in packages/engine/src/modules/plan-execution/plan-runner.retry.bun.test.ts"
Task: "Add projection consistency test for task detail and plan graph node result fields in packages/engine/src/modules/tasks/task-projection.bun.test.ts"
```

## Parallel Example: User Story 4

```bash
Task: "Add serial DAG branch test for one active provider-backed node in packages/engine/src/modules/plan-execution/plan-runner.task-executor.continuation.bun.test.ts"
Task: "Add scheduler-overlap serial branch test in packages/engine/src/modules/orchestration/graph-advancement-worker.bun.test.ts"
Task: "Add terminal-continuation overlap serial branch test in packages/engine/src/modules/plan-execution/plan-runner.task-executor.continuation.bun.test.ts"
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 setup.
2. Complete Phase 2 foundation.
3. Complete US1 tests and implementation.
4. Validate that overlapping triggers cannot create duplicate provider-side work.
5. Stop and review before implementing stop/pause and result-stability stories.

### Incremental Delivery

1. Foundation creates execution ownership, fencing, and node attempt identity.
2. US1 eliminates duplicate execution.
3. US2 makes pause/stop authoritative.
4. US3 stabilizes result projection and audit history.
5. US4 hardens serial DAG branch behavior.
6. Polish removes unpublished legacy conflict paths and runs full validation.

### Validation Strategy

1. Every bug scenario gets a red regression test before production code changes.
2. Focused tests run at each user-story checkpoint.
3. Full checks run in Phase 7: `bun run typecheck`, `bun run lint`, `bun run test`, `bun run test:e2e`.
4. Browser evidence is required only if visible task status/history UI changes.

## Notes

- `[P]` tasks touch different files or are safe to perform in parallel.
- `[US1]` through `[US4]` map to the user stories in `spec.md`.
- No compatibility layer for unpublished legacy execution state should be added.
- Do not introduce an OpenWorkflow runtime dependency for this feature.
- Stop at each checkpoint and verify the story independently before expanding scope.
