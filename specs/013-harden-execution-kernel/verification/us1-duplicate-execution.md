US1 duplicate execution verification

Commands:

- `DATABASE_URL=file:/tmp/chrona-spec-013-us1.sqlite bun test packages/engine/src/modules/plan-execution/plan-runner.task-executor.continuation.bun.test.ts`
- `DATABASE_URL=file:/tmp/chrona-spec-013-us1.sqlite bun prisma db push --accept-data-loss --force-reset`
- `bun run typecheck`
- `bun test packages/engine/src/modules/plan-execution/runtime/execution-fencing.bun.test.ts packages/engine/src/modules/plan-execution/runtime/node-attempt-idempotency.bun.test.ts packages/engine/src/modules/plan-execution/node-executors/condition-executor.bun.test.ts`
- `DATABASE_URL=file:/tmp/chrona-spec-013-us1-node-ai.sqlite bun run db:push --force-reset`
- `DATABASE_URL=file:/tmp/chrona-spec-013-us1-node-ai.sqlite bun test packages/engine/src/modules/plan-execution/node-ai-capabilities.bun.test.ts`

Result:

- Initial test run did not reach US1 assertions because the temp SQLite database had no tables: Prisma P2021 `taskAssistantMessage` table does not exist.
- Schema initialization failed before tests could be rerun: Prisma schema engine response parse error, `Unexpected token 'D', "\tDid you me"... is not valid JSON`.
- `bun run typecheck` passed after US1 implementation.
- Runtime/idempotency/condition executor focused tests are source-valid, but the combined Bun test process still imports `@/lib/db` from one module and fails without explicit `DATABASE_URL` after six passing tests.
- The DB-backed node AI focused test remains blocked by the same Prisma SQLite bootstrap issue: `bun run db:push --force-reset` fails with schema engine response parse error, then the test fails with Prisma P2021 `TableDoesNotExist`.

Follow-up:

- Keep the US1 regression tests in `packages/engine/src/modules/plan-execution/plan-runner.task-executor.continuation.bun.test.ts`.
- Rerun once the Bun/Prisma test database bootstrap is available in the environment.
