---
feature_doc_version: 1
scope: "file"
source: "planning-busy-blocks.ts"
owner_feature: "Calendar"
owner_capability: "Planning Busy Blocks"
layer: "unknown"
status: "active"
sync:
  mode: "scaffold-and-check"
  source_hash: "e3ca5aa61d450714"
  last_scanned_commit: ""
symbols:
  - id: "projectPlanningBusyBlocks"
    source_name: "projectPlanningBusyBlocks"
    kind: "function"
    describe: true
---
# planning-busy-blocks

<!-- ai:start -->
Documents projection of imported calendar events into read-only busy blocks used by planning views.
<!-- ai:end -->

## Generated symbol inventory

<!-- generated:symbols:start -->
| Symbol | Kind | Score | Reason | Signature |
|---|---:|---:|---|---|
| `projectPlanningBusyBlocks` | function | 5 | ai-selected:external-calendar-planning-busy-blocks | `export function projectPlanningBusyBlocks(` |
<!-- generated:symbols:end -->

## Symbols

<!-- symbol:projectPlanningBusyBlocks:start -->

### `projectPlanningBusyBlocks`

<!-- ai:start -->
Role: Turns imported external calendar events into planning busy blocks and marks whether each one conflicts with scheduled Chrona work.

Behavior: Filters out cancelled events and imported events already linked to a Chrona task or work block. Remaining events are mapped to read-only busy blocks with calendar source metadata, title, all-day flag, Date start/end values, and an overlap flag computed against supplied scheduled blocks.

Inputs/outputs: Input is a set of imported calendar event summaries plus optional scheduled planning blocks. Output is a busy-block array suitable for planning UI use; event timestamps are converted from summary values into Date objects.

Invariants:
- Cancelled events never produce busy blocks.
- Events linked by `taskId` or `workBlockId` are excluded to avoid double-counting Chrona-owned time.
- Overlap uses strict interval intersection: `startA < endB && endA > startB`.
- Every projected block is read-only.

Coverage:
Coverage status: Good

Covered:
- Direct tests cover read-only projection, source metadata preservation, overlap detection, cancelled-event exclusion, and exclusion of events already backed by Chrona task work blocks.

Missing or weak:
- No direct test isolates `taskId`-only versus `workBlockId`-only exclusion or boundary-touching non-overlap, but main behavior is covered.
<!-- ai:end -->

<!-- generated:tests:start projectPlanningBusyBlocks -->
Direct tests:
- packages/domain/src/calendar/planning-busy-blocks.bun.test.ts

Transitive tests:
- None found
<!-- generated:tests:end projectPlanningBusyBlocks -->

<!-- symbol:projectPlanningBusyBlocks:end -->
