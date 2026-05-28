# Tasks: Complete Test Coverage

**Input**: Design documents from `/specs/014-test-coverage/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/test-coverage-contract.md, quickstart.md

**Tests**: Required. This feature is test coverage work; every user story contains explicit test tasks.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel because it touches different files and does not depend on incomplete tasks.
- **[Story]**: User story label for story phases only.
- Every task includes exact file paths.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish coverage inventory, baseline evidence, and helper conventions before adding tests.

- [X] T001 Create current coverage inventory in specs/014-test-coverage/test-inventory.md
- [X] T002 [P] Record baseline command expectations in specs/014-test-coverage/verification/baseline-commands.md
- [X] T003 [P] Review existing shared test helpers and document reuse decisions in specs/014-test-coverage/verification/test-helper-inventory.md
- [X] T004 [P] Review provider fixture safety rules and document accepted cassette fields in specs/014-test-coverage/verification/provider-fixture-review.md
- [X] T005 Create residual-risk tracker in specs/014-test-coverage/coverage-summary.md

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Add shared test contracts and fixture guardrails that all stories rely on.

**CRITICAL**: No user story work should begin until this phase is complete.

- [X] T006 Add coverage inventory contract checks in specs/014-test-coverage/contracts/test-coverage-contract.md
- [X] T007 Add provider fixture schema regression tests in packages/engine/src/test/llm-fixtures.bun.test.ts
- [X] T008 Add provider fixture recorder unit tests in packages/engine/src/test/llm-fixture-recorder.bun.test.ts
- [X] T009 [P] Add deterministic compiled plan builder coverage in packages/engine/src/test/builders.bun.test.ts
- [X] T010 [P] Add frontend test helper coverage in apps/web/src/test/fixtures.test.ts
- [X] T011 [P] Add MSW explicit-start usage documentation in docs/zh/testing.md
- [X] T012 Validate foundational commands and record results in specs/014-test-coverage/verification/foundation-validation.md

**Checkpoint**: Shared fixture, builder, helper, and documentation guardrails are ready.

---

## Phase 3: User Story 1 - Verify Core Business Behavior (Priority: P1) MVP

**Goal**: Protect core task, plan, schedule, execution, graph-runtime, and provider behaviors with focused tests at the narrowest effective level.

**Independent Test**: Run `bun run test:bun`, `bun run test`, and `CHRONA_LLM_FIXTURE_MODE=replay bun run test:llm:replay`; confirm new core behavior tests pass without live network access.

### Tests for User Story 1

- [X] T013 [P] [US1] Add task state boundary tests in packages/domain/src/task/task-state-boundaries.bun.test.ts
- [X] T014 [P] [US1] Add plan acceptance and stale-plan boundary tests in packages/domain/src/plan/plan-state-boundaries.bun.test.ts
- [X] T015 [P] [US1] Add schedule proposal decision matrix tests in packages/domain/src/task/schedule-proposal-boundaries.bun.test.ts
- [X] T016 [P] [US1] Add graph runtime invalid transition tests in packages/graph-runtime/src/graph-runtime.invalid-transitions.bun.test.ts
- [X] T017 [P] [US1] Add execution state invariant tests in packages/engine/src/modules/plan-execution/__tests__/execution-state-invariants.bun.test.ts
- [X] T018 [P] [US1] Add provider response parsing tests in packages/engine/src/modules/ai/__tests__/provider-response-parsing.bun.test.ts
- [X] T019 [P] [US1] Add contract schema edge tests in packages/contracts/src/api/task-plan-boundaries.bun.test.ts
- [X] T020 [US1] Run core behavior validation and record results in specs/014-test-coverage/verification/us1-core-behavior.md

### Implementation for User Story 1

- [X] T021 [US1] Update specs/014-test-coverage/test-inventory.md with core behavior coverage mapping
- [X] T022 [US1] Update specs/014-test-coverage/coverage-summary.md with US1 covered scenarios and residual risks

**Checkpoint**: Core behavior protection is independently complete and verifiable.

---

## Phase 4: User Story 2 - Validate Key User Workflows (Priority: P1)

**Goal**: Cover complete task, plan, schedule, provider, and browser navigation workflows at integration boundaries.

**Independent Test**: Run `bun run test:api`, relevant `bun run test:e2e:*` commands, and focused workflow tests; confirm outcomes and negative cases are validated without real external services.

### Tests for User Story 2

- [X] T023 [P] [US2] Add task validation workflow tests in apps/server/src/__tests__/api/task-validation-workflow.bun.test.ts
- [X] T024 [P] [US2] Add plan lifecycle edge workflow tests in apps/server/src/__tests__/api/plan-lifecycle-edge-workflow.bun.test.ts
- [X] T025 [P] [US2] Add schedule proposal conflict workflow tests in apps/server/src/__tests__/api/schedule-proposal-conflict-workflow.bun.test.ts
- [X] T026 [P] [US2] Add provider bridge malformed response workflow tests in apps/server/src/__tests__/bridge/provider-bridge-error-workflow.bun.test.ts
- [X] T027 [P] [US2] Add task workspace MSW integration tests in apps/web/src/components/task-workspace/__tests__/task-workspace-error-states.test.tsx
- [X] T028 [P] [US2] Add desktop/tablet/mobile navigation assertions in e2e/specs/task-workspace-responsive-flow.spec.ts
- [X] T029 [P] [US2] Add no-horizontal-scroll browser assertions in e2e/specs/task-workspace-layout.spec.ts
- [X] T030 [US2] Capture pre-edit browser observation for workflow surfaces in specs/014-test-coverage/verification/browser-pre-edit.md
- [X] T031 [US2] Capture post-edit browser verification for desktop 1440x900 in specs/014-test-coverage/verification/browser-post-desktop.md
- [X] T032 [US2] Capture post-edit browser verification for tablet 1024x768 in specs/014-test-coverage/verification/browser-post-tablet.md
- [X] T033 [US2] Capture post-edit browser verification for mobile 390x844 in specs/014-test-coverage/verification/browser-post-mobile.md
- [X] T034 [US2] Run workflow validation and record results in specs/014-test-coverage/verification/us2-workflows.md

### Implementation for User Story 2

- [X] T035 [US2] Update specs/014-test-coverage/test-inventory.md with workflow coverage mapping
- [X] T036 [US2] Update specs/014-test-coverage/coverage-summary.md with US2 covered scenarios and residual risks

**Checkpoint**: Key user workflows are independently covered across service, API, provider, and browser boundaries.

---

## Phase 5: User Story 3 - Preserve Bug-Prone Behavior With Regression Tests (Priority: P2)

**Goal**: Convert known fragile execution, provider, schedule, and UI behavior into explicit regression tests.

**Independent Test**: Run regression-focused Bun, Vitest, LLM replay, and relevant e2e commands; confirm each historical failure mode has a deterministic assertion.

### Tests for User Story 3

- [X] T037 [P] [US3] Add duplicate execution regression tests in packages/engine/src/modules/plan-execution/__tests__/duplicate-execution-regression.bun.test.ts
- [X] T038 [P] [US3] Add stop and pause regression tests in packages/engine/src/modules/plan-execution/__tests__/stop-pause-regression.bun.test.ts
- [X] T039 [P] [US3] Add serial branch result stability tests in packages/engine/src/modules/plan-execution/__tests__/serial-branch-result-regression.bun.test.ts
- [X] T040 [P] [US3] Add provider fixture replay error regressions in packages/engine/src/modules/ai/__tests__/provider-fixture-replay-regression.bun.test.ts
- [X] T041 [P] [US3] Add schedule duplicate decision regression tests in apps/server/src/__tests__/api/schedule-proposal-regression.bun.test.ts
- [X] T042 [P] [US3] Add selected block sheet regression tests in apps/web/src/components/task-workspace/__tests__/selected-block-sheet-regression.test.tsx
- [X] T043 [US3] Run regression validation and record results in specs/014-test-coverage/verification/us3-regressions.md

### Implementation for User Story 3

- [X] T044 [US3] Update specs/014-test-coverage/test-inventory.md with regression coverage mapping
- [X] T045 [US3] Update specs/014-test-coverage/coverage-summary.md with US3 covered scenarios and residual risks

**Checkpoint**: Known fragile areas have explicit regression coverage and documented evidence.

---

## Phase 6: User Story 4 - Produce Coverage and Risk Summary (Priority: P3)

**Goal**: Produce final reviewer-facing coverage summary mapping new tests to scenarios, validation commands, and remaining risks.

**Independent Test**: Review specs/014-test-coverage/coverage-summary.md and confirm every changed test maps to covered scenarios or residual risks.

### Tests for User Story 4

- [X] T046 [US4] Validate coverage summary completeness against specs/014-test-coverage/contracts/test-coverage-contract.md
- [X] T047 [US4] Validate all changed tests map to scenarios in specs/014-test-coverage/coverage-summary.md

### Implementation for User Story 4

- [X] T048 [US4] Finalize added-tests section in specs/014-test-coverage/coverage-summary.md
- [X] T049 [US4] Finalize changed-tests section in specs/014-test-coverage/coverage-summary.md
- [X] T050 [US4] Finalize covered-scenarios section in specs/014-test-coverage/coverage-summary.md
- [X] T051 [US4] Finalize remaining-risks section in specs/014-test-coverage/coverage-summary.md

**Checkpoint**: Reviewer can trace test additions to business risks and remaining gaps.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final validation, documentation, and cleanup across all stories.

- [X] T052 [P] Update testing guide with final command matrix in docs/zh/testing.md
- [X] T053 [P] Update quickstart validation notes in specs/014-test-coverage/quickstart.md
- [X] T054 Run `bun run typecheck` and record results in specs/014-test-coverage/verification/typecheck.md
- [X] T055 Run `bun run lint` and record results in specs/014-test-coverage/verification/lint.md
- [X] T056 Run `bun run test` and record results in specs/014-test-coverage/verification/test.md
- [X] T057 Run `bun run test:bun` and record results in specs/014-test-coverage/verification/test-bun.md
- [X] T058 Run `bun run test:api` and record results in specs/014-test-coverage/verification/test-api.md
- [X] T059 Run `CHRONA_LLM_FIXTURE_MODE=replay bun run test:llm:replay` and record results in specs/014-test-coverage/verification/test-llm-replay.md
- [X] T060 Run `bun run test:e2e:desktop` and record results in specs/014-test-coverage/verification/test-e2e-desktop.md
- [X] T061 Run `bun run test:e2e:tablet` and record results in specs/014-test-coverage/verification/test-e2e-tablet.md
- [X] T062 Run `bun run test:e2e:mobile` and record results in specs/014-test-coverage/verification/test-e2e-mobile.md
- [X] T063 Review final changed files and record scope in specs/014-test-coverage/verification/final-scope.md

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion; blocks all user stories.
- **US1 Core Behavior (Phase 3)**: Depends on Foundational; MVP scope.
- **US2 Key Workflows (Phase 4)**: Depends on Foundational; can run after or alongside US1 if staffed, but final summary should include US1 and US2 together.
- **US3 Regressions (Phase 5)**: Depends on Foundational; can run in parallel with US1/US2 after shared fixture guardrails exist.
- **US4 Coverage Summary (Phase 6)**: Depends on desired story phases being complete.
- **Polish (Phase 7)**: Depends on all selected stories being complete.

### User Story Dependencies

- **US1 (P1)**: Independent after Foundation; suggested MVP.
- **US2 (P1)**: Independent after Foundation; shares only final inventory and summary files.
- **US3 (P2)**: Independent after Foundation; may reuse helpers added in Foundation.
- **US4 (P3)**: Depends on completed story evidence from US1, US2, and US3.

### Within Each User Story

- Write or update tests first where behavior gaps are known.
- Prefer focused behavior assertions before broad workflow assertions.
- Update inventory and coverage summary after tests pass.
- Record validation evidence before closing the story.

---

## Parallel Opportunities

- T002, T003, T004 can run in parallel after T001 starts because they write separate verification files.
- T009, T010, T011 can run in parallel because they touch separate helper/documentation areas.
- T013-T019 can run in parallel because they target separate test files.
- T023-T029 can run in parallel because they target separate API, bridge, web, and e2e files.
- T037-T042 can run in parallel because they target separate regression test files.
- T052 and T053 can run in parallel because they update different docs.

## Parallel Example: User Story 1

```bash
Task: "Add task state boundary tests in packages/domain/src/task/task-state-boundaries.bun.test.ts"
Task: "Add graph runtime invalid transition tests in packages/graph-runtime/src/graph-runtime.invalid-transitions.bun.test.ts"
Task: "Add provider response parsing tests in packages/engine/src/modules/ai/__tests__/provider-response-parsing.bun.test.ts"
```

## Parallel Example: User Story 2

```bash
Task: "Add task validation workflow tests in apps/server/src/__tests__/api/task-validation-workflow.bun.test.ts"
Task: "Add provider bridge malformed response workflow tests in apps/server/src/__tests__/bridge/provider-bridge-error-workflow.bun.test.ts"
Task: "Add desktop/tablet/mobile navigation assertions in e2e/specs/task-workspace-responsive-flow.spec.ts"
```

## Parallel Example: User Story 3

```bash
Task: "Add duplicate execution regression tests in packages/engine/src/modules/plan-execution/__tests__/duplicate-execution-regression.bun.test.ts"
Task: "Add provider fixture replay error regressions in packages/engine/src/modules/ai/__tests__/provider-fixture-replay-regression.bun.test.ts"
Task: "Add selected block sheet regression tests in apps/web/src/components/task-workspace/__tests__/selected-block-sheet-regression.test.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 Setup.
2. Complete Phase 2 Foundational guardrails.
3. Complete Phase 3 US1 core behavior tests.
4. Stop and validate `bun run test:bun`, `bun run test`, and `CHRONA_LLM_FIXTURE_MODE=replay bun run test:llm:replay`.
5. Update coverage summary with US1 coverage and risks.

### Incremental Delivery

1. Foundation ready.
2. Add US1 core behavior protection.
3. Add US2 workflow integration protection.
4. Add US3 regression protection.
5. Add US4 final report and residual-risk mapping.
6. Run full validation matrix.

### Team Parallel Strategy

1. One contributor owns inventory and coverage summary files to reduce merge conflicts.
2. Separate contributors can work on domain/runtime, server/API, provider, frontend, and e2e test files in parallel.
3. Browser evidence and e2e validation should be serialized near the end to avoid conflicting dev server state.
