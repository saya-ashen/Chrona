---
chronicle_version: 1
scope: "file"
source: "calendar-source-setup.tsx"
owner_feature: "Calendar"
owner_capability: "Calendar Source Setup"
layer: "web"
status: "active"
sync:
  mode: "scaffold-and-check"
  source_hash: "6bfcc40e6fcbf1b5"
  last_scanned_commit: ""
symbols:
  - id: "CalendarSourceSetup"
    source_name: "CalendarSourceSetup"
    kind: "component"
    describe: true
---
# calendar-source-setup

<!-- ai:start -->
Provides the external-calendar connection entry point, including read-only guidance, connect dialog, validation, blocked-network confirmation, and handoff to the connected-source list.
<!-- ai:end -->

## Generated symbol inventory

<!-- generated:symbols:start -->
| Symbol | Kind | Score | Reason | Signature |
|---|---:|---:|---|---|
| `CalendarSourceSetup` | component | 7 | ai-selected:external-calendar-source-setup-ui | `export function CalendarSourceSetup(` |
<!-- generated:symbols:end -->

## Symbols

<!-- symbol:CalendarSourceSetup:start -->

### `CalendarSourceSetup`

<!-- ai:start -->
Role: Coordinates source creation UI for a workspace and keeps newly connected sources visible before or alongside the fetched source list.

Behavior: The component shows a setup header and Connect Calendar button, renders `CalendarSourceList`, and opens a dialog for name, URL, color, sync policy, and automation policy. Users can validate a URL, see preview feedback, submit a source, and confirm private/proxy network access when validation or creation reports a blocked-network error. Successful creation resets and closes the dialog, prepends the source, and dispatches the external-calendar-created event.

Inputs/outputs: Input: `workspaceId`. Output: React UI plus client calls to validate/create external calendar sources, local connected-source state, and a browser event after successful connection.

Invariants:
Submit stays disabled until both display name and URL are non-empty after trimming. Validation requires a non-empty URL and no pending validate/submit action. Dialog close resets form fields, validation, errors, and blocked-network state. Successful creation is accepted only when the response includes `syncStatus`.

Coverage:
Coverage status: Good

Covered:
- Direct tests cover read-only guidance, empty connected-source state, validation request/preview feedback, create request payload/default policies, connected source display, blocked-network confirmation retry, and invalid-link error feedback.

Missing or weak:
- No direct assertions for color/policy selection changes, dialog reset on close, validation blocked-network confirmation, or create responses missing sync status.
<!-- ai:end -->

<!-- generated:tests:start CalendarSourceSetup -->
Direct tests:
- apps/web/src/components/schedule/calendar-source-setup.test.tsx

Transitive tests:
- None found
<!-- generated:tests:end CalendarSourceSetup -->

<!-- symbol:CalendarSourceSetup:end -->
