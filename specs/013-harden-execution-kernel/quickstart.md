# Quickstart: Harden Execution Kernel

## Goal

Verify that the hardened execution kernel prevents duplicate provider-side node execution, preserves completed results, and makes pause/stop authoritative across callbacks, scheduler ticks, and recovery.

## Preconditions

- Feature branch: `013-harden-execution-kernel`.
- Spec: `specs/013-harden-execution-kernel/spec.md`.
- Plan: `specs/013-harden-execution-kernel/plan.md`.
- Existing local runtime data may be reset because unpublished legacy execution compatibility is not required.

## Implementation Validation Flow

1. Add failing regression tests for current duplicate execution behavior:

   ```bash
   bun test packages/engine/src/modules/plan-execution/plan-runner.task-executor.continuation.bun.test.ts --test-name-pattern "same ready entry"
   ```

2. Add integration tests for these scenarios:

   - Concurrent manual/continuation triggers produce one active owner.
   - Serial DAG with multiple ready branches starts only one provider-backed node.
   - Completed node resume does not create another provider run.
   - Stop with late provider callback does not advance downstream and preserves completed results.
   - Pause with late provider callback records callback but does not resume.
   - Explicit retry creates exactly one new node attempt.
   - Restart recovery does not repeat completed provider-side work.

3. Implement the execution ownership model.

4. Implement epoch/fencing checks on all mutating execution paths.

5. Implement node attempt idempotency for provider-side runs.

6. Remove or rewrite unpublished legacy execution-state paths that conflict with the new model.

7. Run focused tests for execution kernel behavior.

   Known local blocker: DB-backed Bun tests that call Prisma `resetDb()` currently fail before assertions when the temporary SQLite test database is not bootstrapped with generated schema tables such as `TaskAssistantMessage` (`P2021`). Graph-runtime and frontend view-model focused tests can still run without that database bootstrap.

8. Run full repository checks:

   ```bash
   bun run typecheck
   bun run lint
   bun run test
   bun run test:e2e
   ```

9. If visible task status, activity history, or graph inspector wording changes, collect browser evidence with for:

   - Desktop `1440x900`
   - Tablet `1024x768`
   - Mobile `390x844`

## Expected Outcomes

- Duplicate provider-side runs for the same node attempt are zero.
- In serial mode, one task plan run never has more than one provider-backed node running.
- Completed node results remain effective through downstream execution, pause, stop, recovery, and stale callbacks.
- Stop and pause prevent automatic continuation until explicit user action.
- Stale callbacks and rejected overlapping triggers appear in history as ignored/diagnostic events, not accepted state transitions.
