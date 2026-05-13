# Data Model: Task Workspace UI Functionality

## Overview

This feature primarily defines an interaction and read-model shape for the existing task workspace. It should derive from current task workspace data first and add persistence only when a retained visible action requires durable state that does not exist today.

## Entity: WorkspaceActionInventory

Represents the implementation audit of visible interactive task workspace components.

### Fields

- `items`: list of `WorkspaceComponentInventoryItem`, required
- `lastAuditedAt`: timestamp or review label for the inventory
- `coverageStatus`: complete, partial, or blocked

### Relationships

- Contains many component inventory items.
- Maps to the task workspace page and supporting component regions.

### Validation Rules

- Must include every visible interactive component in the task workspace.
- Every item must have a decision: retain and wire, retain as disabled with reason, convert to informational content, or remove.
- No item may remain classified as unknown at implementation completion.

## Entity: WorkspaceComponentInventoryItem

Represents one visible control or interactive component discovered during the audit.

### Fields

- `id`: stable audit identifier
- `label`: user-visible label or accessible name
- `region`: header, flow, node detail, overview, navigation, menu, tab, or empty-state area
- `componentOwner`: source component or workspace area responsible for rendering it
- `currentBehavior`: working, no-op, placeholder, navigation-only, disabled, misleading, or unknown
- `decision`: wire, disable-with-reason, convert-to-info, remove, or keep-working
- `targetActionId`: related `WorkspaceActionContract` when retained as interactive
- `notes`: implementation or UX notes

### Validation Rules

- Interactive retained items must reference a workspace action contract.
- Removed items must have a reason tied to lack of current user value or duplicate functionality.
- Disabled items must include a user-facing reason when discoverability matters.

## Entity: WorkspaceActionContract

Represents the user-visible behavior contract for one retained workspace action.

### Fields

- `id`: stable action identifier
- `trigger`: the control or event that starts the action
- `availableWhen`: task, permission, or data conditions that allow the action
- `disabledReason`: message or reason when visible but unavailable
- `inProgressState`: feedback shown while action is running
- `successOutcome`: visible result after success
- `failureOutcome`: error message and recovery path after failure
- `freshnessBehavior`: whether workspace data updates immediately, refreshes, or is marked stale
- `duplicateSubmissionPolicy`: how repeated triggers are prevented or handled

### Relationships

- Belongs to one or more inventory items when the same action is exposed in multiple places.
- May require existing task data or a backend mutation contract.

### Validation Rules

- Must define success and failure outcomes for every retained action.
- Must prevent duplicate conflicting submissions.
- Must preserve current user context after failures.
- Must not grant behavior beyond existing user permissions.

## Entity: TaskWorkspaceState

Represents the page state needed to render retained controls correctly.

### Fields

- `task`: current task context
- `selectedNode`: currently selected execution node, optional
- `permissions`: user-visible action permissions
- `loadingState`: initial, loading, refreshing, idle, or error
- `emptyState`: no task, no nodes, no artifacts, no activity, or none
- `pendingActions`: set of running workspace action identifiers
- `lastActionResult`: latest success or failure feedback

### Relationships

- Supplies availability rules for workspace action contracts.
- Drives loading, empty, success, and error feedback for workspace regions.

### Validation Rules

- Pending actions must disable or guard conflicting controls.
- Empty states must hide or disable data-dependent controls.
- Error states must expose recovery where recovery is possible.

## Entity: BackendActionContract

Represents a server-backed operation only when a retained UI action requires one.

### Fields

- `name`: action contract name
- `input`: validated user and task data required to perform the action
- `output`: updated workspace state, action result, or error details
- `permissionRule`: required task or workspace permission
- `sideEffects`: task state, node state, artifact, activity, or audit updates
- `failureModes`: validation error, permission error, stale state, not found, or execution failure

### Relationships

- Supports one or more workspace action contracts.
- Uses shared validation contracts when exposed across frontend/server boundaries.
- Persists through existing task workspace data stores when state changes are required.

### Validation Rules

- Must be added only when existing contracts cannot perform the retained UI action.
- Must validate input and permission before side effects.
- Must return enough information for the workspace to show success, failure, and refreshed state.

## State Transitions

- Inventory item: unknown -> classified -> wired/disabled/converted/removed -> verified.
- Action: idle -> in-progress -> success -> refreshed/idle.
- Action failure: idle -> in-progress -> failure -> retryable idle or unavailable disabled state.
- Workspace data: current -> stale -> refreshing -> current, or refreshing -> error with retry option.
- Control availability: hidden/removed, visible-disabled, visible-enabled, or visible-in-progress.

## Persistence Rule

No new persisted model is planned by default. If implementation finds a retained action requires durable state not available in current task, plan, run, artifact, approval, or activity records, add the smallest backend action contract and persistence change needed for that action and remove any obsolete local placeholder state it replaces.
