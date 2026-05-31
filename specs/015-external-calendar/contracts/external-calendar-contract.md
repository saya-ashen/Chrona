# Contract: External Calendar Connections

## API Contract

All API responses are scoped to the authenticated user's active workspace. Full subscription URLs are accepted only during create/update validation and are never returned by read endpoints.

### `POST /api/workspaces/:workspaceId/calendar-sources/validate`

Purpose: Validate a subscription link before saving or refreshing a source.

Request:

```text
url: string
```

Response on success:

```text
valid: true
detectedName?: string
eventPreviewCount: number
redactedUrlLabel: string
warnings: string[]
```

Response on failure:

```text
valid: false
errorCode: invalid_url | unsupported_scheme | unreachable | unauthorized | malformed_calendar | too_large | unknown
message: string
```

Acceptance:

- Invalid, unsupported, private-auth-required, malformed, and oversized feeds return actionable messages.
- Response never includes the full input URL.

### `POST /api/workspaces/:workspaceId/calendar-sources`

Purpose: Add a read-only calendar source and import the initial visible event range.

Request:

```text
name: string
url: string
color?: string
```

Response:

```text
source: CalendarSourceSummary
syncStatus: CalendarSyncStatus
```

Acceptance:

- Source is saved only after validation succeeds.
- Initial import populates upcoming events when available.
- Empty calendars still return a connected source with zero imported events.

### `GET /api/workspaces/:workspaceId/calendar-sources`

Purpose: List configured external calendar sources.

Response:

```text
sources: CalendarSourceSummary[]
```

`CalendarSourceSummary`:

```text
id: string
name: string
sourceType: subscription
redactedUrlLabel: string
color: string
lifecycleState: active | disabled | removing | removed
lastSuccessfulRefreshAt?: string
nextExpectedRefreshAt?: string
lastErrorCode?: string
lastErrorMessage?: string
```

Acceptance:

- Disabled sources are included with disabled state.
- Removed sources are excluded from normal lists.
- Full source URL is never present.

### `PATCH /api/workspaces/:workspaceId/calendar-sources/:sourceId`

Purpose: Rename, recolor, enable, or disable a calendar source.

Request:

```text
name?: string
color?: string
enabled?: boolean
```

Response:

```text
source: CalendarSourceSummary
```

Acceptance:

- Disabling a source immediately removes its events from planning responses.
- Re-enabling restores eligible events without creating duplicates.

### `POST /api/workspaces/:workspaceId/calendar-sources/:sourceId/refresh`

Purpose: Manually refresh one source.

Response:

```text
source: CalendarSourceSummary
syncStatus: CalendarSyncStatus
```

Acceptance:

- Refresh updates sync status on success, partial success, and failure.
- Refresh failure does not delete the last successfully imported events unless the source is removed.

### `DELETE /api/workspaces/:workspaceId/calendar-sources/:sourceId`

Purpose: Remove a source after confirmation in the UI.

Response:

```text
removed: true
sourceId: string
```

Acceptance:

- Source and its events stop appearing in planning views.
- Operation is idempotent for already removed sources.

### `GET /api/workspaces/:workspaceId/calendar-events?from=YYYY-MM-DD&to=YYYY-MM-DD`

Purpose: Return imported read-only events for planning and schedule views.

Response:

```text
events: ImportedCalendarEventSummary[]
```

`ImportedCalendarEventSummary`:

```text
id: string
calendarSourceId: string
sourceName: string
sourceColor: string
title: string
startsAt: string
endsAt: string
isAllDay: boolean
status: confirmed | tentative | cancelled
readOnly: true
```

Acceptance:

- Query is scoped by workspace, enabled sources, and requested date range.
- Cancelled events do not appear as active busy blocks.
- Events remain distinct from Chrona tasks.

## UI Contract

Calendar source management must expose:

```text
empty state: no sources connected
add state: name, URL, optional color, validation result
source row: name, redacted URL label, enabled state, last refresh, next refresh, latest error
actions: refresh, rename, recolor, disable, enable, remove
destructive confirmation: remove source and imported events from future views
```

Schedule/planning views must expose:

```text
external event block: title, time range, source name/color, read-only marker
overlap visibility: external event remains distinguishable from Chrona tasks and other sources
responsive behavior: desktop 1440x900, tablet 1024x768, mobile 390x844 with no horizontal scrolling
```

## Sync and Import Contract

Refresh behavior:

```text
input: calendar source with server-side URL
steps: fetch feed, parse feed, expand visible occurrences, normalize times, dedupe, persist imported events, update sync status
output: source summary, sync status, imported/skipped counts
```

Acceptance:

- Routine automated tests use local fixtures or fakes, not live third-party calendars.
- Recurring, all-day, cancelled, duplicate, malformed, and time-zone cases have deterministic fixture coverage.
- Refresh can partially succeed while reporting skipped invalid events.

## Privacy Contract

- Full subscription URLs must be accepted only on create/update/refresh validation paths that require them.
- Normal source list, event list, schedule view, logs intended for users, and browser state must contain only redacted URL labels.
- Error messages must not leak secret query tokens embedded in subscription URLs.

## Final Report Contract

Final implementation response must include:

```text
changed_files: string[]
new_contracts_or_schemas: string[]
new_tests: string[]
browser_evidence: string[]
commands_run: string[]
remaining_risks: string[]
```

Acceptance:

- Commands include required typecheck, lint, unit/test, API, UI foundation, and e2e viewport validation results.
- Remaining risks call out provider OAuth as deferred, if still applicable.
