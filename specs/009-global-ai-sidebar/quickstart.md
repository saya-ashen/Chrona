# Quickstart: Global AI Sidebar

## Preconditions

- Branch: `009-global-ai-sidebar`.
- Read `specs/009-global-ai-sidebar/spec.md`, this plan, and `contracts/ui-contract.md` before implementation.
- Use before editing UI to capture current task and schedule page snapshots/screenshots.

## Implementation Order

1. Add shared contracts in `packages/contracts/src/ai-sidebar.ts` and export them from the contracts package.
2. Add pure proposal/context helpers in `packages/domain/src/ai-sidebar/` with unit tests.
3. Build `apps/web/src/components/global-ai-sidebar/` shell, provider, global entry, context summary, quick action list, conversation, proposal preview, confirmation controls, and schedule ghost-block layer.
4. Add task adapter near `apps/web/src/components/tasks/workspace/` and wire it to existing `TaskWorkspacePage` state and proposal flow without changing confirmed mutation behavior.
5. Add schedule adapter near `apps/web/src/components/schedule/` and render ghost blocks from pending proposal state without inserting them into persisted scheduled arrays.
6. Add i18n messages under `apps/web/src/i18n/messages/en.json` and `apps/web/src/i18n/messages/zh.json`.
7. Add component, domain, and e2e tests for preview-before-confirm safety and responsive behavior.

## Browser Evidence

- Pre-edit: capture current task page and schedule page at desktop `1440x900`, tablet `1024x768`, mobile `390x844`.
- Post-edit: verify sidebar open/close, task context, schedule context, pending preview, stale preview, ghost blocks, and no mobile horizontal scroll at the same viewports.

## Required Checks

Run before implementation handoff:

```bash
bun run typecheck
bun run lint
bun run test
bun run test:e2e
```

## Acceptance Smoke Path

1. Open a task workspace.
2. Activate `Ask Chrona / ⌘K`.
3. Verify fixed right sidebar shows task title, active node, blocker/review state if present, and task quick actions.
4. Trigger a mutating task action and verify a task change preview appears before confirmation.
5. Dismiss the preview and verify task data does not change.
6. Navigate to schedule page while sidebar is open.
7. Verify context and quick actions switch to selected date, queue, free time, and conflicts.
8. Trigger smart scheduling and verify ghost blocks plus preview card appear before confirmation.
9. Change material context and verify confirm is disabled as stale.
10. Confirm a fresh proposal and verify existing task/schedule apply path handles the mutation.

## Performance Validation

- Sidebar open/close and context switch should feel immediate and render within 100 ms after page state is available.
- AI request progress should appear within 500 ms after quick action submission.
- Opening sidebar should not trigger an extra page data fetch when task/schedule context is already loaded.
- Build output should keep sidebar bundle delta under the 35 KB gzip target unless documented with approval.
