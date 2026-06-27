# execution-monitoring

Agent First bridge for execution state observation.

## Public entrypoint

- `features/execution-monitoring/index.ts`

## Exports

- Execution result/status/action contracts from `@chrona/contracts/ai`.
- Runtime progress status mapping helpers.
- Current execution read use case.
- Execution status transition helpers.

## Current implementation owners

- Contracts: `packages/contracts/src/plan-runtime/`.
- Engine read/transition logic: `packages/engine/src/modules/plan-execution/`.
- Workspace presentation: `features/task-workspace/`.

## Tests

- `bun run test:feature execution-monitoring`
