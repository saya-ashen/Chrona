---
chronicle_version: 1
scope: "file"
source: "external-calendar.ts"
owner_feature: "Calendar"
owner_capability: "External Calendar"
layer: "db"
status: "active"
sync:
  mode: "scaffold-and-check"
  source_hash: "4b9f5b9175782f97"
  last_scanned_commit: ""
symbols:
  - id: "createCalendarSource"
    source_name: "createCalendarSource"
    kind: "function"
    describe: true
  - id: "listImportedCalendarEventsInRange"
    source_name: "listImportedCalendarEventsInRange"
    kind: "function"
    describe: true
  - id: "markCalendarSourceRemoved"
    source_name: "markCalendarSourceRemoved"
    kind: "function"
    describe: true
  - id: "replaceImportedCalendarEvents"
    source_name: "replaceImportedCalendarEvents"
    kind: "function"
    describe: true
  - id: "updateCalendarSource"
    source_name: "updateCalendarSource"
    kind: "function"
    describe: true
  - id: "updateCalendarSourceSyncStatus"
    source_name: "updateCalendarSourceSyncStatus"
    kind: "function"
    describe: true
---
# external-calendar

<!-- ai:start -->
Provides the persistence boundary for external calendar sources, imported event replacement, source lifecycle changes, sync metadata, and imported event range queries.
<!-- ai:end -->

## Generated symbol inventory

<!-- generated:symbols:start -->
| Symbol | Kind | Score | Reason | Signature |
|---|---:|---:|---|---|
| `createCalendarSource` | function | 6 | ai-selected:external-calendar-persistence-boundary | `export function createCalendarSource(data: CalendarSourceCreateData): Promise<CalendarSource>` |
| `listImportedCalendarEventsInRange` | function | 5 | ai-selected:external-calendar-persistence-boundary | `export function listImportedCalendarEventsInRange( workspaceId: string, from: Date, to: Date, sourceId?: string, ): Promise<Array<ImportedCalendarEvent &` |
| `markCalendarSourceRemoved` | function | 6 | ai-selected:external-calendar-persistence-boundary | `export async function markCalendarSourceRemoved( workspaceId: string, sourceId: string, ): Promise<CalendarSource \| null>` |
| `replaceImportedCalendarEvents` | function | 8 | ai-selected:external-calendar-persistence-boundary | `export async function replaceImportedCalendarEvents( calendarSourceId: string, events: ImportedCalendarEventWrite[], options?: Partial<ImportedCalendarSyncOptions>, ): Promise<ImportedCalendarReplacementResult>` |
| `updateCalendarSource` | function | 6 | ai-selected:external-calendar-persistence-boundary | `export function updateCalendarSource( workspaceId: string, sourceId: string, data: Prisma.CalendarSourceUpdateInput, ): Promise<CalendarSource>` |
| `updateCalendarSourceSyncStatus` | function | 6 | ai-selected:external-calendar-persistence-boundary | `export function updateCalendarSourceSyncStatus( workspaceId: string, sourceId: string, data:` |
<!-- generated:symbols:end -->

## Symbols

<!-- symbol:createCalendarSource:start -->

### `createCalendarSource`

<!-- ai:start -->
Role: Persists a new external calendar source row from normalized service input.

Behavior: Calls `db.calendarSource.create` with caller-supplied workspace, display, URL label, color, policy, automation, and blocked-network confirmation fields.

Inputs/outputs: Input is `CalendarSourceCreateData`; output is the created Prisma `CalendarSource` record.

Invariants:
This function does not validate or normalize URLs; callers must provide already-normalized data and policy defaults when needed.

Coverage:
Coverage status: Partial

Covered:
- Direct repository tests create sources for lifecycle, filtering, refresh metadata, sync policy, automation policy, stale-link recovery, and recurring-event scenarios.

Missing or weak:
- Tests do not isolate required field failures or default database values for every optional create field.
<!-- ai:end -->

<!-- generated:tests:start createCalendarSource -->
Direct tests:
- packages/db/src/external-calendar-management.bun.test.ts
- packages/db/src/external-calendar.bun.test.ts

Transitive tests:
- None found
<!-- generated:tests:end createCalendarSource -->

<!-- symbol:createCalendarSource:end -->

<!-- symbol:listImportedCalendarEventsInRange:start -->

### `listImportedCalendarEventsInRange`

<!-- ai:start -->
Role: Lists imported, visible calendar events overlapping a requested workspace time range.

Behavior: Queries imported events by workspace, optional source id, non-cancelled status, active source lifecycle, and interval overlap, including the source row and ordering by start time.

Inputs/outputs: Input is workspace id, exclusive range bounds (`startsAt < to` and `endsAt > from`), and optional source id. Output is imported event rows with their `calendarSource` included.

Invariants:
Cancelled events and events from disabled or removed sources are hidden. Range matching is overlap-based, not containment-based.

Coverage:
Coverage status: Partial

Covered:
- Direct tests cover listing imported events in range, hiding disabled-source events, hiding removed-source events, and excluding removed sources from source lists.

Missing or weak:
- Tests do not directly cover optional source filtering, boundary equality at `from`/`to`, ordering across multiple visible events, or cancelled-event exclusion through this query.
<!-- ai:end -->

<!-- generated:tests:start listImportedCalendarEventsInRange -->
Direct tests:
- packages/db/src/external-calendar-management.bun.test.ts
- packages/db/src/external-calendar.bun.test.ts

