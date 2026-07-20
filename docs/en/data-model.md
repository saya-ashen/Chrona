# Data Model

Chrona persists goal, task, schedule, execution, memory, and AI-client state in SQLite through Prisma 7.

Schema source: `prisma/schema.prisma`.

Current schema inventory:

- Models: 41
- Enums: 27

## Main aggregates

| Aggregate | Key models | Purpose |
| --- | --- | --- |
| Workspace | `Workspace` | Scope for tasks, memory, schedule, calendar sources, and configuration. |
| Goal | `Goal`, `GoalAsset` | Durable outcome lifecycle, validated criteria, bounded-task ownership, and immutable artifact promotion. |
| Task | `Task`, `TaskDependency`, `TaskProjection`, `TaskSession`, `TaskTimelineItem` | Core work item, relationships, projection-backed read shape, scoped work sessions, and timeline rows. |
| Plan | `TaskPlan`, `TaskPlanLayer`, `GraphVersion`, `GraphMutationRecord`, `ReconciliationEvent`, `TaskPlanNodeAttempt`, `TaskPlanTerminalAction` | Generated/accepted executable graph plan, node-attempt history, terminal actions, and graph-change history. |
| Execution | `TaskPlanRun`, `Run`, `ExecutionSession`, `RuntimeCursor`, `Approval`, `Artifact`, `TaskPlanProviderRun`, `TaskPlanProviderApproval`, `RunToken` | Plan/run/session state, runtime cursoring, provider continuity, approvals, tokens, and outputs. |
| Schedule | `WorkBlock`, `ScheduleProposal`, `SchedulerLease`, `SchedulerEvent` | Time blocks, schedule suggestions, automation leasing, and scheduler events. |
| External calendar | `CalendarSource`, `ImportedCalendarEvent` | Read-only calendar subscriptions, sync status, imported busy events, and calendar-backed schedule context. |
| Conversation/tool history | `ConversationEntry`, `ToolCallDetail`, `ToolInvocation`, `TaskAssistantMessage`, `TaskResultContinuation`, `RawEventLog` | User/assistant conversation, accepted-result continuation and idempotency state, runtime tool-call detail, invocation records, and raw event audit data. |
| Memory | `Memory` | Workspace/task memory entries used by internal projections and AI context-building flows. |
| AI configuration | `AiClient`, `AiFeatureBinding` | Database-backed AI clients and feature-to-client bindings. |
| Event log | `Event` | Durable event records used by projections/integration flows. |

## Entity relationship overview

```mermaid
erDiagram
  Workspace ||--o{ Task : contains
  Workspace ||--o{ Goal : owns
  Goal ||--o{ Task : advances_through
  Goal ||--o{ GoalAsset : works_with
  Artifact ||--o{ GoalAsset : promoted_as
  Workspace ||--o{ Memory : owns
  Workspace ||--o{ AiClient : configures
  Workspace ||--o{ WorkBlock : schedules

  Task ||--o{ TaskDependency : source
  Task ||--o{ TaskProjection : projects
  Task ||--o{ TaskPlan : has
  Task ||--o{ WorkBlock : scheduled_as
  Task ||--o{ ConversationEntry : records
  Task ||--o{ ToolCallDetail : records
  Task ||--o{ TaskAssistantMessage : discusses

  TaskPlan ||--o{ TaskPlanLayer : layers
  TaskPlan ||--o{ TaskPlanRun : runs
  TaskPlanLayer ||--o{ GraphVersion : versions
  TaskPlanLayer ||--o{ GraphMutationRecord : mutations

  WorkBlock ||--o{ TaskPlanRun : occurrence_runs
  WorkBlock ||--o{ ExecutionSession : occurrence_sessions
  WorkBlock ||--o{ Run : occurrence_provider_runs
  Run ||--o{ Approval : approvals
  Run ||--o{ Artifact : artifacts

  AiClient ||--o{ AiFeatureBinding : bound_to
  WorkBlock ||--o{ ScheduleProposal : proposal_source
  Workspace ||--o{ CalendarSource : subscribes
  CalendarSource ||--o{ ImportedCalendarEvent : imports
```

## Goal foundation and remaining target

The current schema ships `Goal`, optional `Task.goalId`, and read-only
`GoalAsset`. Goal lifecycle is `Draft | Active | Paused | Achieved | Stopped`.
Achievement requires explicit user confirmation and persists the confirmation
note, actor identity, timestamp, and Goal-owned evidence Artifact IDs in
`Goal.achievementConfirmation`; a canonical `goal.achieved` event provides the
audit record. `GoalAsset` records source and current Artifact references without
mutating source execution evidence. Accepted Task results remain immutable and
separate from these Goal-scoped references.

The remaining accepted model adds `TaskTrigger`, `TriggerDelivery`, and a
neutral `TaskOccurrence`. The complete target model and phased migration are
specified in [Long-Horizon Goals and Triggers](./long-horizon-goals-and-triggers.md).
Do not infer that trigger or neutral-occurrence APIs exist until their phase
ships.

## Task state

Important enums:

- `TaskStatus`
- `TaskPriority`
- `TaskDependencyType`

Tasks are the canonical work records. `TaskProjection` stores read-optimized task state used by app surfaces after create/update/lifecycle/result changes.

`TaskStatus.Completed` and `TaskStatus.Done` are both terminal, but they are not interchangeable today:

- `Completed` means Chrona/runtime execution reached a completed state, including imported calendar tasks auto-completed by sync policy.
- `Done` means the user explicitly accepted or closed the task outcome after completion; derivation keeps `Done` stable and does not downgrade it to runtime-derived `Completed`.

New code should use `Completed` for runtime/import completion and reserve `Done` for explicit user closure until the enum is consolidated.

