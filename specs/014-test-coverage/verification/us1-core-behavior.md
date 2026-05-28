# US1 Core Behavior Validation

| Command | Result | Notes |
|---------|--------|-------|
| `bun test ./packages/domain/src/task/task-state-boundaries.bun.test.ts ./packages/domain/src/plan/plan-state-boundaries.bun.test.ts ./packages/domain/src/task/schedule-proposal-boundaries.bun.test.ts ./packages/graph-runtime/src/graph-runtime.invalid-transitions.bun.test.ts ./packages/engine/src/modules/plan-execution/__tests__/execution-state-invariants.bun.test.ts ./packages/engine/src/modules/ai/__tests__/provider-response-parsing.bun.test.ts ./packages/contracts/src/api/task-plan-boundaries.bun.test.ts` | PASS | 22 tests passed, 0 failed, 44 assertions |

Covered core scenarios:

- Task state selection uses `latestRunId`, falls back to newest run, exposes pending approval, and preserves paused completed replan review state.
- Plan validation warns on high-risk tasks without approval gates, accepts approval-gated high-risk tasks, and rejects cycles before compilation.
- Schedule proposal confirmability handles context drift, applying/applied states, and replacement proposals.
- Graph runtime blocks unknown target nodes and invalid condition branch targets.
- Execution session policy preserves user/manual, approval checkpoint, and linked-subtask ownership invariants.
- Provider response parsing requires provider structured `parsed` payload and propagates provider failure snapshots.
- Task/plan API schemas enforce identifier boundaries, nullable generation instructions, partial updates, and passthrough patch commands.
