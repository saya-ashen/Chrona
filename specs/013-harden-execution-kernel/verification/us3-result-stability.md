# US3 Result Stability Verification

## Scope

User Story 3 keeps completed node results stable, records stale callbacks as audit events, and derives effective plan graph state from authoritative attempts/results.

## Changes Verified

- Added result-stability integration coverage in `packages/engine/src/modules/plan-execution/plan-runner.task-executor.continuation.bun.test.ts` for downstream pause/stop, stale callback audit, and explicit retry replacement.
- Changed graph runtime result replacement defaults so implicit replacement marks prior current results `stale`, while explicit retry/manual replacement can still mark results `obsolete`.
- Changed external runtime sync to append stale results when callbacks no longer match a running attempt.
- Changed retry state to cancel prior non-cancelled attempts for the retried node and supersede results only through explicit retry.
- Changed effective graph resolution to ignore stale/obsolete fallback results while preserving degraded rejected result visibility.
- Confirmed task detail plan graph mapping already uses effective graph results from `task-plan-read-model.ts`; no frontend view-model or inspector copy changes were required.

## Commands

### Typecheck

Command: `bun run typecheck`

Result: PASS.

### Graph Runtime Execution

Command: `bun test packages/graph-runtime/src/graph-runtime.execution.bun.test.ts`

Result: PASS. 5 pass, 0 fail, 29 expects.

### Graph Runtime Dispatch

Command: `bun test packages/graph-runtime/src/graph-runtime.dispatch.bun.test.ts`

Result: PASS. 7 pass, 0 fail, 26 expects.

### Resolve State Semantics

Command: `bun test packages/graph-runtime/src/resolve-state-semantics.bun.test.ts`

Result: PASS. 3 pass, 0 fail, 12 expects.

### Task Plan View Model

Command: `bun test apps/web/src/components/tasks/plan/task-plan-view-model.test.ts`

Result: PASS. 7 pass, 0 fail, 27 expects.

### DB-Backed Plan Runner Continuation

Command: `bun test packages/engine/src/modules/plan-execution/plan-runner.task-executor.continuation.bun.test.ts`

Result: BLOCKED before assertions by the known Prisma SQLite test database bootstrap issue also observed in US1 and US2. The suite fails between tests because the temporary SQLite database is missing generated schema tables such as `TaskAssistantMessage` (`P2021`). The US3 regression tests are present in the suite but cannot execute until the test DB bootstrap issue is fixed.

## UI Evidence

No UI status, layout, or localized copy changed for US3. Existing plan graph view-model tests verify effective result outputs/evidence mapping, and the inspector already displays result evidence from the effective graph. Browser evidence is therefore not applicable for this user story.
