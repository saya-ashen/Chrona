# Tasks: Test Coverage

**Input**: Design documents from `specs/006-test-coverage/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/test-coverage-contract.md`, `quickstart.md`

**Tests**: Required by the feature specification and Chrona constitution. Write story tests first, confirm they fail for missing coverage or current regressions, then add the smallest supporting fixture or assertion changes needed to make them pass.

**Organization**: Tasks are grouped by user story so each coverage increment can be implemented and tested independently after shared fixtures are complete.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Inventory current coverage and define shared deterministic fixtures before story-specific tests are added.

- [X] T001 Audit existing task flow and plan execution tests in `packages/engine/src/modules/plan-execution/plan-runner.bun.test.ts`, `apps/server/src/__tests__/api/plan-lifecycle-workflow.bun.test.ts`, and `apps/server/src/__tests__/api/task-workflow.bun.test.ts`
- [X] T002 [P] Audit existing task workspace UI tests in `apps/web/src/components/tasks/workspace/page/task-workspace-page.test.tsx`, `apps/web/src/components/tasks/plan/task-plan-graph.test.tsx`, and `apps/web/src/components/tasks/workspace/execution/task-workspace-execution-overview.test.tsx`
- [X] T003 [P] Audit existing Playwright task workspace specs in `e2e/specs/task-workspace-chat.spec.ts` and `e2e/specs/task-plan-generation-hermes.spec.ts`
- [X] T004 [P] Audit existing checkpoint and Hermes provider tests in `packages/providers/hermes/src/gateway.bun.test.ts`, `packages/providers/hermes/src/HermesClient.bun.test.ts`, and `apps/server/src/__tests__/api/plan-execution-output.bun.test.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared scenario fixtures, graph builders, UI helpers, and diagnostics required by all user stories.

**Critical**: No user story work can begin until this phase is complete.

- [X] T005 Create shared task flow test fixture builders in `apps/server/src/__tests__/api/task-flow-test-fixtures.ts`
- [X] T006 Create shared complex plan graph fixtures covering linear, branch, join, checkpoint, retry, blocked, failure, missing-result, malformed-result, empty, cyclic, and impossible graphs in `packages/engine/src/modules/plan-execution/plan-graph-test-fixtures.ts`
- [X] T007 [P] Create shared UI task workspace test builders for loading, empty, planning, executing, blocked, failed, completed, retry, long-text, desktop, and mobile states in `apps/web/src/components/tasks/workspace/test/task-workspace-ui-fixtures.tsx`
- [X] T008 [P] Create Playwright task workspace helper functions for seeded workspace setup, viewport changes, primary action lookup, state capture, and screenshot naming in `e2e/specs/task-workspace-test-helpers.ts`
- [X] T009 Create shared regression assertion helper that fails on `Hermes did not return review_checkpoint_node_result` in logs, payloads, visible text, and error summaries in `packages/engine/src/modules/plan-execution/checkpoint-regression-assertions.ts`
- [X] T010 [P] Document the scenario id naming convention and failure evidence fields in `specs/006-test-coverage/contracts/test-coverage-contract.md`

**Checkpoint**: Foundation ready. User story tests can now be implemented independently.

---

## Phase 3: User Story 1 - Validate Core Chrona Task Flow (Priority: P1) MVP

**Goal**: A maintainer can run a functional suite proving Chrona creates a task, generates a plan, executes progress, and exposes a terminal outcome with consistent state.

**Independent Test**: Run the US1 API and engine tests and verify a seeded task flow progresses from clean workspace to terminal state with diagnosable evidence.

### Tests for User Story 1

- [X] T011 [P] [US1] Add engine tests for valid task flow plan materialization and execution state progression in `packages/engine/src/modules/plan-execution/plan-runner.bun.test.ts`
- [X] T012 [P] [US1] Add API tests for task creation, plan generation, execution start, progress observation, and terminal state in `apps/server/src/__tests__/api/task-flow-functional.bun.test.ts`
- [X] T013 [P] [US1] Add contract tests for task, plan, graph, checkpoint, execution, and final result state consistency in `packages/contracts/src/api/tasks.schema.bun.test.ts`
- [X] T014 [P] [US1] Add diagnostic evidence tests for scenario name, expected outcome, actual outcome, and state snapshot in `apps/server/src/__tests__/api/task-flow-diagnostics.bun.test.ts`

### Implementation for User Story 1

- [X] T015 [US1] Implement reusable baseline task flow fixture data and cleanup in `apps/server/src/__tests__/api/task-flow-test-fixtures.ts`
- [X] T016 [US1] Extend plan execution assertions for pending, running, succeeded, failed, blocked, cancelled, and completed outcomes in `packages/engine/src/modules/plan-execution/plan-runner.bun.test.ts`
- [X] T017 [US1] Add API-level state snapshot extraction for failed functional scenarios in `apps/server/src/__tests__/api/task-flow-diagnostics.bun.test.ts`
- [X] T018 [US1] Verify US1 independently with `bun run test:bun` and `bun run test:api` from `/home/saya/workspace/Chrona`

**Checkpoint**: User Story 1 is complete when the primary task-to-plan-to-execution flow is covered and diagnosable without UI tests.

---

## Phase 4: User Story 2 - Stress Complex Plan Graphs (Priority: P2)

**Goal**: A maintainer can run graph-focused tests covering complex dependencies, checkpoints, failures, retries, invalid graphs, and the named legacy checkpoint error.

**Independent Test**: Run the US2 graph and API tests and verify at least 12 complex graph scenarios behave deterministically with safe failure or containment.

### Tests for User Story 2

- [X] T019 [P] [US2] Add graph runner tests for linear, branch, join, sequential dependency, and nested dependency scenarios in `packages/engine/src/modules/plan-execution/plan-runner.complex-graphs.bun.test.ts`
- [X] T020 [P] [US2] Add checkpoint result tests for approved, rejected, needs-changes, missing, malformed, delayed, and provider-specific fallback cases in `packages/engine/src/modules/plan-execution/plan-runner.checkpoints.bun.test.ts`
- [X] T021 [P] [US2] Add retry, blocked node, partial branch failure, and failure containment tests in `packages/engine/src/modules/plan-execution/plan-runner.failure-recovery.bun.test.ts`
- [X] T022 [P] [US2] Add invalid graph tests for empty, impossible, cyclic, and unsafe dependency topologies in `packages/engine/src/modules/plan-execution/plan-runner.invalid-graphs.bun.test.ts`
- [X] T023 [P] [US2] Add API regression tests proving supported checkpoint flows do not emit `Hermes did not return review_checkpoint_node_result` in `apps/server/src/__tests__/api/plan-execution-checkpoint-regression.bun.test.ts`

### Implementation for User Story 2

- [X] T024 [US2] Implement deterministic graph fixture builders for all required graph scenario types in `packages/engine/src/modules/plan-execution/plan-graph-test-fixtures.ts`
- [X] T025 [US2] Wire checkpoint regression assertion helper into graph and API tests in `packages/engine/src/modules/plan-execution/checkpoint-regression-assertions.ts`
- [X] T026 [US2] Extend existing plan execution output fixtures for checkpoint success, missing result, malformed result, and delayed result cases in `apps/server/src/__tests__/api/plan-execution-fixtures.ts`
- [X] T027 [US2] Add deterministic run order and expected node transition assertions to graph tests in `packages/engine/src/modules/plan-execution/plan-runner.complex-graphs.bun.test.ts`
- [X] T028 [US2] Verify US2 independently with `bun run test:bun` and `bun run test:api` from `/home/saya/workspace/Chrona`

**Checkpoint**: User Story 2 is complete when 12 or more complex graph scenarios pass deterministically and the legacy checkpoint error is a failing regression.

---

## Phase 5: User Story 3 - Evaluate Interface Usability And Layout (Priority: P3)

**Goal**: A developer or reviewer can run UI-focused tests that catch broken task workspace states, layout overflow, inaccessible primary actions, and confusing user feedback.

**Independent Test**: Run the US3 component and Playwright tests and verify desktop and mobile planning/execution screens expose primary controls, status text, graph details, and accessible interactions.

### Tests for User Story 3

- [X] T029 [P] [US3] Add component tests for loading, empty, planning, executing, blocked, failed, completed, and retry states in `apps/web/src/components/tasks/workspace/page/task-workspace-page.test.tsx`
- [X] T030 [P] [US3] Add component tests for long task titles, long node names, long errors, and generated plan text overflow in `apps/web/src/components/tasks/plan/task-plan-graph.test.tsx`
- [X] T031 [P] [US3] Add component tests for execution overview status, progress messages, retry actions, and accessible names in `apps/web/src/components/tasks/workspace/execution/task-workspace-execution-overview.test.tsx`
- [X] T032 [P] [US3] Add desktop and mobile Playwright tests for planning and execution workspace layout in `e2e/specs/task-workspace-layout.spec.ts`
- [X] T033 [P] [US3] Add keyboard navigation and primary action reachability Playwright tests in `e2e/specs/task-workspace-accessibility.spec.ts`

### Implementation for User Story 3

- [X] T034 [US3] Implement shared task workspace UI fixture builders and render helpers in `apps/web/src/components/tasks/workspace/test/task-workspace-ui-fixtures.tsx`
- [X] T035 [US3] Implement Playwright workspace seeding, viewport setup, evidence capture, and failure labeling helpers in `e2e/specs/task-workspace-test-helpers.ts`
- [X] T036 [US3] Add missing stable labels or test selectors required by UI tests in `apps/web/src/components/tasks/workspace/page/task-workspace-page.tsx`
- [X] T037 [US3] Add missing accessible names or status labels required by UI tests in `apps/web/src/components/tasks/workspace/execution/task-workspace-execution-overview.tsx`
- [ ] T038 [US3] Verify US3 independently with `bun run test` and `bun run test:e2e` from `/home/saya/workspace/Chrona`

**Checkpoint**: User Story 3 is complete when UI tests detect critical layout and usability regressions across primary desktop and mobile task workspace states.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final validation, evidence quality, and documentation across all stories.

- [X] T039 [P] Update validation instructions and scenario checklist in `specs/006-test-coverage/quickstart.md`
- [X] T040 [P] Update coverage requirements and diagnostic obligations in `specs/006-test-coverage/contracts/test-coverage-contract.md`
- [X] T041 Run `bun run typecheck` from `/home/saya/workspace/Chrona`
- [X] T042 Run `bun run lint` from `/home/saya/workspace/Chrona`
- [X] T043 Run `bun run test` from `/home/saya/workspace/Chrona`
- [X] T044 Run `bun run test:bun` from `/home/saya/workspace/Chrona`
- [X] T045 Run `bun run test:api` from `/home/saya/workspace/Chrona`
- [X] T046 Run `bun run test:e2e` from `/home/saya/workspace/Chrona`
- [X] T047 Review failed-test diagnostics against the 2-minute triage goal in `specs/006-test-coverage/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; can start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion; blocks all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational; MVP scope.
- **User Story 2 (Phase 4)**: Depends on Foundational and can run after or alongside US1 if graph fixtures do not need API flow fixtures.
- **User Story 3 (Phase 5)**: Depends on Foundational and can run after UI fixture helpers are available.
- **Polish (Phase 6)**: Depends on all desired user stories being complete.

