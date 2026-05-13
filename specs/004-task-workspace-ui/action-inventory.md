# Task Workspace Action Inventory

## Scope Notes

- Spec paths under `apps/web/src/components/task/...` are stale. Current implementation lives under `apps/web/src/components/tasks/workspace/...` and `apps/web/src/components/tasks/plan/...`.
- Backend changes are not required for the controls retained in this pass. Existing plan execution dispatch already supports node actions through `onDispatchExecutionAction`.

## Inventory

| Region | File | Control | Decision | Contract / Evidence |
| --- | --- | --- | --- | --- |
| Workspace page | `apps/web/src/components/tasks/workspace/page/task-workspace-page.tsx` | Edit section expand/save controls | keep-working | Existing editor state owns draft/save behavior. |
| Plan content | `apps/web/src/components/tasks/workspace/sections/task-workspace-plan-content.tsx` | Generate / regenerate plan | keep-working | Existing `handleGeneratePlanFromHeader` is surfaced in the plan component header actions. |
| Header | `apps/web/src/components/tasks/workspace/page/task-workspace-header-card.tsx` | Start | wire | Dispatches existing `start_manual` execution action; disabled with reason when no accepted plan, task is not runnable, already running, or completed. |
| Header | `apps/web/src/components/tasks/workspace/page/task-workspace-header-card.tsx` | Pause | disable-with-reason | Product-required task control remains visible, but disabled until the execution API exposes a pause action. |
| Header | `apps/web/src/components/tasks/workspace/page/task-workspace-header-card.tsx` | Stop | wire | Dispatches existing `cancel_session` execution action; disabled with reason when no running/waiting execution session exists. |
| Header | `apps/web/src/components/tasks/workspace/page/task-workspace-header-card.tsx` | More menu | keep-working | Opens menu and closes on outside click. |
| Header | `apps/web/src/components/tasks/workspace/page/task-workspace-header-card.tsx` | Schedule link | keep-working | Navigates to `/schedule`. |
| Header | `apps/web/src/components/tasks/workspace/page/task-workspace-header-card.tsx` | Delete Task / Confirm / Cancel | keep-working | Existing delete flow owns confirmation and route action. |
| Plan content | `apps/web/src/components/tasks/workspace/sections/task-workspace-plan-content.tsx` | Accept Plan | keep-working | Existing accept plan handler and loading/error props. |
| Plan section | `apps/web/src/components/tasks/workspace/sections/task-workspace-plan-section.tsx` | Resize execution/detail panels | keep-working | Pointer and keyboard handlers are wired. |
| Execution overview | `apps/web/src/components/tasks/workspace/execution/task-workspace-execution-overview.tsx` | Refresh | remove | No refresh callback in this surface; stale state already renders guidance. |
| Execution overview | `apps/web/src/components/tasks/workspace/execution/task-workspace-execution-overview.tsx` | View full result | keep-working | Focuses current node detail through `onAction`. |
| Execution overview | `apps/web/src/components/tasks/workspace/execution/task-workspace-execution-overview.tsx` | Review and approve / Supplement info | keep-working | Both focus actionable node detail. |
| Execution overview | `apps/web/src/components/tasks/workspace/execution/task-workspace-execution-overview.tsx` | Artifacts View all | remove | No target view or callback. Individual Source remains. |
| Execution overview | `apps/web/src/components/tasks/workspace/execution/task-workspace-execution-overview.tsx` | Artifact Source | keep-working | Focuses source node detail through `onAction`. |
| Execution overview | `apps/web/src/components/tasks/workspace/execution/task-workspace-execution-overview.tsx` | Activity View all | remove | No target view or callback. |
| Current node detail | `apps/web/src/components/tasks/workspace/execution/task-workspace-node-detail-panel.tsx` | Result tab Copy result | wire | Copies result text/output summary to clipboard, with success/failure status. |
| Current node detail | `apps/web/src/components/tasks/workspace/execution/task-workspace-node-detail-panel.tsx` | Result/Evidence/Action/Configuration tabs | keep-working | Tabs switch panel content. |
| Current node detail | `apps/web/src/components/tasks/workspace/execution/task-workspace-node-detail-panel.tsx` | Action selector + fields + Submit | wire | Uses existing execution dispatch contract; duplicate submit blocked while dispatching; required fields disable submit with reason. |
| Current node detail | `apps/web/src/components/tasks/workspace/execution/task-workspace-node-detail-panel.tsx` | Auto-refresh indicator | convert-to-info | Visual status only; not focusable. |
| Graph panel | `apps/web/src/components/tasks/panels/task-plan-graph-panel.tsx` | Extra panel actions slot | keep-working | Caller-provided actions only. |
| Graph | `apps/web/src/components/tasks/plan/task-plan-graph/index.tsx` | Open full graph / close dialog | keep-working | Dialog state is wired. |
| Graph | `apps/web/src/components/tasks/plan/task-plan-graph/frame.tsx` | Zoom in/out, fit, center current, expand | keep-working | Handlers call ReactFlow viewport APIs or dialog state. |
| Graph inspector details | `apps/web/src/components/tasks/plan/task-plan-graph/inspector-details.tsx` | Chips/cards | convert-to-info | Rendered as non-interactive spans/details. |
| Graph inspector run panel | `apps/web/src/components/tasks/plan/task-plan-graph/inspector-run-panel.tsx` | Primary action submit | keep-working | Existing dispatch path maps node actions to execution action inputs. |
| Graph inspector run panel | `apps/web/src/components/tasks/plan/task-plan-graph/inspector-run-panel.tsx` | Observe | remove | Local-log-only passive action removed; backend-connected submit and Mark done remain. |
| Graph inspector run panel | `apps/web/src/components/tasks/plan/task-plan-graph/inspector-run-panel.tsx` | Mark done | keep-working | Existing dispatch path sends `complete_manual_node`. |

