# Data Model: Plan Execution Orchestration

## Purpose

This document maps the current Chrona brownfield data model to the target execution-layer entities in the feature spec. It distinguishes what already exists from what is still conceptual.

## Current Persisted Entities

### Workspace

- **Source**: `prisma/schema.prisma`
- **Fields**: `id`, `name`, `description`, `defaultRuntime`, `status`, timestamps
- **Relationships**: owns `Task`, `Approval`, `Artifact`, `Memory`, `Event`, `TaskDependency`, `TaskProjection`, `ScheduleProposal`
- **Validation rules**: runtime default is required; status is constrained by `WorkspaceStatus`

### Task

- **Source**: `prisma/schema.prisma`
- **Fields**: title/description, runtime adapter and config fields, prompt, status, priority, owner/assignee, parent task, due date, scheduled window, schedule status/source, block reason, default session, latest run, timestamps
- **Relationships**: belongs to `Workspace`; has many `Run`, `TaskSession`, `Approval`, `Artifact`, `Memory`, `Event`, `ScheduleProposal`, `TaskAssistantMessage`; may have one `TaskProjection`
- **Validation rules**:
  - status constrained by `TaskStatus`
  - priority constrained by `TaskPriority`
  - schedule state constrained by `ScheduleStatus` and `ScheduleSource`
- **Current role in product flow**: primary aggregate for task creation, scheduling metadata, and top-level execution status

### TaskSession

- **Source**: `prisma/schema.prisma`
- **Fields**: `runtimeName`, `sessionKey`, `label`, `status`, `lastRunStatus`, `activeRunId`, `lastRunRef`, `createdByFramework`, timestamps
- **Relationships**: belongs to `Task`; has many `Run`
- **Validation rules**: `sessionKey` is unique
- **Current role**: runtime continuity and session-key reuse, not yet a true execution-session/work-block aggregate

### Run

- **Source**: `prisma/schema.prisma`
- **Fields**: runtime identifiers, status, timestamps, error summary, resume token, trigger source, retry/resume support, pending input details, sync health
- **Relationships**: belongs to `Task`; optionally belongs to `TaskSession`; has many `Approval`, `Artifact`, `Event`, `ConversationEntry`, `ToolCallDetail`; has one `RuntimeCursor`
- **Validation rules**: `runtimeRunRef` is unique when present; status constrained by `RunStatus`
- **Current role**: provider-backed execution attempt or child execution for plan nodes

### Approval

- **Source**: `prisma/schema.prisma`
- **Fields**: `type`, `title`, `summary`, `riskLevel`, `payload`, `status`, request/resolution metadata
- **Relationships**: belongs to `Workspace`, `Task`, and `Run`
- **Validation rules**: status constrained by `ApprovalStatus`
- **Current role**: runtime-oriented approval workflow that partially overlaps with the target product review model

### Artifact

- **Source**: `prisma/schema.prisma`
- **Fields**: `type`, `title`, `uri`, `contentPreview`, `metadata`, timestamp
- **Relationships**: belongs to `Workspace`, `Task`, and `Run`
- **Validation rules**: type constrained by `ArtifactType`
- **Current role**: execution outputs and evidence for completed work

### Memory

- **Source**: `prisma/schema.prisma`
- **Fields**: `content`, `scope`, `sourceType`, `confidence`, `status`, expiry, timestamps
- **Relationships**: belongs to `Workspace`; may belong to `Task`
- **Validation rules**: scope/status/source type constrained by enums
- **Current role**: general memory store plus overloaded storage for `task_plan_graph_v1` accepted/draft plan graphs

### Event

- **Source**: `prisma/schema.prisma`
- **Fields**: event metadata, payload, dedupe key, ingest sequence, runtime timestamp, created timestamp
- **Relationships**: belongs to `Workspace`, `Task`, and optionally `Run`
- **Validation rules**: `dedupeKey` is unique
- **Current role**: canonical append-only timeline for task and execution activity

### TaskProjection

- **Source**: `prisma/schema.prisma`
- **Fields**: persisted status, display state, block metadata, latest run status, approval counts, schedule fields, latest artifact info, last activity, timestamp
- **Relationships**: belongs to `Workspace` and `Task`
- **Current role**: read model for task list, schedule page, and workbench surfaces

### ScheduleProposal

- **Source**: `prisma/schema.prisma`
- **Fields**: source, status, proposedBy, summary, due date, scheduled window, assignee, timestamps, resolution note
- **Relationships**: belongs to `Workspace` and `Task`
- **Validation rules**: status constrained by `ScheduleProposalStatus`
- **Current role**: scheduling suggestion workflow; still task-centric rather than work-block-centric

### RuntimeCursor

- **Source**: `prisma/schema.prisma`
- **Fields**: `runtimeName`, `nextCursor`, `lastEventRef`, `lastSyncedAt`, `healthStatus`, `lastError`
- **Relationships**: belongs to `Run`
- **Current role**: provider sync continuity

### TaskAssistantMessage

- **Source**: `prisma/schema.prisma`
- **Fields**: `role`, `content`, `proposal`, `applied`, `appliedAt`, `sequence`, timestamp
- **Relationships**: belongs to `Task`
- **Current role**: task workspace conversational editing and assistant proposal history

## Current Plan Graph Model

### TaskPlanGraph

