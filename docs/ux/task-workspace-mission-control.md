# Task Workspace Mission Control UX Spec

## Purpose

Turn the task workspace from a mixed plan/editor/log page into a mission-control surface for one task. A user should always answer five questions without reading raw logs:

1. What state is this task in?
2. What is Chrona doing now?
3. What step or approval is blocking progress?
4. What is the safest next action?
5. What result, evidence, or artifact exists?

## Current code anchors

| Area | Current anchor |
| --- | --- |
| Page composition | `features/task-workspace/ui/task-workspace-page.tsx` and `apps/web/src/components/tasks/workspace/sections/task-workspace-plan-section.tsx` |
| Workspace display model | `features/task-workspace/model/task-workspace-interaction.ts` |
| Operation state machine | `features/task-workspace/model/task-workspace-operation-machine.ts` |
| Workspace event transport | `POST /api/work/:taskId/commands`, `GET /api/work/:taskId/events` in `apps/server/src/routes/pages/work.routes.ts` |
| Execution actions | `packages/engine/src/modules/plan-execution/task-plan-execution.ts` |
| User-facing task state | `packages/domain/src/task/derive-task-state.ts`, `packages/domain/src/task/derive-task-execution-state.ts` |
| Header / sidebar state | `packages/engine/src/modules/tasks/get-task-header.ts`, `packages/ui-protocol/src/builders/build-task-header-spec.ts`, `apps/web/src/components/tasks/workspace/adapters/task-ai-sidebar-adapter.ts` |
| Execution overview / result / trail | `features/execution-monitoring/ui/task-workspace-execution-overview.tsx`, `features/execution-monitoring/ui/build-execution-overview-spec.ts` |

## Mission-control information hierarchy

### 1. Header: task identity and one-line mission status

Header owns identity, not detailed operations.

Required content:

- task title and description summary;
- user-facing status label;
- one next-action sentence;
- primary action when available;
- current automation mode: manual, scheduled, auto-plan, auto-execute;
- stale/offline indicator when projections are behind.

Rules:

- `Completed` is not final acceptance. Label it as `Result ready` until the result is accepted.
- `Done` is accepted/closed. Label it as `Task done`.
- `WaitingForInput` and `WaitingForApproval` stay separate in copy and actions.
- Header copy must match Action Center, Schedule, Dashboard, and assistant sidebar for the same task facts.

### 2. Stage rail: lifecycle map

Show a compact five-stage lifecycle:

```text
Brief -> Plan -> Review -> Run -> Result
```

Each stage needs one of four visual states:

- `done`: stage completed;
- `current`: user attention or Chrona activity is here;
- `blocked`: progress stopped here;
- `upcoming`: future stage.

Stage labels should be product words, not raw enums. Internal states map into these stages:

| Internal condition | Stage | Product label | Primary next action |
| --- | --- | --- | --- |
| No plan | Brief | Needs plan | Generate plan |
| Plan generation running | Plan | Planning | Wait or stop generation |
| Draft plan exists | Review | Plan ready | Review and accept plan |
| Accepted plan, no run | Run | Ready to run | Start execution |
| Running or queued | Run | Running | Monitor current step |
| WaitingForInput | Run | Input needed | Provide input |
| WaitingForApproval | Run | Approval needed | Approve, reject, or request changes |
| Blocked | Run | Blocked | Resolve blocker |
| Failed | Run | Failed | Retry or stop |
| Cancelled | Run | Cancelled | Reopen or inspect audit |
| Completed run | Result | Result ready | Accept result or request changes |
| Done task | Result | Task done | Ask follow-up or create next task |

### 3. Current operation card: the main control surface

This is the primary working area. It must never be empty when the task needs action.

Required content:

- operation title;
- why this is happening;
- current node label, if execution-scoped;
- primary action;
- secondary actions;
- disabled reason when primary action cannot be used;
- risk/scope note for approval and destructive actions.

Operation states should be derived from the operation machine rather than JSX branches:

| Operation status | Required UI |
| --- | --- |
| `plan-empty` | generate-plan action and plan requirements |
| `plan-generating` | generation progress, provider/status message, stop action |
| `plan-review` | summary, diff/review affordance, accept/regenerate actions |
| `plan-ready-to-run` | run contract preview, start action, automation timing |
| `execution-running` | active node, latest runtime event, cancel/pause when supported |
| `execution-action` | checkpoint/input/approval action form |
| `execution-blocked` | failure/block reason, affected node, retry/stop/resume action |
| `execution-completed` | result review actions only |
| `task-action` | task lifecycle action with reason |

### 4. Run contract preview

