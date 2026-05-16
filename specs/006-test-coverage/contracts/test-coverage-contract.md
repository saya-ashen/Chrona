# Contract: Test Coverage

This contract defines the expected coverage, scenario groups, and diagnostic obligations for the Chrona test suite created by this feature.

## Coverage Groups

### Core Task Flow

**Purpose**: Prove Chrona can create a task, generate a plan, execute work, and expose a terminal state.

**Required Scenarios**:
- Create task from a normal user request.
- Generate an inspectable plan.
- Start execution from a valid plan.
- Observe progress state during execution.
- Reach a terminal completed, failed, blocked, or cancelled state.
- Verify final workspace state matches the executed path.

**Acceptance Contract**:
- State changes are internally consistent after every major step.
- Final state is user-visible and explainable.
- Test data does not depend on previous local runs.

## Complex Plan Graphs

**Purpose**: Prove graph execution stays safe under realistic plan complexity.

**Required Scenario Types**:
- Linear multi-step graph.
- Branching graph with independent branches.
- Branching graph with shared dependency join.
- Sequential dependency chain.
- Review checkpoint node.
- Retryable node.
- Blocked node.
- Node failure with dependent-node containment.
- Partial branch failure with unrelated branch progress preserved.
- Missing checkpoint result.
- Malformed checkpoint result.
- Invalid graph such as empty, impossible, or cyclic topology.

**Acceptance Contract**:
- Ready nodes do not run before prerequisites complete.
- Blocked and waiting nodes are clearly marked.
- Invalid graphs are rejected or contained safely.
- Supported checkpoint flows never emit `OpenClaw did not return review_checkpoint_node_result`.
- Repeated runs on the same revision produce consistent pass/fail results.

## Recovery And Regression

**Purpose**: Prove Chrona handles interruptions, retries, and known legacy failures safely.

**Required Scenarios**:
- Execution interrupted after partial progress.
- Execution resumed after partial progress.
- Retry after a node failure.
- Retry after a delayed or missing checkpoint result.
- Legacy checkpoint error text detection in logs, result payloads, visible UI, or failure output.

**Acceptance Contract**:
- Retried work does not duplicate completed side effects in covered scenarios.
- Recovery state is visible and actionable.
- Legacy error text fails the regression scenario immediately.

## Interface Usability And Layout

**Purpose**: Prove the planning and execution workspace is usable in primary states and viewports.

**Required States**:
- Loading.
- Empty.
- Planning.
- Executing.
- Blocked.
- Failed.
- Completed.
- Retryable.

**Required Viewports**:
- At least one desktop-sized viewport.
- At least one mobile-sized viewport.

**Required Checks**:
- Primary controls visible or reachable.
- Status indicators readable.
- Graph details accessible.
- Progress and error messages not clipped.
- Long task titles and node names do not break layout.
- Keyboard navigation reaches primary actions.
- Primary actions and important status regions have understandable accessible names.

**Acceptance Contract**:
- Tests fail on hidden primary actions, overlapping core content, clipped status text, and unreachable controls.
- UI failures include enough visible evidence to triage the affected screen.

## Diagnostics Contract

Every failing high-risk scenario MUST report:

- Scenario id and name.
- Suite group.
- Requirement or success criterion reference.
- Expected outcome.
- Actual outcome.
- Relevant visible text or state summary.
- Setup failure versus product failure classification.
- Artifact references when the runner provides screenshots, traces, logs, or reports.

## Scenario Id Naming

Scenario ids MUST be stable, lowercase, and kebab-cased. Prefix ids by suite when
the runner output is otherwise ambiguous:

- `core-flow-*` for task creation, planning, execution progress, and terminal state.
- `complex-graph-*` for graph ordering, branching, joining, invalid topology, retry, and containment.
- `checkpoint-regression-*` for supported checkpoint result handling and legacy error detection.
- `interface-*` for component, layout, viewport, keyboard, and accessible-name checks.

Each diagnostic payload SHOULD include `scenarioId`, `expected`, `actual`,
`visibleText` when applicable, and a `stateSnapshot` or artifact reference.

## Validation Commands

The implementation plan expects these proof commands to remain valid:

- `bun run typecheck`
- `bun run lint`
- `bun run test`
- `bun run test:bun`
- `bun run test:api`
- `bun run test:e2e`

If a command cannot run in a local environment, the implementation MUST document the blocker and still keep narrower deterministic tests available.