- **Source**: `packages/contracts/src/ai.ts` and `packages/runtime/src/modules/tasks/task-plan-graph-store.ts`
- **Persisted as**: `Memory.content` with a `task_plan_graph_v1` JSON payload
- **Fields**: `id`, `taskId`, `status`, `revision`, `source`, `generatedBy`, `prompt`, `summary`, `changeSummary`, timestamps, `nodes`, `edges`
- **Relationships**: belongs logically to `Task`; used by plans routes, materialization, and plan execution
- **Validation rules**:
  - graph payload must parse as `task_plan_graph_v1`
  - nodes normalize to supported types and statuses
  - edges must reference valid node ids when edited through the API

### TaskPlanNode

- **Source**: `packages/contracts/src/ai.ts` plus runtime normalization in `task-plan-graph-store.ts`
- **Fields**: `id`, `type`, `title`, `objective`, `description`, `status`, `phase`, `estimatedMinutes`, `priority`, `executionMode`, `requiresHumanInput`, `requiresHumanApproval`, `autoRunnable`, `blockingReason`, `linkedTaskId`, `completionSummary`, `metadata`
- **Current statuses**: `pending`, `in_progress`, `waiting_for_child`, `waiting_for_user`, `waiting_for_approval`, `blocked`, `done`, `skipped`
- **Current role**: execution unit inside accepted-plan orchestration

### TaskPlanEdge

- **Source**: `packages/contracts/src/ai.ts` and `task-plan-graph-store.ts`
- **Fields**: `id`, `fromNodeId`, `toNodeId`, `type`, `metadata`
- **Current role**: dependency and ordering model for plan execution

## Target Spec Entities And Brownfield Mapping

### Task

- **Spec meaning**: user-defined work item
- **Brownfield mapping**: already first-class in Prisma and route/runtime flows
- **Gap**: task currently carries both scheduling and some execution concerns that should be shared with `WorkBlock` and `ExecutionSession`

### Plan

- **Spec meaning**: structured sequence of steps that becomes the source for scheduling and execution decisions
- **Brownfield mapping**: `TaskPlanGraph` stored in `Memory`
- **Gap**: not first-class in Prisma; storage and lifecycle are coupled to generic memory infrastructure

### Plan Step

- **Spec meaning**: actionable unit with execution type, dependencies, required information, status, output, and next action
- **Brownfield mapping**: `TaskPlanNode`
- **Gap**: required-information semantics, review outcomes, and provider capability metadata are not yet modeled as clean product-level contracts

### Work Block

- **Spec meaning**: calendar entry explicitly marked as actionable work and linked to a task and plan
- **Brownfield mapping**: task schedule fields plus `ScheduleProposal`
- **Gap**: no first-class persisted work-block entity; no separation from general calendar concepts; no explicit trigger lifecycle

### Execution Session

- **Spec meaning**: resumable attempt to advance one or more steps during a work block or manual execution session
- **Brownfield mapping**: distributed across `Task`, `TaskSession`, `Run`, accepted plan node state, `RuntimeCursor`, and task projection rebuilds
- **Gap**: no single aggregate for start cause, current node, pause reason, linked work block, and continuation state

### Execution Result

- **Spec meaning**: artifact, summary, or output produced by a step and subject to review when needed
- **Brownfield mapping**: `Artifact`, node `completionSummary`, `Approval`, and task result acceptance routes
- **Gap**: review outcomes are not yet standardized around plan-step final outputs

## Key Relationships

1. A `Workspace` owns many `Task` records.
2. A `Task` owns the current accepted/draft `TaskPlanGraph` indirectly through `Memory`.
3. A `TaskPlanGraph` owns many `TaskPlanNode` and `TaskPlanEdge` records inside one serialized payload.
4. A `Task` owns many `Run` and `TaskSession` records.
5. A `Run` owns many `Approval`, `Artifact`, `ConversationEntry`, and `ToolCallDetail` records.
6. A `TaskProjection` summarizes task, schedule, and execution state for UI reads.
7. A `ScheduleProposal` proposes task-level scheduling windows but does not yet create a first-class work-block entity.

## State Transitions To Preserve

### Task Status

- **Source enum**: `Draft`, `Ready`, `Queued`, `Running`, `WaitingForInput`, `WaitingForApproval`, `Scheduled`, `Blocked`, `Failed`, `Completed`, `Done`, `Cancelled`
- **Design note**: future execution-layer work should preserve compatibility with these task-level statuses while introducing clearer work-block and execution-session semantics underneath them.

### Schedule Status

- **Source enum**: `Unscheduled`, `Scheduled`, `InProgress`, `AtRisk`, `Interrupted`, `Overdue`, `Completed`
- **Design note**: these are currently task-level scheduling states, not work-block states.

### Run Status

- **Source enum**: `Pending`, `Running`, `WaitingForInput`, `WaitingForApproval`, `Failed`, `Completed`, `Cancelled`
- **Design note**: future execution-session modeling should distinguish provider-run state from product execution-session state.

### Plan Node Status

- **Runtime statuses observed**: `pending`, `in_progress`, `waiting_for_child`, `waiting_for_user`, `waiting_for_approval`, `blocked`, `done`, `skipped`
- **Design note**: these are the closest current-state representation of step execution state and should anchor future step-state migration.

## Recommended Model Changes For Future Implementation

1. Introduce a first-class `WorkBlock` model instead of encoding actionable schedule windows directly on `Task`.
2. Introduce a first-class `ExecutionSession` model that links task, accepted plan, optional work block, current step, pause reason, and resumability metadata.
3. Either promote `TaskPlanGraph` to first-class plan persistence or formalize the current graph store as an explicit subsystem with migration/versioning rules.
4. Separate runtime approval records from product-level review of final step results.
5. Normalize provider capability and backend availability onto step/session contracts rather than exposing provider-specific assumptions in route/runtime code.