### User Story Dependencies

- **US1 (P1)**: Can start after Phase 2. No dependency on US2 or US3.
- **US2 (P2)**: Can start after Phase 2. Benefits from US1 diagnostics but graph behavior is independently testable.
- **US3 (P3)**: Can start after Phase 2. Does not depend on US2 and can use mocked or seeded workspace states.

### Within Each User Story

- Tests before supporting fixture or implementation changes.
- Shared fixture updates before tests that depend on those fixtures.
- Engine/API correctness before e2e reliance on the same behavior.
- Story-specific validation command before closing the story.

## Parallel Opportunities

- T002, T003, and T004 can run in parallel after T001 starts.
- T007, T008, and T010 can run in parallel with T005, T006, and T009 because they touch different files.
- T011, T012, T013, and T014 can run in parallel within US1 after foundation is complete.
- T019, T020, T021, T022, and T023 can run in parallel within US2 after graph fixtures are available.
- T029, T030, T031, T032, and T033 can run in parallel within US3 after UI helpers are available.
- T039 and T040 can run in parallel during Polish.

## Parallel Example: User Story 1

```bash
Task: "T011 [P] [US1] Add engine tests in packages/engine/src/modules/plan-execution/plan-runner.bun.test.ts"
Task: "T012 [P] [US1] Add API tests in apps/server/src/__tests__/api/task-flow-functional.bun.test.ts"
Task: "T013 [P] [US1] Add contract tests in packages/contracts/src/api/tasks.schema.bun.test.ts"
Task: "T014 [P] [US1] Add diagnostic evidence tests in apps/server/src/__tests__/api/task-flow-diagnostics.bun.test.ts"
```

