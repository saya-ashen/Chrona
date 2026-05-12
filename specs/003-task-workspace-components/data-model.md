# Data Model: Task Workspace Component Parity

## Overview

This feature primarily defines a UI/read-model shape for the task workspace. It should derive from existing task execution data first and avoid new persistence unless implementation discovers a required visible field that existing data cannot supply.

## Entity: TaskWorkspaceComponentView

Represents the complete task workspace page state shown to a user.

### Fields

- `taskHeader`: `TaskHeaderView`, required
- `navigation`: `WorkspaceNavigationView`, required
- `executionFlow`: `ExecutionFlowView`, required
- `selectedNode`: `NodeDetailView | null`, optional when no node exists
- `overview`: `ExecutionOverviewView`, required
- `states`: collection of loading, empty, stale, permission, and error indicators

### Relationships

- Has one task header.
- Has one execution flow.
- Has zero or one selected node detail.
- Has one execution overview.

### Validation Rules

- Must expose enough state for every visible workspace region.
- Must not duplicate conflicting task status, node status, artifact, or activity values.
- Must support an empty task with no execution nodes.

## Entity: WorkspaceNavigationView

Represents global context required by the reference workspace.

### Fields

- `brandName`: display label
- `primarySections`: list of navigation entries such as overview, tasks, plan library, knowledge base, tools, and integrations
- `activeSection`: currently active entry
- `notificationCount`: optional unread count
- `settingsAvailable`: boolean
- `memberIdentity`: current member or project context label

### Validation Rules

- Must identify the task section as active while in the task workspace.
- Must preserve access to notifications and settings.

## Entity: TaskHeaderView

Represents breadcrumb, title, progress, and task-level actions.

### Fields

- `breadcrumb`: ordered context labels
- `title`: task title
- `canEditTitle`: boolean
- `status`: task execution status
- `completedSteps`: number
- `totalSteps`: number
- `progressPercent`: number from 0 to 100
- `actions`: list of available task-level actions: continue, pause, export report, more options
- `memberContext`: notification and active member display state

### Validation Rules

- `completedSteps` must not exceed `totalSteps`.
- `progressPercent` must match completed/total steps when total is known.
- Actions must reflect task state and permissions.

## Entity: ExecutionFlowView

Represents visual task execution graph state.

### Fields

- `nodes`: list of `ExecutionNodeView`
- `connections`: list of dependencies or ordered links between nodes
- `selectedNodeId`: optional selected node identifier
- `legend`: all visible status meanings
- `controls`: zoom, center, fit, and expand availability

### Validation Rules

- Every connection must reference known nodes.
- Visible node statuses must be represented in the legend.
- Empty node lists must produce an explicit empty state.

## Entity: ExecutionNodeView

Represents one execution step in the flow map.

### Fields

- `id`: stable identifier
- `stepNumber`: numeric order label
- `title`: node title
- `status`: completed, running, waiting, approval-needed, blocked, or equivalent existing Chrona status
- `timestampLabel`: last meaningful time or update label
- `hasArtifacts`: boolean
- `artifactCount`: optional count
- `requiresHumanAction`: boolean
- `dependencyIds`: optional upstream node identifiers

### Validation Rules

- Must have a title, step number, and state label.
- Required-action nodes must be visible in both flow and overview attention state.
- Artifact flags must match the artifact list for the node when available.

## Entity: NodeDetailView

Represents the lower current-node panel.

### Fields

- `nodeId`: selected node identifier
- `title`: selected node title
- `status`: selected node status
- `stepPosition`: completed/total or current/total label
- `autoRefreshEnabled`: boolean
- `tabs`: result, evidence, action, configuration
- `result`: `ResultSummaryView | null`
- `evidence`: list of `EvidenceItemView`
- `actions`: state-appropriate node actions
- `configurationSummary`: optional node configuration details

### Validation Rules

- Must update when selection changes.
- Must show explicit no-result and no-evidence states.
- Node actions must be disabled or hidden according to permission and status rules.

## Entity: ResultSummaryView

Represents latest or selected-node result content.

### Fields

- `title`: result label
- `summary`: concise human-readable result body
- `primaryFindings`: optional list of conclusions
- `updatedAtLabel`: optional update time
- `canCopy`: boolean
- `canOpenFullResult`: boolean

### Validation Rules

- Must distinguish missing result from loading result.
- Must not imply completion when source node is still running unless explicitly marked as partial.

## Entity: EvidenceItemView

Represents a supporting source or file.

### Fields

- `id`: stable identifier where available
- `name`: display name
- `type`: file/source type label
- `sizeLabel`: optional size label
- `updatedAtLabel`: optional update time
- `sourceNodeId`: optional related node
- `openAction`: optional action to inspect item

### Validation Rules

- Must include enough metadata for users to identify the evidence source.
- Must show no-artifact state when empty.

## Entity: ExecutionOverviewView

Represents the right-side workspace summary.

### Fields

- `latestResult`: `ResultSummaryView | null`
- `attention`: `AttentionItemView | null`
- `artifacts`: recent `EvidenceItemView` or artifact list
- `activity`: list of `ActivityEventView`
- `refreshState`: current freshness and manual refresh availability

### Validation Rules

- Required attention must appear when any visible node requires handling.
- Artifact summary must expose a path to full artifacts when more items exist.
- Activity events must be chronological and concise.

## Entity: AttentionItemView

Represents a blocking or approval-needed item.

### Fields

- `nodeId`: related node
- `nodeTitle`: related node title
- `reason`: why action is needed
- `status`: attention state such as pending approval or blocked
- `actions`: available resolution actions such as review, approve, supplement information, or retry

### Validation Rules

- Must identify the affected node.
- Must offer at least one next step when the user has permission.

## Entity: ActivityEventView

Represents an execution timeline entry.

### Fields

- `id`: stable identifier where available
- `timeLabel`: event time
- `nodeId`: optional related node
- `title`: event label
- `status`: event status label
- `description`: concise event details

### Validation Rules

- Must be ordered newest-first or oldest-first consistently within the timeline.
- Must identify node context when available.

## State Transitions

- Task status: waiting -> running -> completed, or running -> paused/blocked/approval-needed -> running/completed.
- Node status: waiting -> running -> completed, or running -> approval-needed/blocked -> running/completed.
- Selection: no node -> selected node; selected node -> another selected node; selected node -> no node when flow becomes empty.
- Overview freshness: current -> stale -> refreshing -> current, or refreshing -> error with retry option.

## No New Persistence By Default

Implementation should not introduce a new persisted model for this feature unless existing task workspace data cannot satisfy a required visible component. If that occurs, the implementation plan must add the smallest read model or contract that serves the missing component and remove obsolete data-shaping paths rather than keeping both patterns.
