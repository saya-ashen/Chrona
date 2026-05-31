# Data Model: External Calendar Connections

## Entity: Calendar Source

**Purpose**: Represents one user-added read-only external calendar connection for a Chrona workspace.

**Fields**:

- `id`: Stable source identifier.
- `workspaceId`: Owning Chrona workspace.
- `name`: User-facing display name.
- `sourceType`: Calendar source kind for this release, initially subscription feed.
- `urlSecret`: Server-side connection reference for the subscription URL; never returned in normal browser responses.
- `redactedUrlLabel`: Safe user-facing hint such as host or final path fragment.
- `color`: Visual identifier used in schedule and source management UI.
- `enabled`: Whether this source contributes events to planning views.
- `lifecycleState`: Active, disabled, removing, or removed.
- `lastSuccessfulRefreshAt`: Last refresh time that imported valid data.
- `nextExpectedRefreshAt`: Next expected refresh time shown to users.
- `lastErrorCode`: Stable error code for the latest refresh/setup failure.
- `lastErrorMessage`: User-actionable summary of the latest failure.
- `createdAt`: Creation timestamp.
- `updatedAt`: Last source metadata update timestamp.

**Relationships**:

- Belongs to one workspace.
- Has many imported calendar events.
- Has one current sync status derived from source metadata and latest refresh attempt.

**Validation Rules**:

- `name` must be non-empty and workspace-scoped.
- Source URL must be validated before the source becomes active.
- Normal read responses must not include the full source URL.
- Removed sources must not contribute events to planning views.

**State Transitions**:

- `active` -> `disabled` when user disables the source.
- `disabled` -> `active` when user re-enables the source.
- `active|disabled` -> `removing` while confirmed removal is processed.
- `removing` -> `removed` after source and future visible events are excluded.

## Entity: Imported Calendar Event

**Purpose**: Represents a read-only event occurrence imported from an external calendar source.

**Fields**:

- `id`: Stable imported event identifier.
- `workspaceId`: Owning workspace for authorization and query scoping.
- `calendarSourceId`: Source that produced the event.
- `externalUid`: External calendar UID when present.
- `recurrenceInstanceKey`: Occurrence identity for recurring events.
- `dedupeKey`: Stable workspace/source/event identity used to avoid duplicates.
- `title`: User-facing event title, with fallback for missing summaries.
- `descriptionPreview`: Optional redacted or shortened description preview if supported.
- `location`: Optional event location if supported.
- `startsAt`: Event start timestamp.
- `endsAt`: Event end timestamp.
- `isAllDay`: Whether the event is all-day.
- `timeZone`: Event time-zone context when known.
- `status`: Confirmed, tentative, or cancelled.
- `readOnly`: Always true for this feature.
- `importedAt`: Time this occurrence was imported or refreshed.
- `sourceUpdatedAt`: External modified timestamp when available.

**Relationships**:

- Belongs to one calendar source.
- Produces a planning busy block when source is enabled and event is not cancelled.

**Validation Rules**:

- `startsAt` and `endsAt` must form a valid range, with all-day events normalized predictably.
- Duplicate events must not appear twice in the same source/date-range result.
- Cancelled events must not create active busy blocks.
- Imported events must not create Chrona tasks by default.

## Entity: Calendar Sync Status

**Purpose**: Provides user-visible health and refresh progress for each calendar source.

**Fields**:

- `calendarSourceId`: Source being reported.
- `state`: Idle, refreshing, healthy, partial, failed, disabled, or removed.
- `startedAt`: Current refresh start time when refreshing.
- `finishedAt`: Last refresh finish time.
- `eventsImported`: Count imported in the latest refresh.
- `eventsSkipped`: Count skipped because of invalid, duplicate, cancelled, or out-of-range data.
- `errorCode`: Stable machine-readable error code.
- `errorMessage`: User-facing next-step guidance.

**Validation Rules**:

- Failed and partial states must include actionable user-facing guidance.
- Disabled and removed sources must not show as refreshable active sources.
- Successful refresh must update source health and clear obsolete non-current errors.

## Entity: Planning Busy Block

**Purpose**: Represents unavailable time derived from imported events for schedule and planning views.

**Fields**:

- `id`: Derived busy-block identifier.
- `workspaceId`: Owning workspace.
- `calendarSourceId`: Source of the underlying event.
- `importedEventId`: Imported event represented by the block.
- `title`: Display title.
- `startsAt`: Busy start time.
- `endsAt`: Busy end time.
- `isAllDay`: Whether the block spans an all-day commitment.
- `sourceName`: Calendar source label.
- `sourceColor`: Calendar source visual identifier.
- `readOnly`: Always true.

**Validation Rules**:

- Busy blocks are query/view-model projections, not editable Chrona tasks.
- Busy blocks appear only for enabled sources and non-cancelled events.
- Busy blocks must remain visually distinguishable from Chrona task schedule blocks.

## Entity: Calendar Source Action

**Purpose**: Captures source-management actions users can perform and the expected observable result.

**Fields**:

- `action`: Add, validate, refresh, rename, recolor, disable, enable, or remove.
- `calendarSourceId`: Source affected, absent only for add.
- `input`: Action-specific safe input.
- `result`: Success or failure state.
- `message`: User-facing status or error guidance.

**Validation Rules**:

- Destructive removal must require confirmation.
- Refresh must never expose the full private URL to the browser.
- Disable/remove actions must immediately exclude affected source events from planning responses.
