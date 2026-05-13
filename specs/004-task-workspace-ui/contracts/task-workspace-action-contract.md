# UI/API Contract: Task Workspace Actions

## Purpose

Define the behavior contract for every retained interactive control in the task workspace. This contract extends the previous component-level workspace contract by requiring real outcomes for controls and removal of components that have no current user value.

## Inventory Contract

Implementation must produce or encode an inventory covering every visible interactive component in the task workspace.

Each inventory item must record:

- User-visible label or accessible name.
- Workspace region where the control appears.
- Current behavior before the change.
- Final decision: keep working, wire to behavior, show disabled with reason, convert to informational content, or remove.
- Test evidence proving the final decision.

## Retained Action Contract

Every retained interactive control must define:

- What user action triggers it.
- When it is available.
- What reason is shown when it is visible but unavailable.
- What progress state is shown while the action runs.
- What visible state changes after success.
- What message and recovery path appears after failure.
- How duplicate conflicting submissions are prevented.
- Whether the workspace updates immediately, refreshes, or marks affected data stale.

## Removal Contract

Controls must be removed or converted to non-interactive content when they meet any of these conditions:

- They are decorative or placeholder-only.
- They duplicate another retained action without adding user value.
- They point to a future workflow that is not available in the current release.
- They cannot be supported by current task workspace data and no justified backend change is needed.
- They create confusion by appearing actionable without a meaningful outcome.

Removed controls must not leave layout gaps, unreachable content, or inconsistent desktop/mobile ordering.

## Disabled-State Contract

A visible disabled control is allowed only when discoverability matters for a current workflow.

Disabled controls must communicate at least one of:

- Required task state.
- Required selected node or artifact.
- Required permission.
- Required data availability.
- Temporary in-progress state.

Disabled controls must remain keyboard and screen-reader understandable according to existing product accessibility patterns.

## Backend Contract Escalation Rule

Use existing task workspace loaders and action paths first. Add a server-backed action only if a retained control requires a real state change or durable result that current contracts cannot provide.

When a backend action is required, it must define:

- Shared request and response validation contract.
- Permission and stale-state checks.
- Success result with enough data to update the workspace visibly.
- Failure result with user-readable error mapping.
- Tests for success, validation failure, permission failure, and stale or missing task state.

## Required Behavior Categories

The final task workspace must cover these behavior categories where the corresponding controls remain visible:

- Task-level execution actions such as continue, pause, refresh, export, or more options.
- Flow controls such as select node, zoom, fit, center, or expand.
- Node detail actions such as open result, copy result, inspect evidence, review required action, retry, or open configuration where available.
- Overview actions such as open latest result, jump to attention item, open artifact list, and refresh activity where available.
- Navigation or contextual controls such as breadcrumbs, tabs, and panel switches.

## Acceptance Contract

Release validation passes only when:

- No visible interactive control is a no-op.
- No placeholder button, inactive menu item, or decorative clickable element remains.
- Every retained action has success, failure, loading, and unavailable behavior where applicable.
- Removed controls are absent from automated queries and manual walkthroughs.
- Desktop and mobile layouts keep all retained actions reachable.
