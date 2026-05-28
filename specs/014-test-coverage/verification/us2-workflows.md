# US2 Workflow Validation

## API Workflow Tests

### Command

- `DATABASE_URL=file:/home/saya/workspace/Chrona/.tmp/us2-workflow-tests.db NODE_ENV=test bun test ./apps/server/src/__tests__/api/task-validation-workflow.bun.test.ts ./apps/server/src/__tests__/api/plan-lifecycle-edge-workflow.bun.test.ts ./apps/server/src/__tests__/api/schedule-proposal-conflict-workflow.bun.test.ts ./apps/server/src/__tests__/api/provider-bridge-malformed-workflow.bun.test.ts`

### Result

- PASS: 11 tests, 52 assertions, 0 failures.

### Coverage

- Task create/update validation preserves canonical state and rejects invalid runtime config.
- Plan acceptance rejects superseded drafts and supersedes prior accepted plans.
- Schedule proposal conflict decisions keep competing proposals explicit and prevent duplicate decisions.
- Provider bridge malformed response persists failed run state, task blocked state, and provider failure event evidence.

## Web MSW Workflow Tests

### Command

- `bun run test apps/web/src/components/tasks/workspace/page/task-workspace-msw.test.tsx`

### Result

- PASS: 1 test file, 2 tests, 0 failures.

### Coverage

- Task workspace refreshes page data after MSW-backed workspace event stream updates.
- Task workspace preserves last known state when refresh after stream update returns an error.

## Browser Evidence

- Pre-edit observation: `verification/browser-pre-edit.md`
- Desktop post-edit verification: `verification/browser-post-desktop.md`
- Tablet post-edit verification: `verification/browser-post-tablet.md`
- Mobile post-edit verification: `verification/browser-post-mobile.md`

## Deferred Full Commands

- Full e2e commands remain Phase 7 validation: `bun run test:e2e:desktop`, `bun run test:e2e:tablet`, `bun run test:e2e:mobile`.
- US2 implementation adds deterministic e2e specs for desktop/tablet/mobile responsive flow and no-horizontal-scroll assertions; full suite execution is tracked in T060-T062.
