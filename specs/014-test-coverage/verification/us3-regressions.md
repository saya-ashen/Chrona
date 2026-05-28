# US3 Regression Validation

## Database Setup

### Command

- `bun run scripts/init-sqlite-db.ts --reset .tmp/us3-regression-tests.db`

### Result

- PASS: SQLite test database initialized for DB-backed Bun regression tests.

## Engine Regression Tests

### Command

- `DATABASE_URL=file:/home/saya/workspace/Chrona/.tmp/us3-regression-tests.db NODE_ENV=test bun test ./packages/engine/src/modules/plan-execution/__tests__/duplicate-execution-regression.bun.test.ts ./packages/engine/src/modules/plan-execution/__tests__/stop-pause-regression.bun.test.ts ./packages/engine/src/modules/plan-execution/__tests__/serial-branch-result-regression.bun.test.ts ./packages/engine/src/modules/ai/__tests__/provider-fixture-replay-regression.bun.test.ts`

### Result

- PASS: 5 tests, 14 assertions, 0 failures.

### Coverage

- Duplicate manual start does not create a second provider attempt.
- Paused sessions ignore late runtime completions.
- Stopped sessions keep active provider attempts cancelled when late completions arrive.
- Serial branch execution persists the first branch result before starting the next ready branch.
- Provider fixture replay returns recorded failure snapshots without calling a live provider.

## Schedule Regression Test

### Command

- `DATABASE_URL=file:/home/saya/workspace/Chrona/.tmp/us3-regression-tests.db NODE_ENV=test bun test ./apps/server/src/__tests__/api/schedule-proposal-regression.bun.test.ts`

### Result

- PASS: 1 test, 3 assertions, 0 failures.

### Coverage

- Accepted schedule proposals reject duplicate late decisions and preserve the original resolution note.

## Selected Block Sheet Regression Test

### Command

- `bun run test apps/web/src/components/schedule/panels/selected-block-sheet/selected-block-sheet-regression.test.tsx`

### Result

- PASS: 1 test, 0 failures.

### Coverage

- Selected block sheet remains open after task config submission and does not call `onClose` implicitly.
