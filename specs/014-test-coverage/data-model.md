# Data Model: Complete Test Coverage

## Entity: Test Inventory

**Purpose**: Records the existing project structure, test runners, helper files, and currently covered workflows before new tests are added.

**Fields**:

- `area`: Product or package area, such as frontend, server API, domain, engine, graph runtime, provider, database, or e2e.
- `currentCoverage`: Existing test files or workflow descriptions.
- `runner`: The validation path used for the area.
- `knownGaps`: Missing or weak coverage identified before implementation.
- `priority`: Risk-based priority for adding or reorganizing tests.

**Validation Rules**:

- Every critical business workflow must appear in the inventory.
- Every identified gap must either map to planned test work or a documented residual risk.

## Entity: Core Behavior Test

**Purpose**: Protects focused product behavior at the narrowest effective level.

**Fields**:

- `behavior`: User or business behavior being protected.
- `area`: Owning package or application area.
- `scenario`: Input, action, and expected outcome.
- `dataSetup`: Minimal deterministic data required.
- `assertions`: Observable outcomes and invariants.

**Validation Rules**:

- Must not depend on unrelated test execution order.
- Must not require live network, secrets, or third-party state.
- Test name or grouping must make protected behavior clear.

## Entity: Workflow Test

**Purpose**: Validates a complete user-relevant path across integration boundaries.

**Fields**:

- `workflow`: Task, plan, schedule, execution, provider, or navigation journey.
- `entryPoint`: User-relevant action or integration boundary.
- `expectedOutcome`: Final visible or persisted result.
- `negativeCases`: Invalid, duplicate, stale, or conflicting actions covered.
- `viewportCoverage`: Desktop, tablet, and mobile expectations when browser-facing.

**Validation Rules**:

- Must verify final workflow outcome, not only intermediate calls.
- Browser workflow tests affecting navigation or task/schedule surfaces must include responsive coverage expectations.

## Entity: Regression Test

**Purpose**: Preserves known fragile or previously broken behavior.

**Fields**:

- `risk`: Historical or bug-prone behavior protected.
- `minimalReproduction`: Smallest deterministic scenario that exposes the risk.
- `expectedProtection`: Assertion that would fail if the regression returned.
- `relatedArea`: Execution, provider parsing, schedule/task state, UI workflow, or API validation.

**Validation Rules**:

- Must be minimal enough to diagnose failure quickly.
- Must be added before or with any future bug fix when feasible.

## Entity: Provider Response Fixture

**Purpose**: Replays external AI/provider behavior without live network calls.

**Fields**:

- `provider`: Provider identifier.
- `feature`: Feature or scenario being exercised.
- `requestHash`: Hash of the provider request snapshot.
- `redactedRequest`: Safe request data without secrets or real user data.
- `responseSnapshot`: Provider-level returned snapshot.
- `recordedAt`: Date the fixture was recorded.

**Validation Rules**:

- `responseSnapshot` must represent provider-level returned data, not upper-layer business service output.
- Must not contain API keys, authorization headers, real user content, local absolute paths, or chain-of-thought traces.
- Replay must avoid network access.

## Entity: Coverage Summary

**Purpose**: Final deliverable mapping changed tests to covered scenarios and remaining risk.

**Fields**:

- `addedTests`: New test files and scenarios.
- `changedTests`: Reorganized or updated test files and rationale.
- `coveredScenarios`: Business risks now protected.
- `commandsRun`: Validation commands and outcomes.
- `remainingRisks`: Uncovered risks, reason, and recommended next step.

**Validation Rules**:

- Every added or changed test must map to at least one covered scenario.
- Every known gap not covered by tests must appear in remaining risks.
