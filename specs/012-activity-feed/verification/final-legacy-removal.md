# Final Legacy Removal Audit

Result: passed for the activity-feed feature scope.

Audited files:

```text
apps/web/src/components/tasks/workspace/model/task-workspace-types.ts
apps/web/src/components/tasks/workspace/model/task-workspace-activity.ts
apps/web/src/components/tasks/workspace/model/task-workspace-query.ts
apps/web/src/components/tasks/workspace/execution/task-workspace-execution-overview.tsx
apps/web/src/components/tasks/workspace/execution/task-workspace-node-detail-panel.tsx
packages/engine/src/modules/tasks/get-task-page.ts
packages/contracts/src/api/tasks.schema.ts
```

Findings:

```text
Node drawer Evidence tab path removed from TaskWorkspaceNodeDetailPanel.
Node detail tabs now use result/activity/action/configuration.
Command Center Activity tab uses shared WorkspaceActivityFeed.
Old ActivityCard/RuntimeActivityRow rendering helpers removed from execution overview.
Activity tones use neutral/info/success/warning/danger; remaining `critical` belongs to non-activity ExecutionOverviewTone and is converted to danger at the activity boundary.
Provider events without node context are not inferred into node feeds; node filtering requires explicit sourceNodeId match.
Remaining `sourceNodeTitle` is part of the structured activity contract, not a legacy compatibility path.
Remaining resultEvidence data is only used for artifact/result metadata, not as a user-facing drawer Evidence tab.
```
