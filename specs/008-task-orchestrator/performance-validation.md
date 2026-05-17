# Performance Validation: Task Orchestrator

Date: 2026-05-17

## US1 External Completion Visibility

- Status: `ERROR`
- Budget: external terminal results visible within 10 seconds p95.
- Available evidence: targeted reconciliation and task page tests passed; full
  browser/runtime observation could not run because the Vite app refused
  connection at `http://localhost:5173`.
- Result: budget not validated in a live workspace.

## US2 Duplicate Starts And Restart Recovery

- Status: `ERROR`
- Budget: no duplicate scheduled starts; recovery within 30 seconds.
- Available evidence: targeted worker tests passed for lease ownership, due work,
  active run sync, graph advancement, degraded retry, and restart recovery.
- Result: live duplicate-start and restart-recovery budgets not validated because
  e2e execution is blocked by port `3100` already in use.

## US3 Atomic Mutation And Partial Corruption

- Status: `SKIPPED`
- Reason: runtime graph mutation validator, apply service, route, and UI were not
  implemented in this checkpoint. Persistence primitives exist, but atomic
  mutation behavior cannot be validated until US3 is selected for implementation.
