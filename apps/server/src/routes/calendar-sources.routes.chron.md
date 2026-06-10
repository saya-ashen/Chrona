---
chronicle_version: 1
scope: "file"
source: "calendar-sources.routes.ts"
owner_feature: "Calendar"
owner_capability: "Calendar Sources.routes"
layer: "server"
status: "active"
sync:
  mode: "scaffold-and-check"
  source_hash: "a3ab5c94b60e9bd1"
  last_scanned_commit: ""
symbols:
  - id: "createCalendarSourceRoutes"
    source_name: "createCalendarSourceRoutes"
    kind: "route"
    describe: true
---
# calendar-sources.routes

<!-- ai:start -->
Exposes HTTP routes for validating, creating, listing, updating, refreshing, deleting, and querying external calendar sources and imported events.
<!-- ai:end -->

## Generated symbol inventory

<!-- generated:symbols:start -->
| Symbol | Kind | Score | Reason | Signature |
|---|---:|---:|---|---|
| `createCalendarSourceRoutes` | route | 11 | ai-selected:external-calendar-api-route | `export function createCalendarSourceRoutes(options: CalendarSourceRouteOptions =` |
<!-- generated:symbols:end -->

## Symbols

<!-- symbol:createCalendarSourceRoutes:start -->

### `createCalendarSourceRoutes`

<!-- ai:start -->
Role: Creates the Hono router segment for calendar-source APIs and wires request validation, service calls, response status codes, and route-level error handling.

Behavior: The router validates workspace/source params, create/update/validate payloads, and event range query strings. It delegates source validation, creation, listing, update, refresh, removal, and event listing to `createExternalCalendarService`. Invalid event ranges return 400; missing sources during update/refresh map to 404; unexpected failures become internal server errors with route-specific context.

Inputs/outputs: Input is optional route dependencies (`transport`, `now`) plus HTTP requests under `/workspaces/:workspaceId`. Output is JSON from the external calendar service, with create returning 201, validation failures during create returning 400, not-found cases returning 404, and valid event-list requests returning imported calendar event summaries.

Invariants:
All public request bodies and params pass contract or local Zod validation before service calls. Event listing requires parseable `from` and `to` dates with `from < to`. The route uses fixture transport only when `CHRONA_E2E_CALENDAR_FIXTURES` is set.

Coverage:
Coverage status: Unknown

Covered:
- No direct route tests are generated for this symbol in this doc.

Missing or weak:
- Route behavior appears exercised only transitively by API tests; without generated direct tests here, request validation, status mapping, and error branches remain unproven for this chronicle.
<!-- ai:end -->

<!-- generated:tests:start createCalendarSourceRoutes -->
Direct tests:
- None found

Transitive tests:
- None found
<!-- generated:tests:end createCalendarSourceRoutes -->

<!-- symbol:createCalendarSourceRoutes:end -->
