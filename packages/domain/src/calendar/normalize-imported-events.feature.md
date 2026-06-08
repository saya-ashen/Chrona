---
feature_doc_version: 1
scope: "file"
source: "normalize-imported-events.ts"
owner_feature: "Calendar"
owner_capability: "Normalize Imported Events"
layer: "unknown"
status: "active"
sync:
  mode: "scaffold-and-check"
  source_hash: "199476843fbcc835"
  last_scanned_commit: ""
symbols:
  - id: "normalizeImportedEvents"
    source_name: "normali"
    kind: "unknown"
    describe: true
---
# normalize-imported-events

<!-- ai:start -->
Documents normalization of imported calendar event candidates before persistence or UI projection.
<!-- ai:end -->

## Generated symbol inventory

<!-- generated:symbols:start -->
| Symbol | Kind | Score | Reason | Signature |
|---|---:|---:|---|---|
| `normalizeImportedEvents` | function | 5 | ai-selected:external-calendar-event-normalization | `export function normalizeImportedEvents(candidates: ImportedEventCandidate[])` |
<!-- generated:symbols:end -->

## Symbols

<!-- symbol:normalizeImportedEvents:start -->

### `normalizeImportedEvents`

<!-- ai:start -->
Role: Converts raw imported event candidates into Chrona's normalized external-event shape while removing duplicate occurrences from a single import batch.

Behavior: Builds a dedupe key from external UID, recurrence identity, and start time. First occurrence wins; later candidates with the same key are dropped. Text fields are trimmed, blank titles become "Untitled external event", blank descriptions become null, missing recurrence fields become null, missing all-day becomes false, and missing status becomes confirmed.

Inputs/outputs: Input is an ordered array of imported event candidates with Date start/end values. Output is an ordered array of normalized event objects carrying stable dedupe keys, normalized nullable fields, boolean all-day state, and a default confirmed status.

Invariants:
- Dedupe key format is `<externalUid>:<recurrenceId-or-single>:<startsAt ISO>`.
- Output preserves the first candidate for each dedupe key and preserves candidate order among kept events.
- Returned start and end values are the same Date objects supplied by the candidate.

Coverage:
Coverage status: Unknown

Covered:
- No generated direct test is listed for this symbol. Listed transitive import-helper coverage exercises duplicate removal and description preservation through the import path.

Missing or weak:
- Add direct tests for trimming/defaults, recurrence identity in dedupe keys, status defaults, all-day defaults, and first-candidate-wins ordering.
<!-- ai:end -->

<!-- generated:tests:start normalizeImportedEvents -->
Direct tests:
- None found

Transitive tests:
- None found
<!-- generated:tests:end normalizeImportedEvents -->

<!-- symbol:normalizeImportedEvents:end -->
