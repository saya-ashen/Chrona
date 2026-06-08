---
feature_doc_version: 1
scope: "file"
source: "normalizer.ts"
owner_feature: "Calendar"
owner_capability: "Normalizer"
layer: "integration"
status: "active"
sync:
  mode: "scaffold-and-check"
  source_hash: "50240ab4cd20b42a"
  last_scanned_commit: ""
symbols:
  - id: "parseICalendarFeed"
    source_name: "parseICalendarFeed"
    kind: "function"
    describe: true
---
# normalizer

<!-- ai:start -->
Documents parsing of iCalendar feeds into normalized Chrona calendar event candidates.
<!-- ai:end -->

## Generated symbol inventory

<!-- generated:symbols:start -->
| Symbol | Kind | Score | Reason | Signature |
|---|---:|---:|---|---|
| `parseICalendarFeed` | function | 5 | ai-selected:external-calendar-feed-parser | `export function parseICalendarFeed(feed: string, range?: ParseCalendarRange): ParseCalendarResult` |
<!-- generated:symbols:end -->

## Symbols

<!-- symbol:parseICalendarFeed:start -->

### `parseICalendarFeed`

<!-- ai:start -->
Role: Parses raw `.ics` feed text and extracts concrete calendar events for import, including ordinary events, all-day events, statuses, timezones, recurrence, and calendar name metadata.

Behavior: Uses `ical.js` to parse the feed, collect VEVENTs, skip malformed event rows, attach recurrence exceptions to recurring masters, expand recurring events inside a bounded range, and return normalized event records. Malformed calendar input is converted to `malformed_calendar`.

Inputs/outputs: Input is an iCalendar feed string plus an optional range with `from`, `to`, and `maxOccurrences`. Output includes optional calendar name, normalized events with dedupe keys and Date ranges, and a skipped-event count.

Invariants:
- Event status normalizes to confirmed, tentative, or cancelled.
- Dedupe keys combine UID, recurrence identity, and occurrence start ISO time.
- Range filtering includes events whose intervals overlap the requested range.
- Recurrence expansion is bounded by occurrence count and scan count.

Coverage:
Coverage status: Partial

Covered:
- Direct import-helper tests cover valid feed parsing, descriptions, all-day events, cancelled status, timezone conversion, duplicate downstream normalization, bounded recurring expansion, range limiting, and malformed calendar errors.

Missing or weak:
- Direct tests do not assert skipped-event counts, calendar name extraction, detached recurrence exceptions, recurrence `maxOccurrences`, invalid VEVENT skipping, or non-recurring range exclusion.
<!-- ai:end -->

<!-- generated:tests:start parseICalendarFeed -->
Direct tests:
- packages/integrations/src/calendar/calendar-import.bun.test.ts

Transitive tests:
- None found
<!-- generated:tests:end parseICalendarFeed -->

<!-- symbol:parseICalendarFeed:end -->
