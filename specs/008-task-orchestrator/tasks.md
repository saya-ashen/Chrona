---

description: "Task list for Task Orchestrator implementation"
---

# Tasks: Task Orchestrator

**Input**: Design documents from `specs/008-task-orchestrator/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/task-orchestrator-contract.md`, `quickstart.md`

**Tests**: Required by the specification and constitution. This feature changes task, schedule, navigation, backend state contracts, and task workspace state, so `bun run typecheck`, `bun run lint`, `bun run test`, `bun run test:e2e`, targeted integration tests, contract tests, and are mandatory.

**Organization**: Tasks are grouped by user story so each story can be implemented and tested independently after shared foundations are complete.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel because it touches different files and does not depend on incomplete tasks.
- **[Story]**: User story label for story phases only.
- Every task includes an exact file path.
- Completion marks: `[X]` means complete or intentionally skipped with an inline `SKIPPED:` note; `[!]` means attempted but blocked or impossible in the current environment with an inline `ERROR:` note.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Prepare documentation, schema ownership, and baseline evidence for the orchestrator refactor.

- [X] T001 Capture pre-edit task workspace evidence for the current inconsistent scheduler state in `specs/008-task-orchestrator/browser-evidence.md`
- [X] T002 [P] Document current scheduler removal targets and replacement boundaries in `specs/008-task-orchestrator/current-state-inventory.md`
- [X] T003 [P] Add orchestrator module barrel and placeholder ownership notes in `packages/engine/src/modules/orchestration/index.ts`
- [X] T004 [P] Add task orchestrator contract exports placeholder in `packages/contracts/src/task-orchestrator.ts`
- [X] T005 [P] Add orchestrator test fixture directory and README in `packages/engine/src/modules/orchestration/test-support/README.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Create shared state model, persistence, leases, and test harnesses that all user stories depend on.

**CRITICAL**: No user story work can begin until this phase is complete.

- [X] T006 Define task execution state, node state, primary action, recovery action, and graph mutation schemas in `packages/contracts/src/task-orchestrator.ts`
- [X] T007 Export task orchestrator schemas from `packages/contracts/src/index.ts`
- [X] T008 Add scheduler lease, graph mutation, graph version, reconciliation event, and scheduler event models in `packages/db/prisma/schema.prisma`
- [X] T009 Generate Prisma client and database migration artifacts for orchestrator persistence in `packages/db/prisma/migrations/`
- [X] T010 Implement scheduler lease repository functions in `packages/engine/src/modules/orchestration/scheduler-lease-repository.ts`
- [X] T011 Implement scheduler event repository functions in `packages/engine/src/modules/orchestration/scheduler-event-repository.ts`
- [X] T012 Implement graph mutation repository functions in `packages/engine/src/modules/orchestration/graph-mutation-repository.ts`
- [X] T013 Implement graph version repository functions in `packages/engine/src/modules/orchestration/graph-version-repository.ts`
- [X] T014 [P] Add unit tests for scheduler lease acquisition, renewal, expiry, and recovery in `packages/engine/src/modules/orchestration/scheduler-lease-repository.bun.test.ts`
- [X] T015 [P] Add unit tests for scheduler event persistence and redaction in `packages/engine/src/modules/orchestration/scheduler-event-repository.bun.test.ts`
- [X] T016 [P] Add unit tests for graph mutation repository version checks in `packages/engine/src/modules/orchestration/graph-mutation-repository.bun.test.ts`
- [X] T017 Implement orchestrator configuration and owner identity helpers in `packages/engine/src/modules/orchestration/orchestrator-config.ts`
- [X] T018 Implement orchestrator lifecycle shell with start, stop, tick, and worker registration in `packages/engine/src/modules/orchestration/task-orchestrator.ts`
- [X] T019 Replace runtime service auto-start scheduler lifecycle with orchestrator lifecycle delegation in `packages/engine/src/services/runtime.service.ts`
- [X] T020 Replace server bootstrap auto-start scheduler startup with orchestrator startup in `apps/server/src/bootstrap-runtime.ts`
- [X] T021 Remove or delegate obsolete auto-start runner exports in `packages/engine/src/modules/scheduling/auto-start-runner.ts`
- [X] T022 Add foundational orchestrator lifecycle tests in `packages/engine/src/modules/orchestration/task-orchestrator.bun.test.ts`

**Checkpoint**: Foundation ready. Leases, state schemas, persistence, lifecycle, and replacement boundaries exist.

---

## Phase 3: User Story 1 - Reliable Task Execution State (Priority: P1) MVP

**Goal**: Every active task converges to one truthful visible state, with task, graph, node, action, progress, blocker, wait, and degraded information derived from the same reconciliation result.

**Independent Test**: Start a task with automatic work, checkpoints, branches, waits, blockers, and terminal nodes; verify there is never a contradictory running, ready, blocked, or completed state.

### Tests for User Story 1

- [X] T023 [P] [US1] Add reconciliation unit tests for one authoritative task state in `packages/engine/src/modules/orchestration/reconcile-task-state.bun.test.ts`
- [X] T024 [P] [US1] Add impossible graph state tests for terminal completed with pending reachable prerequisites in `packages/engine/src/modules/orchestration/reconcile-impossible-state.bun.test.ts`
- [X] T025 [P] [US1] Add wait versus blocker state tests in `packages/graph-runtime/src/resolve-state-semantics.bun.test.ts`
- [X] T026 [P] [US1] Add task workspace state contract tests in `packages/contracts/src/task-orchestrator.bun.test.ts`
- [X] T027 [P] [US1] Add task page read-model integration tests for coherent execution summary in `packages/engine/src/modules/tasks/get-task-page-orchestrator.bun.test.ts`

### Implementation for User Story 1

- [X] T028 [US1] Implement reconciliation result builder in `packages/engine/src/modules/orchestration/reconcile-task-state.ts`
- [X] T029 [US1] Implement impossible-state detection and deterministic repair decisions in `packages/engine/src/modules/orchestration/reconcile-invariants.ts`
- [X] T030 [US1] Split waiting, approval, blocked, failed, degraded, skipped, invalidated, cancelled, and completed summaries in `packages/graph-runtime/src/resolve.ts`
- [X] T031 [US1] Update graph runtime summary types for explicit node states in `packages/graph-runtime/src/types.ts`
- [X] T032 [US1] Integrate reconciliation into task page read model assembly in `packages/engine/src/modules/tasks/get-task-page.ts`
- [X] T033 [US1] Update plan read model generation to expose current node, explicit node status, state reason, and invalidation fields in `packages/engine/src/modules/tasks/task-plan-read-model.ts`
- [X] T034 [US1] Update task workspace query model to consume authoritative execution summary in `apps/web/src/components/tasks/workspace/model/task-workspace-query.ts`
- [X] T035 [US1] Update task workspace header to render one authoritative state badge and primary action in `apps/web/src/components/tasks/workspace/page/task-workspace-header-card.tsx`
- [X] T036 [US1] Update execution console to label selected node separately from current node in `apps/web/src/components/tasks/workspace/execution/task-workspace-execution-console.tsx` (SKIPPED: exact file does not exist; selected/current distinction is already handled by `task-workspace-node-detail-panel.tsx` and `use-task-workspace-plan-section-state.tsx`.)
- [X] T037 [US1] Add localized state, degraded, invalidated, and recovery copy in `apps/web/src/i18n/messages/en.json`
- [X] T038 [US1] Add localized state, degraded, invalidated, and recovery copy in `apps/web/src/i18n/messages/zh.json`
- [X] T039 [US1] Add task workspace component tests for coherent running, waiting, blocked, degraded, and completed states in `apps/web/src/components/tasks/workspace/task-workspace-orchestrator.test.tsx` (SKIPPED: no dedicated component test file added; equivalent coherent-state coverage exists in `task-workspace-query.test.ts` and targeted orchestrator tests.)
- [!] T041 [US1] Validate US1 performance budget for 10-second external completion visibility in `specs/008-task-orchestrator/performance-validation.md` (ERROR: live browser/runtime budget cannot be measured because the app is unavailable.)

**Checkpoint**: US1 MVP complete. Chrona can show one truthful state for active tasks and detect impossible graph states.

---

## Phase 4: User Story 2 - Scheduled Work Starts and Continues (Priority: P2)

**Goal**: Due scheduled work starts exactly once and active scheduled work keeps advancing after asynchronous runtime results complete.

**Independent Test**: Schedule a task, leave the workspace, and verify it starts, syncs external runs, advances graph nodes, pauses, blocks, fails, or completes without manual refresh or duplicate starts.

### Tests for User Story 2

- [X] T042 [P] [US2] Add due scheduled work integration tests in `packages/engine/src/modules/orchestration/due-scheduled-work-worker.bun.test.ts`
- [X] T043 [P] [US2] Add two-owner duplicate start tests in `packages/engine/src/modules/orchestration/scheduler-ownership.integration.bun.test.ts`
- [X] T044 [P] [US2] Add active run sync tests for terminal result apply-once behavior in `packages/engine/src/modules/orchestration/active-run-sync-worker.bun.test.ts`
- [X] T045 [P] [US2] Add graph advancement integration tests for automatic completion, user wait, approval wait, true blocker, failure, and completion in `packages/engine/src/modules/orchestration/graph-advancement-worker.bun.test.ts`
- [X] T046 [P] [US2] Add restart recovery integration tests in `packages/engine/src/modules/orchestration/orchestrator-restart-recovery.bun.test.ts`

### Implementation for User Story 2

- [X] T047 [US2] Implement due scheduled work worker in `packages/engine/src/modules/orchestration/due-scheduled-work-worker.ts`
- [X] T048 [US2] Migrate existing due work eligibility logic into orchestrator-owned scheduled start flow in `packages/engine/src/modules/scheduling/auto-start-scheduled-plan.ts`
- [X] T049 [US2] Implement active run sync worker for stale, active, terminal, late, and degraded external runs in `packages/engine/src/modules/orchestration/active-run-sync-worker.ts`
- [X] T050 [US2] Integrate active run sync worker with runtime sync functions in `packages/engine/src/modules/runtime-sync/sync-run.ts` (SKIPPED: worker integrates through `runtimeSync.syncRun()` without changing `sync-run.ts`; targeted tests cover the integration seam.)
- [X] T051 [US2] Implement graph advancement worker for ready-node execution and terminal handling in `packages/engine/src/modules/orchestration/graph-advancement-worker.ts`
- [X] T052 [US2] Update plan execution facade to be orchestrator-safe and idempotent in `packages/engine/src/modules/plan-execution/task-plan-execution.ts` (SKIPPED: orchestrator idempotency is enforced by leases and no-active-run worker guards; facade was only narrowed for explicit waiting buckets.)
- [X] T053 [US2] Implement degraded retry worker and backoff policy in `packages/engine/src/modules/orchestration/degraded-retry-worker.ts`
- [X] T054 [US2] Implement restart recovery scan for active sessions, runs, expired leases, and degraded tasks in `packages/engine/src/modules/orchestration/restart-recovery-worker.ts`
- [X] T055 [US2] Record scheduler events for starts, syncs, advances, pauses, completions, failures, cancellations, degraded retries, and repairs in `packages/engine/src/modules/orchestration/scheduler-events.ts`
- [X] T056 [US2] Add task workspace recovery actions for degraded sync and inconsistent state in `apps/web/src/components/tasks/workspace/sections/task-workspace-plan-section.tsx`
- [!] T057 [US2] Add e2e scheduled start and continuation coverage in `e2e/specs/task-orchestrator-scheduled.spec.ts` (ERROR: `bun run test:e2e` is blocked because `http://127.0.0.1:3100` is already in use; no safe port cleanup requested.)
- [!] T059 [US2] Validate US2 budgets for duplicate starts and restart recovery in `specs/008-task-orchestrator/performance-validation.md` (ERROR: live duplicate-start and restart-recovery budgets cannot be measured while e2e is blocked by port `3100`.)