## Parallel Example: User Story 2

```bash
Task: "T019 [P] [US2] Add complex graph tests in packages/engine/src/modules/plan-execution/plan-runner.complex-graphs.bun.test.ts"
Task: "T020 [P] [US2] Add checkpoint tests in packages/engine/src/modules/plan-execution/plan-runner.checkpoints.bun.test.ts"
Task: "T021 [P] [US2] Add failure recovery tests in packages/engine/src/modules/plan-execution/plan-runner.failure-recovery.bun.test.ts"
Task: "T022 [P] [US2] Add invalid graph tests in packages/engine/src/modules/plan-execution/plan-runner.invalid-graphs.bun.test.ts"
Task: "T023 [P] [US2] Add API checkpoint regression tests in apps/server/src/__tests__/api/plan-execution-checkpoint-regression.bun.test.ts"
```

## Parallel Example: User Story 3

```bash
Task: "T029 [P] [US3] Add page state tests in apps/web/src/components/tasks/workspace/page/task-workspace-page.test.tsx"
Task: "T030 [P] [US3] Add graph overflow tests in apps/web/src/components/tasks/plan/task-plan-graph.test.tsx"
Task: "T031 [P] [US3] Add execution overview accessibility tests in apps/web/src/components/tasks/workspace/execution/task-workspace-execution-overview.test.tsx"
Task: "T032 [P] [US3] Add layout e2e tests in e2e/specs/task-workspace-layout.spec.ts"
Task: "T033 [P] [US3] Add keyboard e2e tests in e2e/specs/task-workspace-accessibility.spec.ts"
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 audits.
2. Complete Phase 2 shared task flow, graph, UI, Playwright, and regression helpers.
3. Complete Phase 3 US1 tests and supporting fixtures.
4. Validate US1 independently with `bun run test:bun` and `bun run test:api`.
5. Stop and review whether the primary Chrona task flow is protected before broadening coverage.

### Incremental Delivery

1. Deliver US1 to prove the main functional flow.
2. Add US2 to harden complex graph, checkpoint, invalid graph, retry, and recovery coverage.
3. Add US3 to catch layout, usability, responsive, keyboard, and accessible-name regressions.
4. Run all Polish validation commands and update quickstart/contracts if validation differs from the plan.

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup and Foundational phases together.
2. Developer A completes US1 functional coverage.
3. Developer B completes US2 graph and checkpoint coverage.
4. Developer C completes US3 UI and e2e coverage.
5. Team runs Phase 6 validation and triages any product failures found by the new tests.

## Notes

- [P] tasks touch different files or can be prepared without depending on incomplete story work.
- [US1], [US2], and [US3] labels map directly to the prioritized user stories in `specs/006-test-coverage/spec.md`.
- Every story includes test tasks because this feature explicitly requests complete testing coverage.
