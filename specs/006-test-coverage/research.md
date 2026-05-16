# Research: Test Coverage

## Decision: Reuse Existing Test Runners

**Decision**: Use the current test stack: Vitest/jsdom for web unit/component tests, Bun test for runtime/API/engine behavior, and Playwright for browser workflow and layout checks.

**Rationale**: The repository already exposes `bun run test`, `bun run test:bun`, `bun run test:api`, and `bun run test:e2e`. Reusing these commands keeps validation compatible with existing development and release gates while avoiding a parallel test ecosystem.

**Alternatives considered**: Add a new dedicated test runner or visual testing service. Rejected because the spec asks for complete test code, not a new testing platform, and existing tooling already covers the required test levels.

## Decision: Put Complex Graph Coverage Near Plan Execution Ownership

**Decision**: Cover complex plan graph behavior primarily in engine/runtime tests, then add API-level coverage for persistence and user-visible state transitions.

**Rationale**: Graph ordering, checkpoint handling, retries, blocked paths, and failure containment are business/runtime behaviors. Proving them at the engine layer keeps failures narrow and fast; API coverage verifies the same behavior survives real route and storage boundaries.

**Alternatives considered**: Test every graph case only through Playwright. Rejected because browser-only graph tests would be slower, less diagnostic, and more likely to fail for UI reasons unrelated to graph correctness.

## Decision: Treat Checkpoint Error As Regression Evidence

**Decision**: Add explicit regression scenarios that fail if `OpenClaw did not return review_checkpoint_node_result` appears during supported checkpoint flows.

**Rationale**: The user named this legacy error as an active concern. Tests should make the error impossible to reintroduce silently and should capture whether it appears in logs, result payloads, visible UI, or failed execution state.

**Alternatives considered**: Only assert final success state. Rejected because the legacy error could still leak into diagnostics or UI while the final state appears acceptable.

## Decision: Split UI Coverage Between Component State Tests And Browser Checks

**Decision**: Use component/view-model tests for state rendering and Playwright for full workflow, responsive layout, keyboard reachability, and visible usability checks.

**Rationale**: Component tests give fast coverage for loading, empty, executing, blocked, failed, completed, and retry states. Browser tests are needed for actual viewport, layout, and navigation behavior.

**Alternatives considered**: Use only snapshots or only manual review. Rejected because snapshots are weak for usability and manual review is not repeatable enough for regression protection.

## Decision: Use Deterministic Fixtures And Isolated Data

**Decision**: Test scenarios should define their graph topology, checkpoint payloads, expected state transitions, and UI state fixtures explicitly, with isolated or cleaned test data for repeated runs.

**Rationale**: The spec requires repeated local runs to produce the same pass/fail result for at least 95% of scenarios. Deterministic fixtures and test data isolation are the practical way to meet that target.

**Alternatives considered**: Generate random graph scenarios for broad coverage. Rejected for the first version because random tests are harder to diagnose and can undermine deterministic local validation.

## Decision: Reports Must Distinguish Setup Failures From Product Failures

**Decision**: Test diagnostics should identify whether failure came from test setup, missing server/browser/database state, or Chrona product behavior.

**Rationale**: The spec requires maintainers to identify the failing scenario and product symptom within 2 minutes. Ambiguous setup failures slow triage and reduce trust in the suite.

**Alternatives considered**: Rely on raw runner output only. Rejected because raw output often buries the product symptom under framework or environment errors.