Before execution starts, show a contract preview that answers:

- which plan will run;
- which runtime/provider will execute it;
- which nodes may require input or approval;
- which tool families or capabilities may be used;
- whether auto-execute will start at schedule time;
- what can be cancelled or retried.

This must appear in `plan-ready-to-run` and schedule/auto-execute contexts. It should use normalized capability and execution facts, not provider-specific text.

### 5. Execution graph and current step

The graph should support orientation, not compete with the current action card.

Rules:

- default to current node focused;
- show counts for pending/running/waiting/blocked/completed;
- clicking a node opens details, but current operation remains visible;
- node details must show status reason, latest attempt, output/evidence, and next possible actions;
- graph status colors come from the same derived state model as header and operation card.

### 6. Result review

Result review is a distinct layout after a run completes.

Required content:

- result status: ready, accepted, rejected, change requested;
- primary output/spec;
- artifacts list;
- audit summary;
- run/session metadata;
- actions: accept result, request changes, create follow-up task, ask follow-up.

Rules:

- no full workbench by default in result-review mode;
- product-owned controls stay outside AI-authored result surfaces;
- invalid json-render specs must fall back to safe text/markdown and keep controls visible;
- accepting result closes `Completed` into `Done`.

### 7. Activity and evidence trail

Raw event streams are not the main UX. They should be grouped into evidence sections:

1. Plan generation events.
2. Run/session lifecycle.
3. Node attempts.
4. Provider/tool activity.
5. Approvals and user decisions.
6. Artifacts/results.
7. Failures/cancellations/retries.

Default view should summarize by phase and expose raw detail on demand.

## State consistency contract

Chrona should expose one derived workspace state object consumed by:

- task workspace header;
- stage rail;
- current operation card;
- graph node tone;
- assistant sidebar `NEXT` line;
- Action Center item;
- Dashboard attention card;
- Schedule work-block card.

Minimum fields:

```ts
type WorkStateView = {
  taskId: string;
  state:
    | "no_plan"
    | "planning"
    | "plan_review"
    | "ready_to_run"
    | "queued"
    | "running"
    | "waiting_for_input"
    | "waiting_for_approval"
    | "blocked"
    | "failed"
    | "cancelled"
    | "result_ready"
    | "done";
  stage: "brief" | "plan" | "review" | "run" | "result";
  label: string;
  tone: "neutral" | "info" | "success" | "warning" | "danger";
  nextActionLabel: string;
  primaryActionId: string | null;
  primaryActionDisabledReason: string | null;
  currentNodeId: string | null;
  blocker: {
    kind: string;
    reason: string;
    scope: "task" | "run" | "plan_node" | "runtime";
  } | null;
};
```

The existing `TaskWorkspaceDisplayState` can evolve into this contract, but the contract must be page-independent.

## Empty, loading, and stale states

Every major panel needs explicit states:

- loading projection;
- no plan yet;
- generation connecting;
- generation failed;
- no accepted plan;
- execution stale/recovering;
- provider unavailable;
- result unavailable;
- artifact list empty.

Never show a disabled primary action without a visible reason.

## Responsive behavior

Validated targets:

- desktop: `1440x900`;
- tablet: `1024x768`;
- mobile: `390x844`.

Rules:

- no horizontal scroll on mobile;
- header, current operation, and primary action appear before graph/log details;
- stage rail compresses to horizontal scroll-free chips or a stacked summary;
- graph/details collapse behind current operation on mobile;
- result review keeps primary result and accept/request-change controls above activity trail.

## Acceptance criteria

- Same task facts produce same label, tone, and primary action across workspace header, assistant sidebar, Dashboard, Schedule, and Action Center.
- Golden states are covered: no plan, plan generating, plan review, ready to run, running, waiting for input, waiting for approval, blocked, failed, cancelled, result ready, done.
- Run contract preview appears before manual or scheduled execution starts.
- Waiting-for-input and waiting-for-approval copy/action forms are distinct.
- Failure and blocked states show a human-readable reason and retry/stop/resume choice.
- Result-ready state shows output, artifacts/audit summary when present, and accept/request-change actions.
- Mobile `390x844` has no horizontal overflow.

## Test requirements

- Table-driven tests for `WorkStateView` derivation.
- Component tests for each golden state using user-visible labels, roles, primary actions, and disabled reasons.
- SSE/workspace command tests for state update handling.
- E2E golden path:
  1. create task;
  2. generate plan;
  3. review run contract;
  4. start execution;
  5. observe current step and next step;
  6. hit approval/input wait;
  7. approve or provide input;
  8. inspect completed result/artifacts/audit;
  9. accept result.
