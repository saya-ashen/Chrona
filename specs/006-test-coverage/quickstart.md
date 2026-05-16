# Quickstart: Test Coverage

## Goal

Validate that Chrona's current task-to-plan-to-execution workflow, complex plan graph handling, checkpoint regression behavior, and task workspace UI remain correct and usable.

## Prerequisites

- Dependencies installed.
- Local database can be generated and seeded.
- Browser dependencies for Playwright are available when running end-to-end checks.
- No unrelated local server is occupying the configured development ports.

## Recommended Validation Flow

1. Prepare generated database/client state:

   ```bash
   bun run db:generate
   bun run db:seed
   ```

2. Run static gates:

   ```bash
   bun run typecheck
   bun run lint
   ```

3. Run fast web/unit coverage:

   ```bash
   bun run test
   ```

4. Run Bun runtime and engine/API coverage:

   ```bash
   bun run test:bun
   bun run test:api
   ```

5. Run browser workflow and layout checks:

   ```bash
   bun run test:e2e
   ```

## Required Scenario Evidence

When tests fail, the report should identify:

- Scenario name.
- Whether the failure is setup or product behavior.
- Expected task, plan, graph, checkpoint, execution, or UI state.
- Actual state or visible UI symptom.
- Any screenshot, trace, log, or state snapshot produced by the runner.

## Functional Coverage Checklist

- Core task can be created from a normal request.
- Plan can be generated and inspected.
- Execution can start from a valid plan.
- Execution progress is observable.
- Terminal state matches completed, failed, blocked, or cancelled path.
- Repeated local runs do not depend on hidden data from prior runs.

## Complex Graph Coverage Checklist

- Linear graph.
- Branching graph.
- Dependency join.
- Sequential dependency chain.
- Review checkpoint.
- Retryable failure.
- Blocked node.
- Partial branch failure.
- Missing checkpoint result.
- Malformed checkpoint result.
- Empty or impossible graph.
- Cyclic or otherwise invalid graph.

## Interface Coverage Checklist

- Desktop planning view.
- Desktop execution view.
- Mobile planning view.
- Mobile execution view.
- Loading state.
- Empty state.
- Executing state.
- Blocked state.
- Failed state.
- Completed state.
- Retry state.
- Keyboard access to primary actions.
- Accessible names for primary actions and important status regions.

## Pass Criteria

- All required local commands pass or a documented environment blocker identifies why a command could not run.
- The known legacy checkpoint error text is absent from supported checkpoint scenarios.
- Primary functional and interface suites complete within 10 minutes under normal local development conditions.
- Failed tests give enough evidence for a maintainer to identify the failing scenario and product symptom within 2 minutes.

## Scenario Validation Checklist

- Run `bun test packages/contracts/src/api/tasks.schema.bun.test.ts` after schema or API contract changes.
- Run `bun test packages/engine/src/modules/plan-execution/plan-runner.complex-graphs.bun.test.ts packages/engine/src/modules/plan-execution/plan-runner.checkpoints.bun.test.ts packages/engine/src/modules/plan-execution/plan-runner.failure-recovery.bun.test.ts packages/engine/src/modules/plan-execution/plan-runner.invalid-graphs.bun.test.ts` after graph fixture changes.
- Run `bun test apps/server/src/__tests__/api/task-flow-functional.bun.test.ts apps/server/src/__tests__/api/task-flow-diagnostics.bun.test.ts apps/server/src/__tests__/api/plan-execution-checkpoint-regression.bun.test.ts` after API flow fixture changes.
- Run `bun run test -- apps/web/src/components/tasks/workspace/page/task-workspace-page.test.tsx apps/web/src/components/tasks/plan/task-plan-graph.test.tsx apps/web/src/components/tasks/workspace/execution/task-workspace-execution-overview.test.tsx` after workspace UI changes.
- Run `bun run test:e2e -- e2e/specs/task-workspace-layout.spec.ts e2e/specs/task-workspace-accessibility.spec.ts` when browser dependencies and a local test database are available.
