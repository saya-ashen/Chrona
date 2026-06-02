# Quickstart: Task Orchestrator

## Goal

Validate that Chrona has a complete scheduler/orchestrator that starts due work, syncs active runs, advances graphs, reconciles state, supports safe runtime graph mutations, and presents one truthful task workspace state.

## Prerequisites

- Development data may be reset or rebuilt.
- The app can run locally with the existing Bun development workflow.
- Runtime provider configuration is available for tests that exercise asynchronous work, or tests use controlled fake runtime adapters.

## Implementation Readiness Checks

1. Confirm old partial scheduled-start behavior has been replaced or delegated to the orchestrator.
2. Confirm scheduler leases exist for due work, task/session advancement, active runs, degraded retries, and graph mutations.
3. Confirm task detail read models expose one authoritative execution summary.
4. Confirm graph nodes distinguish waiting, approval, blocked, failed, degraded, skipped, invalidated, cancelled, and completed states.
5. Confirm graph mutation operations are versioned, validated, atomic, and audited.

## Required Automated Checks

Run these before implementation is considered complete:

```bash
bun run typecheck
bun run lint
bun run test
bun run test:e2e
```

## Required Targeted Tests

### Unit Tests

- Reconciliation produces exactly one task state for each representative input.
- Reconciliation detects completed terminal nodes with pending reachable prerequisites.
- Scheduler lease acquisition prevents duplicate ownership.
- Expired leases can be recovered safely.
- External terminal run results apply to the graph exactly once.
- Waiting states are not reported as true blockers.
- Degraded runtime sync surfaces retry or recovery actions.
- Graph mutation validation rejects stale graph versions.
- Graph mutation validation rejects active-node rewrites without safe cancellation.
- Graph mutation application invalidates downstream work consistently.

### Integration Tests

- Due scheduled work starts once.
- Due scheduled work does not start twice with two scheduler owners.
- Automatic node completion advances to downstream ready nodes.
- User input wait pauses execution with a user-action state.
- Approval wait pauses execution with an approval state.
- True blocker pauses execution with a blocker reason.
- Cancellation stops active execution and ignores late runtime results.
- Degraded run sync retries and then recovers or exposes recovery action.
- Server restart resumes, pauses, completes, or degrades active tasks within the recovery budget.
- Runtime graph mutation applies safe future edits and rejects unsafe active edits.

### Contract Tests

- Task workspace state response contains one authoritative `executionState`.
- `primaryAction` matches `executionState`.
- `readiness` does not contradict blocked or degraded states.
- Node statuses include skipped and invalidated without collapsing them into completed or blocked.
- Recovery actions are present for degraded or inconsistent tasks.

## Browser Evidence

Because task workspace presentation changes are expected, collect before and after UI changes.

Required viewports:

- Desktop: `1440x900`
- Tablet: `1024x768`
- Mobile: `390x844`

Evidence must show:

- Current task is visible.
- Active or next actionable node is visible.
- Waiting, blocked, failed, degraded, skipped, invalidated, and completed states are distinguishable where applicable.
- Primary action is visible.
- Mobile has no horizontal scrolling.
- Browser console has no new relevant errors.

## Manual Scenario Checklist

1. Create or use a task with checkpoints, a condition branch, automatic work, and a terminal checkpoint.
2. Start the task.
3. Verify the workspace shows one coherent running state.
4. Let an automatic node complete outside the current page session.
5. Verify the scheduler advances the graph without manual refresh.
6. Trigger a user input or approval wait.
7. Verify task state, node state, prompt, and primary action all agree.
8. Trigger a true blocker.
9. Verify blocked reason and recovery action are clear.
10. Replace an unstarted downstream subgraph.
11. Verify mutation applies atomically and progress recalculates.
12. Attempt to mutate a running node.
13. Verify mutation is rejected with no partial state change.
14. Restart the server during an active run.
15. Verify the scheduler recovers, completes, pauses, or degrades within 30 seconds.

## Success Budgets

- External terminal result visible in workspace: 10 seconds p95 under normal local conditions.
- Restart recovery: 30 seconds.
- Due scheduled duplicate starts: 0 in 100 two-owner trials.
- Runtime graph mutation partial corruption: 0 accepted mutations.
- Mobile horizontal scroll: 0 affected workspace screens.

## 2026-05-17 Validation Checkpoint

- `bun run typecheck`: PASS.
- `bun run lint`: PASS with warnings only.
- `bun run test`: PASS.
- Targeted orchestrator Bun tests: PASS.
- `bun run test:e2e`: ERROR because port `3100` is already in use.