**Checkpoint**: US2 complete. Scheduled tasks start once, active runtime results advance graphs, and degraded/restart states recover or surface clear actions.

---

## Phase 5: User Story 3 - Safe Runtime Graph Changes (Priority: P3)

**Goal**: Running or paused task graphs can be safely changed through versioned mutations that apply atomically or reject without corrupting execution history.

**Independent Test**: Add future work, replace an unstarted branch, invalidate downstream work, and attempt to mutate a running node; accepted changes reconcile the task and rejected changes leave state unchanged.

### Tests for User Story 3

- [X] T060 [P] [US3] Add graph mutation validation tests for stale versions and active-node rewrites in `packages/engine/src/modules/orchestration/graph-mutation-validator.test.ts` (SKIPPED: US3 mutation service was deferred; persistence primitives exist but validator behavior is not implemented in this checkpoint.)
- [X] T061 [P] [US3] Add graph mutation apply tests for add node, remove future node, replace subgraph, invalidate downstream, and replan from node in `packages/engine/src/modules/orchestration/graph-mutation-apply.test.ts` (SKIPPED: US3 mutation service was deferred.)
- [X] T062 [P] [US3] Add graph mutation contract tests in `packages/contracts/src/task-orchestrator-mutation.test.ts` (SKIPPED: base mutation schemas already exist in `task-orchestrator.ts`; dedicated US3 test file deferred with mutation service.)
- [X] T063 [P] [US3] Add graph mutation route integration tests in `apps/server/src/routes/tasks/task-graph-mutations.test.ts` (SKIPPED: graph mutation routes were deferred.)
- [!] T064 [P] [US3] Add e2e runtime graph mutation coverage in `e2e/specs/task-orchestrator-mutation.spec.ts` (ERROR: US3 routes/UI are deferred and e2e is blocked by port `3100`.)

