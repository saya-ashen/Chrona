---
chronicle_version: 1
scope: "file"
source: "external-calendar.ts"
owner_feature: "Calendar"
owner_capability: "External Calendar"
layer: "contracts"
status: "active"
sync:
  mode: "scaffold-and-check"
  source_hash: "71c74fd457646024"
  last_scanned_commit: ""
symbols:
  - id: "calendarSourceSummarySchema"
    source_name: "calendarSourceSummarySchema"
    kind: "schema"
    describe: true
    signature_hash: "0f240c1e82bf157b"
    body_hash: "6864c24fdc6c80d9"
  - id: "calendarSyncStatusSchema"
    source_name: "calendarSyncStatusSchema"
    kind: "schema"
    describe: true
    signature_hash: "336d67743c3f018a"
    body_hash: "9f08b1cbcc4d5c4a"
  - id: "createCalendarSourceRequestSchema"
    source_name: "createCalendarSourceRequestSchema"
    kind: "schema"
    describe: true
    signature_hash: "b91497807ee4805c"
    body_hash: "2878818f540680fb"
  - id: "importedCalendarEventSummarySchema"
    source_name: "importedCalendarEventSummarySchema"
    kind: "schema"
    describe: true
    signature_hash: "af12fc3f42c8d54f"
    body_hash: "b4f9c3f4dcf36070"
  - id: "updateCalendarSourceRequestSchema"
    source_name: "updateCalendarSourceRequestSchema"
    kind: "schema"
    describe: true
    signature_hash: "cb9244f3224e6408"
    body_hash: "ab7f164e65fcdccf"
  - id: "validateCalendarSourceResponseSchema"
    source_name: "validateCalendarSourceResponseSchema"
    kind: "schema"
    describe: true
    signature_hash: "f3b9328a5ee3bdc5"
    body_hash: "d9f4fbcefd46ce5b"
---
# external-calendar

<!-- ai:start -->
Defines shared Zod contracts for external calendar source management, feed validation responses, sync status, and imported read-only calendar event summaries.
<!-- ai:end -->

## Generated symbol inventory

<!-- generated:symbols:start -->
| Symbol | Kind | Score | Reason | Signature |
|---|---:|---:|---|---|
| `calendarSourceSummarySchema` | schema | -1 | ai-selected:external-calendar-public-contracts | `calendarSourceSummarySchema = z.object(` |
| `calendarSyncStatusSchema` | schema | -1 | ai-selected:external-calendar-public-contracts | `calendarSyncStatusSchema = z.object(` |
| `createCalendarSourceRequestSchema` | schema | -1 | ai-selected:external-calendar-public-contracts | `createCalendarSourceRequestSchema = z.object(` |
| `importedCalendarEventSummarySchema` | schema | 1 | ai-selected:external-calendar-public-contracts | `importedCalendarEventSummarySchema = z.object(` |
| `updateCalendarSourceRequestSchema` | schema | -1 | ai-selected:external-calendar-public-contracts | `updateCalendarSourceRequestSchema = z.object(` |
| `validateCalendarSourceResponseSchema` | schema | -1 | ai-selected:external-calendar-public-contracts | `validateCalendarSourceResponseSchema = z.discriminatedUnion("valid", [ validateCalendarSourceSuccessSchema, validateCalendarSourceFailureSchema, ])` |
<!-- generated:symbols:end -->

## Symbols

<!-- symbol:calendarSourceSummarySchema:start -->

### `calendarSourceSummarySchema`

<!-- ai:start -->
Role: Describes the public calendar source summary returned by server APIs without exposing the raw subscription URL.

Behavior: Requires stable source identity, display metadata, subscription type, lifecycle state, sync and automation policies, optional refresh timestamps, and optional last-error details.

Inputs/outputs: Parses API source-summary objects into `CalendarSourceSummary`; rejects missing identifiers, empty names, non-hex colors, unsupported enum values, and invalid datetime strings.

Invariants:
The raw `sourceUrl` is intentionally absent. `redactedUrlLabel` is the only URL-like field allowed in this response shape.

Coverage:
Coverage status: Partial

Covered:
- Direct contract test parses a source summary with redacted URL label, policies, lifecycle state, color, and refresh timestamp, then verifies `sourceUrl` is absent from parsed output.

Missing or weak:
- Tests do not cover invalid enum values, optional error fields, invalid colors, or date rejection.
<!-- ai:end -->

<!-- generated:tests:start calendarSourceSummarySchema -->
Direct tests:
- packages/contracts/src/external-calendar.bun.test.ts

Transitive tests:
- None found
<!-- generated:tests:end calendarSourceSummarySchema -->

<!-- symbol:calendarSourceSummarySchema:end -->

<!-- symbol:calendarSyncStatusSchema:start -->

### `calendarSyncStatusSchema`

<!-- ai:start -->
Role: Defines the refresh/sync status payload reported after calendar source refresh attempts.

Behavior: Requires source identity, one of the supported sync states, imported/skipped counts, and optional refresh schedule or latest error metadata.

Inputs/outputs: Parses sync status objects into `CalendarSyncStatus`; counts must be non-negative integers and timestamp fields must be datetime strings when present.

Invariants:
Sync state is limited to idle, syncing, success, partial, or failed. Error codes share the validation error-code enum used by validation responses.

