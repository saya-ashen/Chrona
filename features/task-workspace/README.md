# task-workspace

## Entry points
- UI page: ui/task-workspace-page.tsx
- Header UI: ui/task-workspace-header-card.tsx
- Derived state: model/task-workspace-state.ts
- View model: model/task-workspace-query.ts
- Actions: model/task-workspace-actions.ts
- Activity: model/task-workspace-activity.ts
- Tests: tests/

## State source
- createTaskWorkspaceExecutionConsoleView()
- deriveWorkspacePresentationState()
- buildWorkspaceStateTreatment()
- getWorkspaceActionDisabledReason()

## Commands
- bun run test:feature task-workspace

## Public exports
- index.ts