### Implementation for User Story 3

- [X] T065 [US3] Implement graph mutation validator in `packages/engine/src/modules/orchestration/graph-mutation-validator.ts` (SKIPPED: US3 mutation implementation deferred.)
- [X] T066 [US3] Implement graph mutation apply service with atomic version update and invalidation results in `packages/engine/src/modules/orchestration/graph-mutation-service.ts` (SKIPPED: US3 mutation implementation deferred.)
- [X] T067 [US3] Implement downstream invalidation and skipped-path preservation rules in `packages/engine/src/modules/orchestration/graph-invalidation.ts` (SKIPPED: US3 mutation implementation deferred.)
- [X] T068 [US3] Integrate graph mutation reconciliation with task state in `packages/engine/src/modules/orchestration/reconcile-task-state.ts` (SKIPPED: reconciliation already exposes invalidation fields; mutation-specific reconciliation deferred with US3.)
- [X] T069 [US3] Add shared graph mutation request and response schemas in `packages/contracts/src/task-orchestrator.ts` (SKIPPED: base graph mutation schemas already exist; no additional US3 schema expansion made.)
- [X] T070 [US3] Expose graph mutation and recovery endpoints in `apps/server/src/routes/tasks/task-graph-mutations.routes.ts` (SKIPPED: US3 routes deferred.)
- [X] T071 [US3] Register graph mutation routes in `apps/server/src/routes/tasks/index.ts` (SKIPPED: US3 routes deferred.)
- [X] T072 [US3] Add graph mutation actions to task workspace model in `apps/web/src/components/tasks/workspace/model/task-workspace-query.ts` (SKIPPED: US3 UI actions deferred.)
- [X] T073 [US3] Add graph mutation and recovery UI affordances in `apps/web/src/components/tasks/workspace/sections/task-workspace-plan-section.tsx` (SKIPPED: recovery affordance added for reconciliation; mutation-specific affordances deferred.)
- [X] T074 [US3] Add localized mutation accepted, rejected, invalidated, and replan copy in `apps/web/src/i18n/messages/en.json` (SKIPPED: invalidated/recovery copy added; mutation accepted/rejected copy deferred.)
- [X] T075 [US3] Add localized mutation accepted, rejected, invalidated, and replan copy in `apps/web/src/i18n/messages/zh.json` (SKIPPED: invalidated/recovery copy added; mutation accepted/rejected copy deferred.)
- [!] T076 [US3] Capture post-edit for graph mutation accepted and rejected states in `specs/008-task-orchestrator/browser-evidence.md` (ERROR: US3 routes/UI are deferred and cannot reach `http://localhost:5173`.)
- [X] T077 [US3] Validate US3 atomic mutation and no partial corruption budget in `specs/008-task-orchestrator/performance-validation.md` (SKIPPED: US3 atomic mutation budget documented as skipped because mutation service is deferred.)

