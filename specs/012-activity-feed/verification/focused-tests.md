# Focused Tests

Result: passed.

Commands and results:

```text
bun run test -- apps/web/src/components/tasks/workspace/model/task-workspace-query.test.ts
20 passed

bun run test -- apps/web/src/components/tasks/workspace/execution/task-workspace-execution-overview.test.tsx
6 passed

bun run test -- apps/web/src/components/tasks/workspace/execution/task-workspace-node-detail-panel.test.tsx
7 passed

bun run test -- apps/web/src/components/tasks/workspace/page/task-workspace-page.test.tsx
18 passed

bun test packages/contracts/src/api/tasks.schema.bun.test.ts
7 passed

bun run test -- apps/web/src/components/tasks/workspace/model/task-workspace-activity.test.ts
5 passed

bun test packages/engine/src/modules/tasks/get-task-page-orchestrator.bun.test.ts
4 passed

bun test apps/server/src/__tests__/api/task-workspace-activity.bun.test.ts
2 passed

bun run test -- apps/web/src/components/tasks/workspace/model/task-workspace-actions.test.ts apps/web/src/components/tasks/workspace/execution/workspace-activity-feed.test.tsx
15 passed

bun run test -- apps/web/src/components/tasks/workspace/sections/task-workspace-plan-section.test.tsx apps/web/src/components/tasks/workspace/execution/task-workspace-node-detail-panel.test.tsx apps/web/src/components/tasks/workspace/execution/workspace-activity-feed.test.tsx apps/web/src/components/tasks/workspace/model/task-workspace-actions.test.ts
32 passed

bun run test -- apps/web/src/components/tasks/workspace/hooks/use-task-workspace-plan-state.test.tsx
2 passed
```
