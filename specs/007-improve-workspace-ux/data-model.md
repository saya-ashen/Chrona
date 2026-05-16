# Data Model: Improve Workspace UX

This feature defines presentation entities over existing Chrona task workspace data. No new persisted data model is planned.

## Task

Represents the current unit of work shown in the workspace.

**Fields**:

- `id`: Existing task identifier.
- `workspaceId`: Existing workspace identifier used by localized task workspace routes.
- `title`: User-visible task name; must be dominant page context and safely wrap or truncate on mobile.
- `description`: Existing task detail; secondary to title, state, active node, and primary action.
- `status`: Existing task/workflow state such as idle, running, blocked, review-required, failed, or completed.
- `actions`: Existing task controls such as generate plan, accept plan, start, pause, stop, execute, or assistant-related actions.

**Validation rules**:

- Title and status must be visible in initial workspace context.
- Long title/description content must not create horizontal scroll at `390px`.
- Existing action availability and disabled states must not change.

## Plan Node

Represents a step within the task plan graph or plan list.

**Fields**:

- `id`: Existing node identifier.
- `label`: User-visible node name; must wrap/truncate safely.
- `status`: Existing visual/workflow status such as queued, running, completed, blocked, or approval-needed.
- `isActive`: Presentation derivation identifying the node users should focus on next.
- `summary`: Existing or derived short description shown in details/overview areas.

**Relationships**:

- Belongs to one Task plan.
- May connect to predecessor/successor nodes through existing graph relationships.
- May map to the primary next action when running, blocked, or review-required.

**Validation rules**:

- Active node must be visually distinct from queued and completed nodes.
- Blocked and approval-needed nodes must have distinct labels and urgency treatment.
- Missing active node must produce clear empty/idle guidance instead of ambiguous blank space.

## Workspace State

Represents the page-level condition a user perceives.

**Values**:

- `loading`: Workspace data pending; no error implication.
- `empty`: Task or plan content absent; explains what is missing and how to proceed.
- `error`: Content failed to load or workflow request failed; includes recovery cue.
- `idle`: Task available but no execution currently running.
- `running`: Execution active; current node and progress are prominent.
- `blocked`: Workflow requires unblock action or explanation.
- `review-required`: Human review/approval is needed.
- `completed`: Task is done; execution controls are no longer presented as the primary next step.

**Validation rules**:

- Each state must be distinguishable by label, visual treatment, and next-step guidance.
- State treatment must preserve existing Chrona terminology.
- State treatment must fit desktop, tablet, and mobile layouts.

## Primary Action

Represents the most important next user action for the current workspace state.

**Fields**:

- `id`: Existing action identifier or stable presentation key.
- `label`: Localized action label.
- `disabled`: Existing availability state.
- `reason`: Optional localized explanation when unavailable.
- `priority`: Presentation ranking; primary action must outrank secondary controls visually.

**Validation rules**:

- Primary action must be visible without excessive scrolling in normal desktop/tablet views and easy to find on mobile.
- Secondary actions must remain available but lower visual weight.
- Disabled state must not be hidden or presented as available.

## Browser Evidence

Represents required verification artifacts for this UX feature.

**Fields**:

- `route`: Target workspace route used for observation and verification.
- `snapshot`: `agent-browser snapshot -i` output before and after implementation.
- `screenshots`: Desktop `1440x900`, tablet `1024x768`, and mobile `390x844` image artifacts.
- `diagnostics`: Console, page error, and network request output where supported.
- `mobileOverflowResult`: Confirmation that `390px` viewport has no horizontal page scroll.

**Validation rules**:

- Before and after evidence must use the same representative route when feasible.
- Screenshots must be stored under `specs/007-improve-workspace-ux/` or documented if generated elsewhere.
- Broken network requests or console errors must be investigated before completion.