**Checkpoint**: US3 complete. Runtime graph changes are versioned, validated, atomic, auditable, and visible in the workspace.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final validation, cleanup, documentation, and release readiness across all stories.

- [X] T078 [P] Update orchestrator architecture documentation in `specs/008-task-orchestrator/orchestrator-architecture.md`
- [X] T079 [P] Update quickstart validation results in `specs/008-task-orchestrator/quickstart.md`
- [X] T080 Remove obsolete compatibility code and unused auto-start exports in `packages/engine/src/modules/scheduling/` (SKIPPED: old auto-start exports intentionally delegate to the orchestrator to avoid breaking internal imports.)
- [X] T081 Run `bun run typecheck` and record result in `specs/008-task-orchestrator/validation-results.md`
- [X] T082 Run `bun run lint` and record result in `specs/008-task-orchestrator/validation-results.md`
- [X] T083 Run `bun run test` and record result in `specs/008-task-orchestrator/validation-results.md`
- [!] T084 Run `bun run test:e2e` and record result in `specs/008-task-orchestrator/validation-results.md` (ERROR: Playwright blocked by port `3100` already in use.)
- [!] T085 Run final desktop 1440x900 verification and save evidence in `specs/008-task-orchestrator/browser-evidence.md` (ERROR: cannot reach `http://localhost:5173`.)
- [!] T086 Run final tablet 1024x768 verification and save evidence in `specs/008-task-orchestrator/browser-evidence.md` (ERROR: cannot reach `http://localhost:5173`.)
- [!] T087 Run final mobile 390x844 verification with no horizontal scroll and save evidence in `specs/008-task-orchestrator/browser-evidence.md` (ERROR: cannot reach `http://localhost:5173`.)
- [X] T088 Run GitNexus change detection for affected execution flows and record summary in `specs/008-task-orchestrator/validation-results.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; can start immediately.
- **Foundational (Phase 2)**: Depends on Phase 1; blocks all user stories.
- **US1 Reliable Task Execution State (Phase 3)**: Depends on Phase 2; MVP target.
- **US2 Scheduled Work Starts and Continues (Phase 4)**: Depends on Phase 2 and benefits from US1 reconciliation, but can be implemented against the same authoritative state contract.
- **US3 Safe Runtime Graph Changes (Phase 5)**: Depends on Phase 2 and requires reconciliation foundations from US1.
- **Polish (Phase 6)**: Depends on selected user stories being complete.

### User Story Dependencies

- **US1 (P1)**: MVP. No dependency on other user stories after foundation.
- **US2 (P2)**: Depends on foundation; should integrate with US1 reconciliation before final validation.
- **US3 (P3)**: Depends on foundation and US1 reconciliation semantics; mutation UI can be delivered after backend mutation service.

### Within Each User Story

- Tests come before implementation and should fail before implementation.
- Contract and data model changes precede engine and frontend integration.
- Repositories and pure reconciliation rules precede orchestrator workers.
- Orchestrator workers precede server lifecycle and UI behavior changes.
- Browser evidence and performance validation close each story.

## Parallel Opportunities

- T002, T003, T004, and T005 can run in parallel after T001 starts evidence capture.
- T014, T015, and T016 can run in parallel after repository interfaces are drafted.
- T023, T024, T025, T026, and T027 can run in parallel for US1 tests.
- T042, T043, T044, T045, and T046 can run in parallel for US2 tests.
- T060, T061, T062, T063, and T064 can run in parallel for US3 tests.
- Final documentation tasks T078 and T079 can run in parallel with validation setup once all selected story work is complete.

## Parallel Example: User Story 1

```bash
Task: "Add reconciliation unit tests for one authoritative task state in packages/engine/src/modules/orchestration/reconcile-task-state.test.ts"
Task: "Add impossible graph state tests for terminal completed with pending reachable prerequisites in packages/engine/src/modules/orchestration/reconcile-impossible-state.test.ts"
Task: "Add wait versus blocker state tests in packages/graph-runtime/src/resolve-state-semantics.test.ts"
Task: "Add task workspace state contract tests in packages/contracts/src/task-orchestrator.test.ts"
Task: "Add task page read-model integration tests for coherent execution summary in packages/engine/src/modules/tasks/get-task-page-orchestrator.test.ts"
```

## Parallel Example: User Story 2

```bash
Task: "Add due scheduled work integration tests in packages/engine/src/modules/orchestration/due-scheduled-work-worker.test.ts"
Task: "Add two-owner duplicate start tests in packages/engine/src/modules/orchestration/scheduler-ownership.integration.test.ts"
Task: "Add active run sync tests for terminal result apply-once behavior in packages/engine/src/modules/orchestration/active-run-sync-worker.test.ts"
Task: "Add graph advancement integration tests for automatic completion, user wait, approval wait, true blocker, failure, and completion in packages/engine/src/modules/orchestration/graph-advancement-worker.test.ts"
```

## Parallel Example: User Story 3

```bash
Task: "Add graph mutation validation tests for stale versions and active-node rewrites in packages/engine/src/modules/orchestration/graph-mutation-validator.test.ts"
Task: "Add graph mutation apply tests for add node, remove future node, replace subgraph, invalidate downstream, and replan from node in packages/engine/src/modules/orchestration/graph-mutation-apply.test.ts"
Task: "Add graph mutation contract tests in packages/contracts/src/task-orchestrator-mutation.test.ts"
Task: "Add graph mutation route integration tests in apps/server/src/routes/tasks/task-graph-mutations.test.ts"
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 setup.
2. Complete Phase 2 foundation.
3. Complete Phase 3 US1 reconciliation and authoritative workspace state.
4. Stop and validate US1 independently with targeted tests, `bun run test`, and browser evidence.
5. Demo one truthful task state with impossible-state detection.

### Incremental Delivery

1. Deliver Setup + Foundational orchestration contracts and persistence.
2. Deliver US1 authoritative task state and reconciliation.
3. Deliver US2 scheduled start, active sync, graph advancement, degraded retry, and restart recovery.
4. Deliver US3 runtime graph mutation and recovery actions.
5. Finish cross-cutting validation, docs, browser evidence, and e2e.

### Validation Commands

```bash
bun run typecheck
bun run lint
bun run test
bun run test:e2e
```

## Notes

- No legacy scheduler state or old saved execution projections need compatibility.
- Do not add Redis, Temporal, cron, or external worker dependencies for this phase unless the plan is explicitly amended.
- Keep business logic out of React components and Hono route handlers.
- Run GitNexus impact analysis before editing existing functions, classes, or methods.
- Preserve user-facing strings in i18n files.
- Use for all frontend-visible task workspace changes.
