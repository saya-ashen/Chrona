# Quickstart: Complete Test Coverage

## 1. Inventory Existing Coverage

Review existing test locations and map them to critical workflows:

```bash
bun run test
bun run test:bun
bun run test:api
CHRONA_LLM_FIXTURE_MODE=replay bun run test:llm:replay
```

Record gaps for task, plan, schedule, execution, provider, database, frontend behavior, and e2e navigation coverage.

## 2. Add Focused Tests First

Add the narrowest effective tests for pure behavior and state transitions before adding broad workflow tests.

Preferred order:

1. Core behavior tests for domain/runtime/provider parsing.
2. Boundary and invalid-input tests for critical workflows.
3. Regression tests for known fragile execution and provider behavior.
4. Integration workflow tests for user-facing task, plan, schedule, and API outcomes.
5. Browser workflow tests only where task, schedule, navigation, or responsive behavior risk exists.

## 3. Keep External Dependencies Deterministic

Routine tests must not call live providers or third-party services.

Use:

- Local fakes for controlled behavior.
- Provider response fixtures for recorded AI/provider snapshots.
- Explicit opt-in live smoke tests only outside routine validation.

Provider fixtures must store provider-level response snapshots, not upper-layer normalized service results.

## 4. Browser Workflow Evidence

For frontend visual or interaction changes, capture browser evidence before and after edits.

Required viewports when browser behavior is touched:

- Desktop: `1440x900`
- Tablet: `1024x768`
- Mobile: `390x844`

Mobile must not horizontally scroll. Current task, active node, blocked/review state, and primary action must remain visible where applicable.

## 5. Validate

Run relevant focused commands during development, then the full required set before final report:

```bash
bun run typecheck
bun run lint
bun run test
bun run test:bun
bun run test:api
CHRONA_LLM_FIXTURE_MODE=replay bun run test:llm:replay
```

For database-backed focused Bun runs, initialize an isolated SQLite file first:

```bash
bun run scripts/init-sqlite-db.ts --reset .tmp/<suite-name>.db
DATABASE_URL=file:/absolute/path/to/.tmp/<suite-name>.db NODE_ENV=test bun test <files>
```

Run e2e commands when task, schedule, navigation, or browser workflow behavior changes:

```bash
bun run test:e2e:desktop
bun run test:e2e:tablet
bun run test:e2e:mobile
```

Record each final command result under `specs/014-test-coverage/verification/` and mirror the pass/fail status in `coverage-summary.md`.

## 6. Final Report

Final response must summarize:

- New tests.
- Changed or reorganized tests.
- Covered scenarios.
- Commands run and results.
- Remaining uncovered risks with recommended next steps.
