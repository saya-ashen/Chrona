# External Calendar Fixtures

Deterministic iCalendar feeds for external calendar contract, parser, API, and UI tests.

- `valid.ics`: single timed event.
- `empty.ics`: valid feed with no events.
- `malformed.ics`: invalid date and incomplete event closure.
- `recurring.ics`: weekly recurring event with bounded count.
- `all-day.ics`: all-day event using date values.
- `cancelled.ics`: cancelled event that should not become a busy block.
- `timezone.ics`: event with a named timezone definition.
- `duplicate.ics`: duplicate UID/time pair for dedupe checks.
- `oversized.ics`: marker fixture for max-size rejection tests without committing a large file.
