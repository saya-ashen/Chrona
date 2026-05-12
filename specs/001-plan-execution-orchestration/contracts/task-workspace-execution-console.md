# Task Workspace Execution Console Contract

## Purpose

This UI contract defines the first task workspace redesign increment based on `docs/assets/设计参考.png`. It defines visible behavior, data mapping, and the criteria for adding backend read contracts when existing task workspace data is insufficient.

## Scope

- Applies to route `/:lang/workspaces/:workspaceId/tasks/:taskId` rendered by `TaskWorkspacePage`.
- Uses existing loader/API data from `TaskPageData`, plan state reads, and execution dispatch actions where sufficient.
- Allows narrowly scoped read API additions when required console components cannot be backed accurately by existing data.
- Preserves current AI workspace, task edit, plan generation, plan acceptance, node dispatch, and delete behavior.

## Layout Contract

### Global Shell

- The left navigation and top shell remain owned by `ControlPlaneShell`.
- Task workspace must not render duplicate global navigation.

### Top Execution Header

- Must show task title.
- Must show task status and priority/runnability badges or equivalent user-facing labels.
- Must show progress as completed step count, total step count, and percent complete when a graph exists.
- Must expose existing task actions: return to schedule, delete task confirmation, and plan generation/acceptance where applicable.
- Must provide loading/disabled feedback for generation and acceptance actions.

### Central Plan Graph

- Must use the existing task plan graph data and preserve node selection behavior.
- Must visually distinguish completed, active/running, waiting/attention, blocked, and pending nodes.
- Must keep graph usable without right-side inspector overlay on desktop so the lower node detail panel can own details.
- Empty state must show a clear plan-generation path.

### Lower Node Detail Panel

- Must show details for the selected node, or the current execution node when no node is selected.
- Must expose result, evidence, operation/action, and configuration groupings.
- Must preserve execution action behavior from existing inspector/run panel code when node actions are available.
- Must show a useful empty state when no plan/node exists.

### Right Execution Overview

- Must show latest result summary when a node or task result exists.
- Must show one attention card when blocked, waiting for input, or waiting for approval state exists.
- Must show artifact list from current node outputs and/or `TaskPageData.artifacts`.
- Must show a compact execution activity list derived from known node/task state.
- Must remain read-only unless an existing action is already supported by current task workspace behavior.

## Responsive Contract

- `xl` and wider: page content uses two columns, central workspace plus right overview.
- Below `xl`: header, graph, overview, and node detail stack vertically.
- No fixed desktop-only height may make content unreachable on mobile.
- Floating AI workspace button/panel remains accessible above the redesigned layout.

## Data Mapping Contract

| UI Field | Source |
|----------|--------|
| Task title | `TaskData.title` |
| Task badges | `TaskData.status`, `TaskData.priority`, `TaskData.runnabilitySummary` |
| Progress | `TaskPlanGraphPlan.nodes` statuses |
| Current node | selected node, then `currentStepId`, then active/attention fallback |
| Latest result | `PlanNodeDataModel.result`, `completionSummary`, `resultOutputs`, or `TaskPageData.latestRunSummary` |
| Attention card | `TaskData.blockReason`, waiting/blocked graph nodes, approvals |
| Artifacts | `PlanNodeDataModel.resultOutputs`, `TaskPageData.artifacts` |
| Timeline | node statuses plus latest run summary; persisted event data may enhance later |

## Implementation Inspection Notes

Confirmed during implementation setup:

