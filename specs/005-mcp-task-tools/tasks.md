# Tasks: MCP Task Tools

**Input**: Design documents from `specs/005-mcp-task-tools/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/chrona-mcp-task-tools.md`, `quickstart.md`

**Tests**: Required by the feature specification and Chrona constitution. Write story tests before implementation work in that story phase and confirm they fail for missing behavior before making them pass.

**Organization**: Tasks are grouped by user story so each story can be implemented and tested independently after shared foundation is complete.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish implementation locations and verify current lifecycle surfaces before adding MCP task tools.

- [X] T001 Audit existing task, plan, schedule, and execution service entry points in `packages/engine/src/services/tasks.service.ts`, `packages/engine/src/services/task-plan.service.ts`, `packages/engine/src/services/task-schedule.service.ts`, and `packages/engine/src/services/task-execution.service.ts`
- [X] T002 [P] Audit existing shared operation schemas in `packages/contracts/src/api/tasks.schema.ts`, `packages/contracts/src/api/plans.schema.ts`, and `packages/contracts/src/api/execution.schema.ts`
- [X] T003 [P] Audit existing Hono task routes in `apps/server/src/routes/tasks/crud.routes.ts`, `apps/server/src/routes/tasks/plan.routes.ts`, `apps/server/src/routes/tasks/schedule.routes.ts`, and `apps/server/src/routes/tasks/execution.routes.ts`
- [X] T004 [P] Audit provider tool-call trace behavior in `packages/providers/hermes/src/gateway.ts` and `packages/providers/hermes/src/HermesClient.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared contracts, result mapping, route mounting, and idempotency/audit support required by all user stories.

**Critical**: No user story work can begin until this phase is complete.

- [X] T005 Create common MCP task tool Zod schemas and TypeScript types in `packages/contracts/src/api/mcp-task-tools.schema.ts`
- [X] T006 Export MCP task tool schemas from `packages/contracts/src/api/index.ts` and `packages/contracts/src/index.ts`
- [X] T007 [P] Add contract tests for common request/result envelopes, statuses, reason codes, idempotency fields, and expected-state fields in `packages/contracts/src/api/mcp-task-tools.schema.bun.test.ts`
- [X] T008 Create shared tool result builders for accepted, rejected, noop, stale-state, validation-error, and duplicate-operation results in `packages/engine/src/services/agent-tool-result.ts`
- [X] T009 [P] Add unit tests for tool result builders in `packages/engine/src/services/agent-tool-result.bun.test.ts`
- [X] T010 Create an agent tool operation service skeleton that accepts validated operation envelopes and delegates by tool name in `packages/engine/src/services/agent-tool-operations.service.ts`
- [X] T011 Register the agent tool operation service on the Chrona engine surface in `packages/engine/src/engine.ts`
- [X] T012 Create MCP task tool Hono route skeleton and tool registry response in `apps/server/src/routes/mcp/mcp.routes.ts`
- [X] T013 Mount MCP task tool routes in `apps/server/src/routes/api.ts`
- [X] T014 Add server smoke tests for MCP tool registry and common validation failures in `apps/server/src/routes/__tests__/mcp-routes.bun.test.ts`

**Checkpoint**: Foundation ready. User story implementation can begin.

---

## Phase 3: User Story 1 - Agents Advance Chrona State Through Tools (Priority: P1) MVP

**Goal**: Agents can read and mutate task, plan, schedule, and execution state through Chrona-owned tool calls without final structured JSON.

**Independent Test**: Run an agent-tool lifecycle scenario that creates or updates a task, mutates a plan, sets schedule state, dispatches execution, and verifies Chrona state after each accepted result.

### Tests for User Story 1

- [X] T015 [P] [US1] Add contract tests for `chrona.task.read`, `chrona.task.create`, `chrona.task.update`, `chrona.plan.read`, `chrona.plan.mutate`, `chrona.schedule.read`, `chrona.schedule.set`, `chrona.schedule.propose`, `chrona.schedule.clear`, `chrona.execution.read`, and `chrona.execution.dispatch` payloads in `packages/contracts/src/api/mcp-task-tools.schema.bun.test.ts`
- [X] T016 [P] [US1] Add service integration tests for happy-path task, plan, schedule, and execution tool calls in `packages/engine/src/services/agent-tool-operations.service.bun.test.ts`
- [X] T017 [P] [US1] Add Bun API tests for the MCP happy-path lifecycle route in `apps/server/src/routes/__tests__/mcp-routes.bun.test.ts`

### Implementation for User Story 1

- [X] T018 [US1] Implement task read, create, and update tool handlers in `packages/engine/src/services/agent-tool-operations.service.ts`
- [X] T019 [US1] Implement plan read and plan mutate tool handlers using existing plan mutation contracts in `packages/engine/src/services/agent-tool-operations.service.ts`
- [X] T020 [US1] Implement schedule read, propose, set, and clear tool handlers using existing schedule services in `packages/engine/src/services/agent-tool-operations.service.ts`
- [X] T021 [US1] Implement execution read and dispatch tool handlers using `taskPlanExecution.dispatch` through the execution service in `packages/engine/src/services/agent-tool-operations.service.ts`
- [X] T022 [US1] Implement MCP route dispatch that validates tool input, invokes the engine agent tool service, and returns `ChronaToolResult` in `apps/server/src/routes/mcp/mcp.routes.ts`
- [X] T023 [US1] Add state summary mapping for task, plan, schedule, and execution results in `packages/engine/src/services/agent-tool-state-summary.ts`
- [X] T024 [US1] Verify the P1 lifecycle scenario and 1 second feedback / 3 second ordinary operation budget in `apps/server/src/routes/__tests__/mcp-routes.bun.test.ts`

**Checkpoint**: User Story 1 is complete when the lifecycle can progress through Chrona tool results without final agent-authored JSON.

---

## Phase 4: User Story 2 - Chrona Owns Business Rules And Trust Boundaries (Priority: P2)

**Goal**: Chrona rejects invalid, unauthorized, stale, duplicate, conflicting, and out-of-order tool calls without partial state changes.

**Independent Test**: Submit valid and invalid tool calls for each lifecycle area and verify accepted operations use shared rules while rejected operations leave state unchanged and return structured recovery guidance.

### Tests for User Story 2

- [X] T025 [P] [US2] Add stale-state and expected-revision tests for task, plan, schedule, and execution tools in `packages/engine/src/services/agent-tool-operations.service.bun.test.ts`
- [X] T026 [P] [US2] Add idempotent retry and duplicate side-effect tests for mutating tools in `packages/engine/src/services/agent-tool-operations.service.bun.test.ts`
- [X] T027 [P] [US2] Add unauthorized, invalid-transition, conflict, and no-partial-write API tests in `apps/server/src/routes/__tests__/mcp-routes.bun.test.ts`

### Implementation for User Story 2

- [X] T028 [US2] Enforce idempotency keys and replay semantics for all mutating tool calls in `packages/engine/src/services/agent-tool-operations.service.ts`
- [X] T029 [US2] Add expected-state and expected-revision guards for task, plan, schedule, and execution mutations in `packages/engine/src/services/agent-tool-operations.service.ts`
- [X] T030 [US2] Add shared rejection mapping for unauthorized, not-found, stale, invalid-transition, conflict, validation, and duplicate cases in `packages/engine/src/services/agent-tool-result.ts`
- [X] T031 [US2] Record accepted and rejected operation audit context in `packages/engine/src/services/agent-tool-operations.service.ts`
- [X] T032 [US2] Surface structured recovery details from the MCP route for rejected operations in `apps/server/src/routes/mcp/mcp.routes.ts`
- [X] T033 [US2] Verify existing human task lifecycle route tests still exercise the same business rules in `apps/server/src/__tests__/api/task-workflow.bun.test.ts`, `apps/server/src/routes/__tests__/plan-operations.bun.test.ts`, and `apps/server/src/__tests__/api/schedule-proposal-workflow.bun.test.ts`

**Checkpoint**: User Story 2 is complete when invalid and stale agent operations leave Chrona state unchanged and return actionable structured failures.

---

## Phase 5: User Story 3 - Legacy Agent Output Becomes Non-Primary (Priority: P3)

**Goal**: Provider text, structured output, and tool traces remain useful evidence but cannot override Chrona-owned tool results.

**Independent Test**: Run provider/session scenarios with absent, malformed, and conflicting final structured output after accepted tool calls and verify Chrona state remains based on tool results.

### Tests for User Story 3

- [X] T034 [P] [US3] Add provider compatibility tests for tool-call traces that preserve evidence without applying state in `packages/providers/hermes/src/gateway.bun.test.ts`
- [X] T035 [P] [US3] Add API regression tests for absent, malformed, and conflicting final structured output after accepted tool calls in `apps/server/src/__tests__/api/plan-execution-output.bun.test.ts`
- [X] T036 [P] [US3] Add engine tests proving session evidence cannot override `ChronaToolResult` state in `packages/engine/src/services/agent-tool-operations.service.bun.test.ts`

### Implementation for User Story 3

- [X] T037 [US3] Add evidence classification for provider text, tool calls, tool outputs, and optional structured output in `packages/engine/src/services/agent-tool-operations.service.ts`
- [X] T038 [US3] Keep Hermes tool-call parsing as evidence-only by mapping Chrona tool call traces without applying lifecycle state in `packages/providers/hermes/src/gateway.ts`
- [X] T039 [US3] Update structured-output sync behavior so final provider JSON cannot override accepted Chrona tool results in `packages/engine/src/services/task-execution.service.ts`
- [X] T040 [US3] Preserve structured output display/diagnostic compatibility in `apps/server/src/__tests__/api/plan-execution-output.bun.test.ts`

**Checkpoint**: User Story 3 is complete when supported provider sessions can finish without valid final JSON and conflicts do not override Chrona tool state.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Validation, documentation, and regression proof across the completed feature.

- [X] T041 [P] Update developer notes for the MCP task tool surface in `specs/005-mcp-task-tools/quickstart.md`
- [X] T042 [P] Add or update package exports documentation for MCP task tool contracts in `packages/contracts/src/api/mcp-task-tools.schema.ts`
- [X] T043 Run `bun run typecheck` from `/home/saya/workspace/Chrona`
- [X] T044 Run `bun run lint` from `/home/saya/workspace/Chrona`
- [X] T045 Run `bun run test` from `/home/saya/workspace/Chrona`
- [X] T046 Run `bun run test:api` from `/home/saya/workspace/Chrona`
- [X] T047 Run `bun run test:bun` from `/home/saya/workspace/Chrona`
- [X] T048 Run `bun run test:bridge` from `/home/saya/workspace/Chrona`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; can start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion; blocks all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational; MVP scope.
- **User Story 2 (Phase 4)**: Depends on Foundational and benefits from US1 handlers, but rejection/idempotency work is independently testable against service contracts.
- **User Story 3 (Phase 5)**: Depends on Foundational and US1 authoritative result behavior.
- **Polish (Phase 6)**: Depends on all desired user stories being complete.

### User Story Dependencies

- **US1 (P1)**: Can start after Phase 2. No dependency on US2 or US3.
- **US2 (P2)**: Can start after Phase 2. Integrates with US1 mutation handlers for complete coverage.
- **US3 (P3)**: Can start after Phase 2. Requires US1 authoritative result semantics to prove legacy output is non-primary.

### Within Each User Story

- Tests before implementation tasks.
- Contract tests before service implementation.
- Service behavior before Hono/MCP route integration.
- Route integration before end-to-end lifecycle validation.
- Performance and no-regression checks before closing the story.

## Parallel Opportunities

- T002, T003, and T004 can run in parallel after T001 starts.
- T007 and T009 can run in parallel after T005 and T008 file targets are known.
- T015, T016, and T017 can run in parallel within US1.
- T025, T026, and T027 can run in parallel within US2.
- T034, T035, and T036 can run in parallel within US3.
- T041 and T042 can run in parallel during Polish.

## Parallel Example: User Story 1

```bash
Task: "T015 [P] [US1] Add contract tests for MCP tool payloads in packages/contracts/src/api/mcp-task-tools.schema.bun.test.ts"
Task: "T016 [P] [US1] Add service integration tests for happy-path tool calls in packages/engine/src/services/agent-tool-operations.service.bun.test.ts"
Task: "T017 [P] [US1] Add Bun API tests for the MCP happy-path lifecycle route in apps/server/src/routes/__tests__/mcp-routes.bun.test.ts"
```

## Parallel Example: User Story 2

```bash
Task: "T025 [P] [US2] Add stale-state and expected-revision tests in packages/engine/src/services/agent-tool-operations.service.bun.test.ts"
Task: "T026 [P] [US2] Add idempotent retry tests in packages/engine/src/services/agent-tool-operations.service.bun.test.ts"
Task: "T027 [P] [US2] Add unauthorized and invalid-transition API tests in apps/server/src/routes/__tests__/mcp-routes.bun.test.ts"
```

## Parallel Example: User Story 3

```bash
Task: "T034 [P] [US3] Add provider compatibility tests in packages/providers/hermes/src/gateway.bun.test.ts"
Task: "T035 [P] [US3] Add API regression tests in apps/server/src/__tests__/api/plan-execution-output.bun.test.ts"
Task: "T036 [P] [US3] Add engine evidence tests in packages/engine/src/services/agent-tool-operations.service.bun.test.ts"
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 setup audits.
2. Complete Phase 2 common contracts, result mapping, service skeleton, and MCP route skeleton.
3. Complete Phase 3 US1 tests and implementation.
4. Validate US1 independently with contract, service, and Bun API tests.
5. Stop and demo agent-driven lifecycle progress through Chrona tool results.

### Incremental Delivery

1. Deliver US1 to prove the main tool-driven lifecycle path.
2. Add US2 to harden trust boundaries, idempotency, stale rejection, and audit behavior.
3. Add US3 to demote legacy structured output and provider traces to evidence-only behavior.
4. Run Polish validation commands and update quickstart notes.
