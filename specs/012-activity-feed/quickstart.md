# Quickstart: Workspace Activity Feed

## 1. Pre-Edit Context

1. Review `specs/012-activity-feed/spec.md`, `plan.md`, `research.md`, `data-model.md`, and `contracts/activity-feed-contract.md`.
2. Run CodeGraph/GitNexus impact analysis before editing symbols that shape task page activity, runtime event state, node drawer tabs, or Command Center activity.
3. Capture pre-edit screenshots for the task workspace at desktop `1440x900`, tablet `1024x768`, and mobile `390x844`.
4. Confirm current task, active/selected node, blocked/review state, and primary action are visible before changing UI.

## 2. Phase 1 Implementation Slice

1. Define the structured activity item contract and update task page/live activity shaping to use it.
2. Render one shared Activity feed in Command Center and node drawer.
3. Replace node drawer Evidence tab with Activity and remove the user-facing Evidence tab path for this workflow.
4. Filter node drawer activity by recorded node identity only.
5. Deduplicate persisted and live activity.
6. Render provider tool started/completed/failed states with summary details and expandable long content.
7. Add empty states for task-wide and node-scoped feeds.

## 3. Phase 2 Implementation Slice

1. Add progressive older-history browsing for task and node scopes.
2. Preserve node filters while loading older activity.
3. Validate long-running tasks with at least 3,000 recorded events against the 2-second initial visible feed budget.
4. Improve detail expansion for long previews, inputs, errors, assistant output, and reasoning.

## 4. Phase 3 Implementation Slice

1. Remove remaining old Evidence drawer workflow code for this feature.
2. Remove coarse-only activity renderer paths that bypass the structured model.
3. Remove old-data compatibility fallbacks for provider events that lack node identity.
4. Verify no time-window node inference remains.
5. Audit tests and UI copy for old labels or duplicate activity models.

## 5. Required Verification

Run focused tests first, then full checks:

```bash
bun test apps/server/src/__tests__/api/plan-execution-output.bun.test.ts apps/server/src/__tests__/api/task-workspace-console.bun.test.ts apps/web/src/components/tasks/workspace/model/task-workspace-query.test.ts apps/web/src/components/tasks/workspace/execution/task-workspace-execution-overview.test.tsx apps/web/src/components/tasks/workspace/execution/task-workspace-node-detail-panel.test.tsx
bun test apps/server/src/__tests__/api/task-workspace-activity.bun.test.ts packages/engine/src/modules/tasks/get-task-page-orchestrator.bun.test.ts packages/contracts/src/api/tasks.schema.bun.test.ts
bun run test -- apps/web/src/components/tasks/workspace/model/task-workspace-activity.test.ts apps/web/src/components/tasks/workspace/model/task-workspace-actions.test.ts apps/web/src/components/tasks/workspace/execution/workspace-activity-feed.test.tsx apps/web/src/components/tasks/workspace/hooks/use-task-workspace-plan-state.test.tsx
bun run typecheck
bun run lint
bun run test
bun run test:e2e
```

Implementation note: `bun run lint` and `bun run test:e2e` can fail on existing repository-wide issues unrelated to this feature. Record exact failures in `specs/012-activity-feed/verification/` when they occur.

Run UI foundation check when adding or changing shared controls:

```bash
bun run check:ui-foundation
```

## 6. Browser Verification

After implementation, rerun capture evidence for:

- Desktop `1440x900`: Command Center Activity shows task-wide provider/tool activity; node drawer Activity shows selected-node activity.
- Tablet `1024x768`: Feed remains readable; expandable tool details do not hide primary action.
- Mobile `390x844`: No horizontal scrolling; active task/node/blocked state remains visible; drawer feed remains usable.

## 7. Acceptance Checklist

- `Activity` singular appears in the node drawer.
- `Evidence` does not appear as a node drawer tab in the final feature state.
- Command Center shows task-wide latest activity.
- Node drawer shows only selected-node activity.
- Tool calls show started/completed/failed states and useful details.
- Assistant and reasoning fragments merge only inside matching node/run/provider boundaries.
- Live and persisted activity do not duplicate.
- Older history can be browsed without breaking filters.
- Final audit finds no old compatibility fallback for events without node context.