- Editable web boundary: `apps/web/src/components/tasks/task-workspace-page.tsx` owns page composition and wires editor, proposal, plan-state, and delete flows.
- Editable header boundary: `apps/web/src/components/tasks/task-workspace-header-card.tsx` owns task status and top actions.
- Editable layout boundary: `apps/web/src/components/tasks/task-workspace-plan-section.tsx` owns plan content plus inspector/side content placement.
- Editable graph content boundary: `apps/web/src/components/tasks/task-workspace-plan-content.tsx` owns graph empty/generating/accepted states and delegates to `TaskPlanGraphPanel`.
- Editable AI boundary: `apps/web/src/components/tasks/task-workspace-ai-section.tsx` owns floating AI workspace placement.
- Existing client reads in `apps/web/src/components/tasks/task-workspace-query.ts`: `GET /api/tasks/:taskId`, `GET /api/tasks/:taskId/plan`, and SSE dispatch through `/api/tasks/:taskId/execution/actions`.
- Existing page data in `apps/web/src/components/tasks/task-workspace-types.ts`: task status/priority/schedule/runnability, latest run summary, schedule proposals, approvals, artifacts, dependencies, saved plan, and plan generation status.
- Actual server route files are split under `apps/server/src/routes/tasks/`: `crud.routes.ts`, `plan.routes.ts`, `execution.routes.ts`, `schedule.routes.ts`, and `result.routes.ts`. Earlier planning path names without the `tasks/` directory are documentation aliases, not physical file paths.
- Server read coverage: `crud.routes.ts` exposes task detail through `engine.tasks.getPage`; `plan.routes.ts` exposes plan state/generation/accept/patch operations; `execution.routes.ts` exposes execution action SSE dispatch only; `schedule.routes.ts` exposes schedule apply/clear/propose/decision mutation routes; `result.routes.ts` exposes task result acceptance.
- Missing or ambiguous read data candidates: real chronological execution activity, action metadata for pending input/approval, node-attributed artifacts/evidence beyond current graph outputs, and latest result normalized across node/run/task boundaries.

## API Addition Criteria

A new or expanded read API is allowed when all of these are true:

1. A visible console component requires data that is missing, stale, ambiguous, or not attributable from current task workspace reads.
2. The data cannot be derived safely from `TaskPageData`, plan state, accepted graph nodes, node outputs, approvals, artifacts, or latest run summary.
3. The API returns a narrow task-scoped read model instead of exposing persistence internals.
4. Empty, loading, and error states are defined for the consuming component.
5. Contract or integration tests cover the new response shape.

Preferred additions, if needed:

| Need | Preferred Contract Direction |
|------|------------------------------|
| Execution timeline with real event timestamps | Add task-scoped execution activity read model |
| Latest result across node/run/task boundaries | Add task-scoped latest execution result summary |
| Evidence and artifacts linked to a selected node | Add node-scoped result/evidence read model or expand plan-state node payload |
| Pending approvals/input with action metadata | Expand task workspace detail with attention items |

## Data Source Decision Matrix

| Reference-Inspired Component | First Increment Source | API Decision |
|------------------------------|------------------------|--------------|
| Top progress header | `TaskPlanGraphPlan.nodes` derived from existing plan-state read | Existing data is sufficient. |
| Current node detail | Selected graph node, then `currentStepId`, then active/attention/ready fallback | Existing data is sufficient. |
| Latest result card | `PlanNodeDataModel.completionSummary`, `PlanNodeDataModel.result`, then `TaskPageData.latestRunSummary` | Existing data is sufficient for MVP; a normalized latest-result read model can enhance attribution later. |
| Needs handling card | `TaskPageData.approvals`, `TaskData.blockReason`, and waiting/blocked graph nodes | Existing data is sufficient for MVP; action metadata expansion may be added later if inline resolution requires richer payloads. |
| Artifacts card | `PlanNodeDataModel.resultOutputs` and `TaskPageData.artifacts` | Existing data is sufficient for MVP; node-attributed artifact reads can enhance provenance later. |
| Execution activity card | Latest run summary plus non-idle graph node statuses | Existing data is sufficient for MVP compact activity; real timestamped event history requires a future task-scoped activity API. |

No new API is required for the first execution-console UI increment. Future API work remains allowed when a visible component cannot be reliably derived from existing task detail, plan-state, execution, artifact, approval, or run summaries.

## Non-Goals For First Increment

- No new first-class `WorkBlock` persistence.
- No new first-class `ExecutionSession` persistence.
- No replacement of `TaskPlanGraphPanel`.
- No duplicate navigation shell.
- No broad API contract migration from run terminology to execution-session terminology.
- No prohibition on small task workspace read APIs when required by visible UI components.

## Acceptance Checks

1. A task with no plan shows a clear empty graph state and generation action.
2. A task with an accepted plan shows progress, graph, current node detail, overview cards, and AI workspace access.
3. A blocked or waiting node surfaces a right-side attention card and node detail message.
4. A completed node with outputs shows latest result and artifacts without inventing data.
5. Desktop layout matches the reference structure; mobile layout remains readable and reachable.
6. Existing plan generation, acceptance, execution dispatch, task edit, and delete flows still work.
7. Any new API added for console data has documented consumer, response shape, empty/error behavior, and tests.
