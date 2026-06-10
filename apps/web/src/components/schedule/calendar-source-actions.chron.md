---
chronicle_version: 1
scope: "file"
source: "calendar-source-actions.tsx"
owner_feature: "Calendar"
owner_capability: "Calendar Source Actions"
layer: "web"
status: "active"
sync:
  mode: "scaffold-and-check"
  source_hash: "68385284d124eb3d"
  last_scanned_commit: ""
symbols:
  - id: "CalendarSourceActions"
    source_name: "CalendarSourceActions"
    kind: "component"
    describe: true
    signature_hash: "29da7221ef5a4563"
    body_hash: "927df5e9528fde89"
---
# calendar-source-actions

<!-- ai:start -->
Provides per-source management controls for external calendars, including editable display fields, policy controls, lifecycle toggles, refresh, deletion, and action error feedback.
<!-- ai:end -->

## Generated symbol inventory

<!-- generated:symbols:start -->
| Symbol | Kind | Score | Reason | Signature |
|---|---:|---:|---|---|
| `CalendarSourceActions` | component | 7 | ai-selected:external-calendar-source-management-ui | `export function CalendarSourceActions(` |
<!-- generated:symbols:end -->

## Symbols

<!-- symbol:CalendarSourceActions:start -->

### `CalendarSourceActions`

<!-- ai:start -->
Role: Acts as the mutation panel embedded in `CalendarSourceList`'s manage dialog for one external calendar source.

Behavior: It initializes editable name, color, sync policy, and automation policy from the source. Save sends trimmed metadata and policy changes, enable/disable toggles lifecycle state, refresh updates source/sync status and can request blocked-network confirmation, and remove requires a first click before deletion. Each action shows a pending label, disables competing actions, reports mapped client errors, and notifies the parent after source changes or removal.

Inputs/outputs: Inputs: workspace id, source summary, optional sync status, and callbacks for blocked-network confirmation, source change, and source removal. Output: React controls plus client mutation calls and parent callbacks; successful mutations, including removal, dispatch the external-calendar-created event to refresh schedule consumers.

Invariants:
Actions are serialized through `pendingAction`. Save is disabled for blank trimmed names. Status falls back to failed when the source has `lastErrorCode`, otherwise idle unless sync status is present. Blocked-network refresh can be surfaced from either thrown client errors or refreshed source/sync error codes.

Coverage:
Coverage status: Unknown

Covered:
- No direct tests target this component. Calendar source list tests exercise save, disable, enable, refresh, blocked-network retry, removal confirmation, and action error display through the manage dialog.

Missing or weak:
- Direct component coverage is absent; color/policy selection changes, pending labels, blank-name disabling, refreshed blocked-network status response, and event dispatch are not directly asserted.
<!-- ai:end -->

<!-- generated:tests:start CalendarSourceActions -->
Direct tests:
- None found

Transitive tests:
- None found
<!-- generated:tests:end CalendarSourceActions -->

<!-- symbol:CalendarSourceActions:end -->