Transitive tests:
- None found
<!-- generated:tests:end listImportedCalendarEventsInRange -->

<!-- symbol:listImportedCalendarEventsInRange:end -->

<!-- symbol:markCalendarSourceRemoved:start -->

### `markCalendarSourceRemoved`

<!-- ai:start -->
Role: Soft-removes an external calendar source for a workspace.

Behavior: Finds the source by workspace and id, returns null when absent, returns the existing row when already removed, otherwise updates lifecycle state to `removed`.

Inputs/outputs: Input is workspace id and source id. Output is the updated/previous `CalendarSource` row or null for no matching source.

Invariants:
Removal is idempotent for already removed rows and does not hard-delete source or imported event records.

Coverage:
Coverage status: Partial

Covered:
- Direct tests cover marking a source removed, excluding it from source lists, and hiding its imported events.

Missing or weak:
- Tests do not directly cover missing-source null return or idempotent behavior for already removed sources.
<!-- ai:end -->

<!-- generated:tests:start markCalendarSourceRemoved -->
Direct tests:
- packages/db/src/external-calendar-management.bun.test.ts
- packages/db/src/external-calendar.bun.test.ts

Transitive tests:
- None found
<!-- generated:tests:end markCalendarSourceRemoved -->

<!-- symbol:markCalendarSourceRemoved:end -->

<!-- symbol:replaceImportedCalendarEvents:start -->

### `replaceImportedCalendarEvents`

<!-- ai:start -->
Role: Replaces a source's imported event snapshot and keeps linked Chrona tasks, projections, and work blocks in sync.

Behavior: Runs in a transaction, loads source/workspace policy defaults, updates existing events by stable identity, upserts by dedupe key, creates or updates linked tasks/work blocks, records automation requests, cancels stale events missing from the new feed, and deletes orphaned calendar-created tasks no longer linked.

Inputs/outputs: Input is a source id, normalized imported event writes, and optional sync policy/automation/clock overrides. Output reports imported count and auto-plan requests for newly actionable imports.

Invariants:
Replacement preserves stable event/task/work-block linkage when possible, collapses recurring series onto one recurring task, cancels disappeared events instead of deleting them, and preserves local task description edits while updating calendar-owned scheduling fields.

Coverage:
Coverage status: Good

Covered:
- Direct tests cover dedupe update, task/projection/work-block creation, recurring series collapse, past-event completion policy, auto-execute automation requests, manual automation suppression, moved event rescheduling, disappeared-event cancellation, stale task recovery, and stale work-block recovery.

Missing or weak:
- Tests do not exhaust every transaction failure path or orphan-task deletion branch, but core replacement behavior is directly covered.
<!-- ai:end -->

<!-- generated:tests:start replaceImportedCalendarEvents -->
Direct tests:
- packages/db/src/external-calendar-management.bun.test.ts
- packages/db/src/external-calendar.bun.test.ts

Transitive tests:
- None found
<!-- generated:tests:end replaceImportedCalendarEvents -->

<!-- symbol:replaceImportedCalendarEvents:end -->

<!-- symbol:updateCalendarSource:start -->

### `updateCalendarSource`

<!-- ai:start -->
Role: Updates mutable calendar source fields within a workspace/source key.

Behavior: Delegates to `db.calendarSource.update` using compound workspace and source identifiers and caller-provided Prisma update data.

Inputs/outputs: Input is workspace id, source id, and `Prisma.CalendarSourceUpdateInput`; output is the updated `CalendarSource` or Prisma's update error when no row matches.

Invariants:
The workspace id is part of the update key, preventing cross-workspace source updates through this repository function.

Coverage:
Coverage status: Partial

Covered:
- Direct tests cover lifecycle updates to disabled/active and show resulting visibility changes for imported events.

Missing or weak:
- Tests do not directly cover name, color, sync policy, automation policy, not-found errors, or cross-workspace mismatch.
<!-- ai:end -->

<!-- generated:tests:start updateCalendarSource -->
Direct tests:
- packages/db/src/external-calendar-management.bun.test.ts
- packages/db/src/external-calendar.bun.test.ts

Transitive tests:
- None found
<!-- generated:tests:end updateCalendarSource -->

<!-- symbol:updateCalendarSource:end -->

<!-- symbol:updateCalendarSourceSyncStatus:start -->

### `updateCalendarSourceSyncStatus`

<!-- ai:start -->
Role: Updates refresh/sync metadata for a calendar source in a workspace.

Behavior: Delegates to `db.calendarSource.update` for sync state, counts, refresh timestamps, last error fields, and optional lifecycle state.

Inputs/outputs: Input is workspace id, source id, and a constrained sync-status update object. Output is the updated `CalendarSource` row.

Invariants:
Sync metadata updates are scoped by both source id and workspace id; clearing stale errors is done by explicitly passing null error fields.

Coverage:
Coverage status: Partial

Covered:
- Direct management test covers failed-state error metadata followed by successful refresh metadata, imported/skipped counts, timestamp updates, and clearing stale errors.

Missing or weak:
- Tests do not cover not-found behavior, lifecycleState updates through this function, or partial/failed status variants beyond stored field assertions.
<!-- ai:end -->

<!-- generated:tests:start updateCalendarSourceSyncStatus -->
Direct tests:
- packages/db/src/external-calendar-management.bun.test.ts

Transitive tests:
- None found
<!-- generated:tests:end updateCalendarSourceSyncStatus -->

<!-- symbol:updateCalendarSourceSyncStatus:end -->
