# UI Contract: Task Workspace Component Parity

## Purpose

Define the user-visible contract for the redesigned Chrona task workspace. This is a UI/read-model contract, not a new API contract unless implementation discovers missing data.

## Required Regions

The task workspace must expose these component regions together for one task:

- Global navigation with Chrona identity, primary sections, active task section, notifications, and settings.
- Task header with breadcrumb, editable-title affordance, task status, step progress, percentage progress, and task-level actions.
- Execution controls for continuing, pausing, exporting report, and additional options when available.
- Execution flow map with nodes, connections, status legend, zoom controls, center/fit controls, and selected-node state.
- Node detail panel with selected node identity, status, step position, auto-refresh, result tab, evidence tab, action tab, and configuration tab.
- Right-side overview with latest result, attention-needed item, artifact summary, and execution activity timeline.

## Status Mapping Contract

Visible node and task states must cover these user meanings:

- Completed: work finished and result can be reviewed.
- Running: work is actively executing.
- Waiting: work has not started or is queued behind dependencies.
- Approval needed: human review or approval is required before continuing.
- Blocked: execution cannot continue without intervention.

Existing internal statuses may be mapped to these user meanings, but the mapping must be documented in tests or view-model fixtures.

## Header Contract

The header must provide:

- Breadcrumb to task execution context.
- Task title and title-edit affordance when allowed.
- Current execution status.
- Completed-step count and total-step count when known.
- Progress percentage when total steps are known.
- Continue, pause, export report, and more-actions affordances when relevant.
- Notification and member context in the top workspace area.

## Flow Contract

The flow map must provide:

- Node cards with step number, title, state, time/update label, artifact indicator, and required-action indicator.
- Directional or dependency connections between nodes.
- Distinct visible treatment for all user-facing states listed in the status mapping contract.
- Controls for zooming, centering/fitting, and expanding the map.
- A legend matching visible state meanings.
- Explicit empty and error states.

## Node Detail Contract

Selecting a flow node must update the node detail panel without page navigation. The panel must provide:

- Selected node title, status, and step position.
- Auto-refresh state or refresh affordance when live data may change.
- Result tab with summary and copy/full-result affordance when available.
- Evidence tab with supporting artifacts or references.
- Action tab with state-appropriate actions.
- Configuration tab with available node configuration details.
- Empty states for missing result, evidence, actions, or configuration.

## Right Overview Contract

The right overview must provide:

- Latest result card with update time and full-result affordance.
- Attention-needed card when any node is blocked or requires approval.
- Artifact summary with recent item names, type, size or comparable metadata, update time, and full-list affordance.
- Execution activity timeline with time, node context, status, and description.
- Refresh state and manual refresh affordance where data may be stale.

## Responsive Contract

Desktop layouts should show flow, node detail, and right overview together when space allows. Mobile or narrow layouts must keep all regions reachable without losing task context, using stacking, collapsible panels, or navigation within the workspace. The implementation must not hide critical actions permanently on narrow screens.

## Permission Contract

When the current user cannot perform an action, the workspace must either hide the action if it is irrelevant or show it disabled with a clear reason when discoverability matters. Permission limitations must not hide the state of the task, node, artifacts, or activity from users who can view the task.

## Data Contract Escalation Rule

Implementation should use existing loader/task data first. Add a shared contract or read API only if one of the required visible regions cannot be populated from existing task, plan, run, artifact, approval, or activity data. Any new contract must be narrowly scoped to the missing region and must replace obsolete data shaping rather than duplicate it.