Typical lifecycle actions:

- create
- update
- complete
- reopen
- delete
- attach result
- schedule through work blocks
- generate/accept/execute plan

## Plan and graph state

Important models:

- `TaskPlan`
- `TaskPlanLayer`
- `GraphVersion`
- `GraphMutationRecord`
- `ReconciliationEvent`

Important enum:

- `TaskPlanStatus`
- `GraphMutationStatus`

A generated plan blueprint becomes executable only after acceptance/materialization. Layers hold graph snapshots and execution context. Graph mutation/reconciliation records support plan evolution and traceability.

## Execution state

Important models:

- `TaskPlanRun`
- `Run`
- `ExecutionSession`
- `RuntimeCursor`
- `Approval`
- `Artifact`

Important enums:

- `RunStatus`
- `ExecutionSessionStatus`
- `ApprovalStatus`
- `ArtifactType`

Execution records distinguish Chrona plan-run state from external runtime/provider runs. `ExecutionSession` is the server-side scope for AI-visible refs. `RuntimeCursor` tracks provider stream/progress cursoring. Approvals and artifacts store intervention and output records.

Execution is occurrence-scoped. A recurring `Task` shares one row across many
`WorkBlock` occurrences, so `TaskPlanRun`, `ExecutionSession`, and `Run` each
carry a `workBlockId` that pins them to a single occurrence. `Run` also stores
`errorSummary`, the authoritative provider failure cause surfaced to the read
model. The projection committer (`rebuildTaskProjection`) scopes its
runs/sessions/approvals to the occurrence that most recently executed, so a
failed or cancelled occurrence never contaminates a sibling occurrence. See
[Backend Execution Flow](./backend-execution-flow.md) → "Task state authority".

This is the current occurrence implementation: `WorkBlock` is both the time
container and the scope key. The accepted target introduces
`TaskOccurrence` as the neutral execution scope and makes `WorkBlock`
optional. Current `workBlockId` behavior remains authoritative until that
migration completes.

## Schedule state

Important models:

- `WorkBlock`
- `ScheduleProposal`
- `SchedulerLease`
- `SchedulerEvent`

Important enums:

- `ScheduleStatus`
- `ScheduleSource`
- `ScheduleProposalStatus`
- `WorkBlockStatus`
- `WorkBlockTrigger`

Schedule state supports user-created and AI-suggested time blocks, proposal decision workflows, scheduler automation leasing, and due-work startup.

`WorkBlockTrigger` currently records WorkBlock provenance (`scheduled` or
`manual`); it is not an extensible trigger-definition catalog. Future
schedule, webhook, and internal-event activation is specified separately in
[Long-Horizon Goals and Triggers](./long-horizon-goals-and-triggers.md).

## External calendar state

Important models:

- `CalendarSource`
- `ImportedCalendarEvent`

Important enums:

- `CalendarSourceLifecycleState`
- `CalendarEventStatus`
- `CalendarSyncState`
- `CalendarSyncPolicy`
- `CalendarAutomationPolicy`

External calendars are read-only subscription sources. Source URLs stay server-side; browser responses use redacted labels. Imported events become read-only busy blocks for schedule/planning context and can drive auto-plan/auto-complete behavior according to source sync and automation policies.

## Conversation, tool, and assistant state

Important models:

- `ConversationEntry`
- `ToolCallDetail`
- `ToolInvocation`
- `TaskAssistantMessage`
- `RawEventLog`
- `TaskTimelineItem`

These records back task workspace conversation/execution context, assistant surfaces, runtime/tool-call inspection, raw provider/runtime event audits, and task timeline projections.

## Memory state

Important model:

- `Memory`

Important enums:

- `MemoryScope`
- `MemorySourceType`
- `MemoryStatus`

Memory entries are scoped to workspace/task context and used by internal projections and AI context-building flows. Memory is not a current primary navigation surface.

## AI client configuration

Important models:

- `AiClient`
- `AiFeatureBinding`

Chrona stores AI client configuration in the database and binds clients to feature slots. `packages/engine/src/modules/ai` loads clients directly from this configuration; provider selection is not hard-coded in routes.

## Workspace and task-kind state

Important current enums:

- `WorkspaceStatus`
- `TaskKind`

Workspaces can be lifecycle-gated independently from task state. Current
`TaskKind` distinguishes `single` and `recurring`; recurrence is represented by
task RRULE/anchor fields and expanded into WorkBlocks. This is a current-schema
description, not the final abstraction: the accepted target separates
`single` versus `series` execution mode from schedule trigger definitions.
See [Long-Horizon Goals and Triggers](./long-horizon-goals-and-triggers.md).

## Operational notes

- Prisma client generation: `bun run db:generate`.
- Seed local data: `bun run db:seed`.
- Seed retained Goal acceptance evidence: `bun run db:seed:goal-acceptance`.
- Schema source: `prisma/schema.prisma`; migration SQL lives under
  `prisma/migrations` and is applied by `packages/db/src/sqlite-migrations.ts`.
- Chrona keeps one mutable release-line migration for the current unreleased
  release. Before the first public release, that migration is
  `prisma/migrations/0001_initial`; after a public release, the first schema
  change starts one new release-oriented migration folder for the next release.
- Do not create a migration folder for every schema edit. Accumulate subsequent
  unreleased schema changes in the current release-line migration and keep it
  aligned with `prisma/schema.prisma`.
- After a public release ships, migrations in that release are immutable. Do not
  edit, rename, delete, or squash them; start the next release-line migration
  from the shipped release state.
- Release migration verification must cover both fresh SQLite creation and
  upgrade from the previous released database snapshot.

Do not edit generated Prisma client files. Update `prisma/schema.prisma`, then regenerate.
