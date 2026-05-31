# Research: External Calendar Connections

## Decision: First Release Uses Read-Only Subscription Feeds

**Rationale**: The feature goal is to get external calendar commitments into Chrona planning quickly with low authorization risk. Read-only webcal-style or downloadable feeds validate the product value without introducing OAuth consent, token refresh, provider-specific webhooks, or two-way edit conflicts.

**Alternatives considered**:

- Google Calendar OAuth first: rejected for this release because it adds account consent, token storage, provider permissions, and sync conflict behavior before the core planning value is proven.
- Full two-way calendar editing: rejected because the spec explicitly requires read-only first-release behavior and external edits should remain in the source calendar.

## Decision: Normalize Imported Events Into Busy Blocks for Planning

**Rationale**: Chrona planning needs unavailable time, not external calendar ownership. Imported events should remain distinct from Chrona tasks while producing planning busy blocks that the schedule UI and future planners can read.

**Alternatives considered**:

- Convert each imported event into a Chrona task: rejected because it violates the spec's no-default-task-conversion requirement and would pollute task workflows.
- Display imported events only in source settings: rejected because calendar data has value only when visible in planning context.

## Decision: Store Source Links Server-Side and Redact Them From Browser Responses

**Rationale**: Private subscription URLs can grant access to calendar contents. Chrona must keep the canonical URL available for refresh while avoiding unnecessary exposure in source lists, schedule views, browser logs, and screenshots.

**Alternatives considered**:

- Return the full URL in all source responses: rejected as unnecessary exposure.
- Require users to re-enter the URL on every refresh: rejected because it makes normal sync unusable.

## Decision: Use Workspace-Date-Range Event Queries

**Rationale**: Planning views only need events for visible windows and near-future planning. Queries should be scoped by workspace, enabled source, and date range to keep normal views responsive with multiple calendars.

**Alternatives considered**:

- Load all imported events for a workspace: rejected due to avoidable latency and memory growth.
- Store only the next seven days: rejected because users need month-scale planning and the success criteria references next 30 days.

## Decision: Refresh Is Explicit in MVP With Status Metadata

**Rationale**: Manual refresh plus persisted status is enough for MVP source management and deterministic tests. It also avoids designing a background scheduler before the import and display model is validated.

**Alternatives considered**:

- Background-only refresh: rejected because it hides failures and makes acceptance testing harder.
- No refresh after setup: rejected because external calendars change and stale data would reduce trust.

## Decision: Parser/Normalizer Lives Outside React and Route Handlers

**Rationale**: Calendar feed parsing, recurrence expansion, deduplication, and time-zone normalization are business/integration rules. Keeping them in packages makes them testable without browser or server route setup and preserves constitution layer boundaries.

**Alternatives considered**:

- Parse in React components: rejected because business logic must not live in components.
- Parse directly inside Hono routes: rejected because route handlers should orchestrate validation, auth/workspace context, and service calls only.

## Decision: Provider OAuth Deferred Behind a Future Source Type

**Rationale**: The data model can allow a source type value without implementing OAuth flows now. The first release should not create fake Google/Outlook UI affordances or unused token storage.

**Alternatives considered**:

- Add OAuth token fields now: rejected as speculative complexity.
- Hard-code only one source type forever: rejected because the product direction includes future provider connections.