## Backend Contract Decisions

- Retained plan generation, accept plan, delete task, and node execution actions use existing loaders/actions.
- No new `packages/contracts`, Hono route, domain rule, or DB access is needed for this implementation pass.
- Header-level Start/Stop use existing execution contracts. Pause remains disabled with a clear reason because no frontend `ExecutionActionInput` pause contract exists yet.
- Unsupported overview aggregate View all/Refresh controls are removed instead of adding speculative backend contracts.
- T021-T024 are not applicable because no retained primary action required a new server mutation.

## Validation Evidence

- Focused tests passed: `bunx vitest run apps/web/src/components/tasks/plan/task-plan-graph.test.tsx apps/web/src/components/tasks/workspace/model/task-workspace-actions.test.ts apps/web/src/components/tasks/workspace/model/task-workspace-query.test.ts apps/web/src/components/tasks/workspace/execution/task-workspace-execution-overview.test.tsx apps/web/src/components/tasks/workspace/execution/task-workspace-node-detail-panel.test.tsx apps/web/src/components/tasks/workspace/page/task-workspace-page.test.tsx`.
- Result: 6 files passed, 47 tests passed.
- Shared helper tests cover default action selection, required-field disabled reasons, dispatch guard copy, approval mapping, and manual completion mapping.
- Workspace page/query/overview/node-detail tests cover restored Start/Pause/Stop visibility and disabled reasons, plan Generate/Regenerate in the plan component, removed Refresh, node action dispatch, and result copy feedback.
- Correction focused tests passed after restoring task controls: `bunx vitest run apps/web/src/components/tasks/workspace/model/task-workspace-query.test.ts apps/web/src/components/tasks/workspace/page/task-workspace-page.test.tsx`.
- Result: 2 files passed, 25 tests passed.
- Correction workspace focused tests passed: `bunx vitest run apps/web/src/components/tasks/workspace/model/task-workspace-actions.test.ts apps/web/src/components/tasks/workspace/model/task-workspace-query.test.ts apps/web/src/components/tasks/workspace/execution/task-workspace-node-detail-panel.test.tsx apps/web/src/components/tasks/workspace/page/task-workspace-page.test.tsx`.
- Result: 4 files passed, 32 tests passed.
- `bun run typecheck`: passed.
- `bun run lint`: passed with existing warning-only lint debt; 0 errors, 645 warnings before the task-control correction.
- `bun run test`: passed; 42 files, 228 tests.
- Quickstart manual validation reviewed by inventory and component tests: every listed visible control has a final decision, retained enabled controls have visible outcomes, unsupported controls are absent, required fields/dispatch guard block duplicate or incomplete node actions, empty/no-node/no-artifact/stale states avoid misleading action controls, and retained controls keep accessible names or non-interactive informational rendering.
