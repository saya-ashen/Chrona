---
chronicle_version: 1
scope: "file"
source: "external-calendar-service.ts"
owner_feature: "Calendar"
owner_capability: "External Calendar Service"
layer: "server"
status: "active"
sync:
  mode: "scaffold-and-check"
  source_hash: "569db6ff8de549f4"
  last_scanned_commit: ""
symbols:
  - id: "createExternalCalendarService"
    source_name: "createExternalCalendarService"
    kind: "function"
    describe: true
---
# external-calendar-service

<!-- ai:start -->
Defines server-side orchestration for external calendar subscriptions: URL validation, source CRUD, refresh/import, sync metadata, and read-only event listing.
<!-- ai:end -->

## Generated symbol inventory

<!-- generated:symbols:start -->
| Symbol | Kind | Score | Reason | Signature |
|---|---:|---:|---|---|
| `createExternalCalendarService` | function | 5 | ai-selected:external-calendar-refresh-service | `export function createExternalCalendarService(options: ExternalCalendarServiceOptions =` |
<!-- generated:symbols:end -->

## Symbols

<!-- symbol:createExternalCalendarService:start -->

### `createExternalCalendarService`

<!-- ai:start -->
Role: Builds the calendar service facade used by API routes, binding optional feed transport, clock, and auto-plan callback dependencies to repository and integration functions.

Behavior: Validation normalizes and fetches a calendar feed, parses iCalendar data, and returns either preview metadata or a safe validation error. Source creation validates before persisting, chooses defaults, then immediately refreshes. Refresh marks sync in progress, imports normalized events across a bounded lookback/lookahead window, starts any requested auto-plans, and records success, partial, or failed sync status. Listing and update methods convert database rows to public contract shapes.

Inputs/outputs: Input is optional service dependencies plus workspace/source identifiers and contract request objects. Outputs are contract-shaped source lists, source responses, validation responses, sync status responses, delete acknowledgements, or imported event lists with ISO timestamps and `readOnly: true`.

Invariants:
Calendar source URLs are normalized before storage or validation. Failed feed operations expose safe error codes/messages, not raw failures. Created sources are refreshed before returning. Imported event windows are bounded to 30 days behind and 180 days ahead of the service clock.

Coverage:
Coverage status: Partial

Covered:
- Direct service tests cover Google default sync policy, default `auto_plan`, past-event completion after create/refresh, `auto_execute` propagation, and auto-plan callback requests for future imports.

Missing or weak:
- No direct service tests cover validation failure mapping, source list/update/remove endpoints, refresh failure sync status, partial skipped-event status, event listing serialization, or blocked-network confirmation.
<!-- ai:end -->

<!-- generated:tests:start createExternalCalendarService -->
Direct tests:
- apps/server/src/services/external-calendar-service.bun.test.ts

Transitive tests:
- None found
<!-- generated:tests:end createExternalCalendarService -->

<!-- symbol:createExternalCalendarService:end -->
