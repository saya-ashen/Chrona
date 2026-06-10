---
chronicle_version: 1
scope: "file"
source: "calendar-source-list.tsx"
owner_feature: "Calendar"
owner_capability: "Calendar Source List"
layer: "web"
status: "active"
sync:
  mode: "scaffold-and-check"
  source_hash: "215cef9f55e4c0cb"
  last_scanned_commit: ""
symbols:
  - id: "CalendarSourceList"
    source_name: "CalendarSourceList"
    kind: "component"
    describe: true
    signature_hash: "725499d534e812ed"
    body_hash: "4d223ca0b9f8134a"
---
# calendar-source-list

<!-- ai:start -->
Renders the workspace's connected external calendar sources, merges newly created sources into the fetched list, and opens management controls for source health and lifecycle actions.
<!-- ai:end -->

## Generated symbol inventory

<!-- generated:symbols:start -->
| Symbol | Kind | Score | Reason | Signature |
|---|---:|---:|---|---|
| `CalendarSourceList` | component | 5 | ai-selected:external-calendar-source-management-ui | `export function CalendarSourceList(` |
<!-- generated:symbols:end -->

## Symbols

<!-- symbol:CalendarSourceList:start -->

### `CalendarSourceList`

<!-- ai:start -->
Role: Owns the connected-source panel for external calendars, including initial load, empty/error states, source rows, and the management dialog that delegates mutations to `CalendarSourceActions`.

Behavior: On mount it lists sources for the workspace and merges them with optimistic `createdSources`. Rows show source name, redacted URL, color, disabled/error badges, and a Manage button. The manage dialog shows refresh metadata, policies, latest error, imported count, and handles source updates/removal from child actions. Blocked-network refresh retries are gated behind a confirmation dialog.

Inputs/outputs: Input: `workspaceId` plus optional `createdSources` records with source summaries and sync status. Output: React UI only; side effects are `listExternalCalendarSources` calls, local source list updates, and callbacks passed into `CalendarSourceActions`.

Invariants:
Source identity is keyed by `source.id`; incoming records replace existing records with the same id, then render sorted by source name. Missing refresh dates render as `Not yet`; missing imported counts render as `Unknown`; load failures surface a generic field error without removing current sources.

Coverage:
Coverage status: Good

Covered:
- Direct tests cover populated list rendering, redacted labels, source health metadata, manage dialog wiring, update/disable/enable/refresh/remove flows, blocked-network refresh confirmation, and latest error display. Empty connected-source rendering is covered through `CalendarSourceSetup` tests, not the direct `CalendarSourceList` test.

Missing or weak:
- No direct assertion for merge sort order or list-load failure fallback.
<!-- ai:end -->

<!-- generated:tests:start CalendarSourceList -->
Direct tests:
- apps/web/src/components/schedule/calendar-source-list.test.tsx

Transitive tests:
- None found
<!-- generated:tests:end CalendarSourceList -->

<!-- symbol:CalendarSourceList:end -->
