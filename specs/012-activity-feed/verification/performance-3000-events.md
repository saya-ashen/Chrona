# 3,000 Event Feed Budget

Command: seeded 3,000 provider text events and called `getTaskActivityPage({ limit: 3000 })`.

Result: passed.

Output summary:

```json
{
  "eventsSeeded": 3000,
  "itemsReturned": 1,
  "nextCursor": null,
  "elapsedMs": 47,
  "under2s": true,
  "firstKind": "assistant_message",
  "firstSummaryLength": 3000
}
```

The merge model compacted adjacent provider text deltas for the same run/node into one assistant activity item. Initial read and mapping stayed under the 2-second budget.
