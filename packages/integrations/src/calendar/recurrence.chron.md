---
chronicle_version: 1
scope: "file"
source: "recurrence.ts"
owner_feature: "Calendar"
owner_capability: "Recurrence"
layer: "integration"
status: "active"
sync:
  mode: "scaffold-and-check"
  source_hash: "d1c57d416041aa26"
  last_scanned_commit: ""
symbols:
  - id: "expandRecurrenceRule"
    source_name: "expandRecurrenceRule"
    kind: "function"
    describe: true
    signature_hash: "ba471cbdc0d12221"
    body_hash: "14e137a6d1f8ee66"
---
# recurrence

<!-- ai:start -->
Documents expansion of raw RRULE definitions into bounded Chrona recurrence occurrences.
<!-- ai:end -->

## Generated symbol inventory

<!-- generated:symbols:start -->
| Symbol | Kind | Score | Reason | Signature |
|---|---:|---:|---|---|
| `expandRecurrenceRule` | function | 5 | ai-selected:external-calendar-recurrence-expansion | `export function expandRecurrenceRule( rrule: string, dtStart: Date, durationMs: number, options: ExpandRecurrenceRuleOptions, ): RecurrenceOccurrence[]` |
<!-- generated:symbols:end -->

## Symbols

<!-- symbol:expandRecurrenceRule:start -->

### `expandRecurrenceRule`

<!-- ai:start -->
Role: Expands a Chrona-native recurrence rule, first start time, and duration into concrete occurrence intervals inside a requested window.

Behavior: Rejects invalid start dates or non-positive durations by returning no occurrences. Builds a temporary iCalendar event from the RRULE, throws `invalid_recurrence_rule` for parse failures, iterates generated starts until the window end or configured safety bounds, and keeps only occurrences whose intervals overlap the requested range.

Inputs/outputs: Inputs are an RRULE string, `dtStart`, duration in milliseconds, and range options with optional `maxOccurrences`. Output is an array of `{ startsAt, endsAt }` Date intervals.

Invariants:
- Invalid `dtStart` or non-positive duration produces an empty result.
- Invalid RRULE syntax throws `invalid_recurrence_rule`.
- Occurrences end at `startsAt + durationMs`.
- Expansion stops at range end, at `maxOccurrences` returned items, or at scan safety limit `maxOccurrences * 20`.

Coverage:
Coverage status: Unknown

Covered:
- No generated direct test is listed for this symbol.

Missing or weak:
- Add direct tests for valid RRULE expansion, invalid RRULE errors, invalid date and duration handling, range overlap boundaries, `maxOccurrences`, and scan-limit behavior.
<!-- ai:end -->

<!-- generated:tests:start expandRecurrenceRule -->
Direct tests:
- None found

Transitive tests:
- None found
<!-- generated:tests:end expandRecurrenceRule -->

<!-- symbol:expandRecurrenceRule:end -->