Coverage:
Coverage status: Unknown

Covered:
- No direct tests are generated for this schema in this doc.

Missing or weak:
- Sync-state parsing, count constraints, optional timestamps, and error metadata are not directly covered.
<!-- ai:end -->

<!-- generated:tests:start calendarSyncStatusSchema -->
Direct tests:
- None found

Transitive tests:
- None found
<!-- generated:tests:end calendarSyncStatusSchema -->

<!-- symbol:calendarSyncStatusSchema:end -->

<!-- symbol:createCalendarSourceRequestSchema:start -->

### `createCalendarSourceRequestSchema`

<!-- ai:start -->
Role: Defines the request body accepted when creating a new external calendar source.

Behavior: Requires a trimmed non-empty name and URL. Allows optional hex color, sync policy, automation policy, and blocked-network confirmation flag.

Inputs/outputs: Parses create requests into `CreateCalendarSourceRequest`; invalid names, colors, policies, or empty URLs are rejected by schema constraints.

Invariants:
Create requests carry the raw subscription URL only on input. Policy fields are optional so the service can choose defaults.

Coverage:
Coverage status: Unknown

Covered:
- No direct tests are generated for this schema in this doc.

Missing or weak:
- Required-field validation, name trimming/bounds, color validation, policy enums, and `allowBlockedNetwork` handling are not directly covered.
<!-- ai:end -->

<!-- generated:tests:start createCalendarSourceRequestSchema -->
Direct tests:
- None found

Transitive tests:
- None found
<!-- generated:tests:end createCalendarSourceRequestSchema -->

<!-- symbol:createCalendarSourceRequestSchema:end -->

<!-- symbol:importedCalendarEventSummarySchema:start -->

### `importedCalendarEventSummarySchema`

<!-- ai:start -->
Role: Defines the public read-only event summary returned for imported calendar events.

Behavior: Requires imported event identity, source display metadata, title, start/end datetimes, all-day flag, event status, and literal `readOnly: true`; linked task and work-block ids may be null or omitted.

Inputs/outputs: Parses API event summaries into `ImportedCalendarEventSummary`; rejects unsupported statuses, invalid datetimes, non-hex source colors, and any `readOnly` value other than true.

Invariants:
Imported calendar events are exposed as read-only API objects; clients must not treat them as editable Chrona-created schedule blocks.

Coverage:
Coverage status: Partial

Covered:
- Direct contract test parses an imported event summary and verifies `readOnly` remains true.

Missing or weak:
- Tests do not cover nullable task/work-block ids, invalid colors, invalid datetimes, rejected statuses, or read-only false rejection.
<!-- ai:end -->

<!-- generated:tests:start importedCalendarEventSummarySchema -->
Direct tests:
- packages/contracts/src/external-calendar.bun.test.ts

Transitive tests:
- None found
<!-- generated:tests:end importedCalendarEventSummarySchema -->

<!-- symbol:importedCalendarEventSummarySchema:end -->

<!-- symbol:updateCalendarSourceRequestSchema:start -->

### `updateCalendarSourceRequestSchema`

<!-- ai:start -->
Role: Defines the request body accepted when editing mutable calendar source settings.

Behavior: Allows optional updates for name, color, sync policy, automation policy, and enabled state, then rejects an empty update object.

Inputs/outputs: Parses update requests into `UpdateCalendarSourceRequest`; valid fields may be supplied independently, but at least one supported field must be present.

Invariants:
Update requests cannot change source URL or source type. `enabled` is the API-level boolean that the server maps to source lifecycle state.

Coverage:
Coverage status: Unknown

Covered:
- No direct tests are generated for this schema in this doc.

Missing or weak:
- Empty-object rejection, per-field validation, and lifecycle mapping assumptions are not directly covered.
<!-- ai:end -->

<!-- generated:tests:start updateCalendarSourceRequestSchema -->
Direct tests:
- None found

Transitive tests:
- None found
<!-- generated:tests:end updateCalendarSourceRequestSchema -->

<!-- symbol:updateCalendarSourceRequestSchema:end -->

<!-- symbol:validateCalendarSourceResponseSchema:start -->

### `validateCalendarSourceResponseSchema`

<!-- ai:start -->
Role: Defines the discriminated validation response returned after probing a calendar subscription URL.

Behavior: Accepts either a success object with detected metadata, preview count, redacted label, and warnings, or a failure object with validation error code and safe message.

Inputs/outputs: Parses validation results into `ValidateCalendarSourceResponse`, discriminated by `valid: true` or `valid: false`.

Invariants:
Failure codes are limited to the shared validation error enum. Success responses expose redacted labels and counts, not fetched feed contents.

Coverage:
Coverage status: Partial

Covered:
- Direct contract test parses a validation failure with `unsupported_scheme` and verifies the discriminant is false.

Missing or weak:
- Success responses, warning arrays, preview count bounds, redacted label requirements, and other error codes are not directly covered.
<!-- ai:end -->

<!-- generated:tests:start validateCalendarSourceResponseSchema -->
Direct tests:
- packages/contracts/src/external-calendar.bun.test.ts

Transitive tests:
- None found
<!-- generated:tests:end validateCalendarSourceResponseSchema -->

<!-- symbol:validateCalendarSourceResponseSchema:end -->
