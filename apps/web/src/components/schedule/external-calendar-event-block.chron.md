---
chronicle_version: 1
scope: "file"
source: "external-calendar-event-block.tsx"
owner_feature: "Calendar"
owner_capability: "External Calendar Event Block"
layer: "web"
status: "active"
sync:
  mode: "scaffold-and-check"
  source_hash: "7d81f36d535b17db"
  last_scanned_commit: ""
symbols:
  - id: "ExternalCalendarEventBlock"
    source_name: "ExternalCalendarEventBlock"
    kind: "component"
    describe: true
---
# external-calendar-event-block

<!-- ai:start -->
Displays an imported external calendar busy block inside the schedule timeline as a read-only visual reservation with source identity and overlap state.
<!-- ai:end -->

## Generated symbol inventory

<!-- generated:symbols:start -->
| Symbol | Kind | Score | Reason | Signature |
|---|---:|---:|---|---|
| `ExternalCalendarEventBlock` | component | 7 | ai-selected:external-calendar-schedule-visibility-ui | `export function ExternalCalendarEventBlock(` |
<!-- generated:symbols:end -->

## Symbols

<!-- symbol:ExternalCalendarEventBlock:start -->

### `ExternalCalendarEventBlock`

<!-- ai:start -->
Role: Renders the compact card for one `PlanningBusyBlock`, making external calendar events visually distinct from editable scheduled task blocks.

Behavior: The block uses a dashed bordered card, marks itself `data-read-only="true"`, paints a source-color stripe, shows title, supplied time range, source name, and a Read-only badge. When `overlapsScheduledTask` is true it switches to warning styling and adds an overlap badge.

Inputs/outputs: Input: a `PlanningBusyBlock` external event and preformatted `timeRange`. Output: presentational React markup; it does not mutate events, trigger actions, or compute time formatting itself.

Invariants:
The source color is applied only to the decorative stripe. Read-only labeling is always rendered. Overlap warning UI depends solely on `event.overlapsScheduledTask`.

Coverage:
Coverage status: Unknown

Covered:
- No direct tests target this component. Transitive timeline tests assert imported event title, source label, color marker, read-only label, overlap badge, and responsive-region availability.

Missing or weak:
- Direct component coverage is absent; time-range display and non-overlap styling are only implied by integration rendering.
<!-- ai:end -->

<!-- generated:tests:start ExternalCalendarEventBlock -->
Direct tests:
- None found

Transitive tests:
- None found
<!-- generated:tests:end ExternalCalendarEventBlock -->

<!-- symbol:ExternalCalendarEventBlock:end -->
