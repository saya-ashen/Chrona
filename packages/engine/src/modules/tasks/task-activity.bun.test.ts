import { describe, expect, it } from "bun:test";
import {
  deduplicateProjectedActivity,
  type WorkspaceActivityTimelineItem,
} from "./task-activity";

function activity(
  id: string,
  raw?: unknown,
): WorkspaceActivityTimelineItem {
  return {
    id,
    kind: "node",
    title: id,
    summary: id,
    description: id,
    tone: "info",
    raw,
  };
}

describe("deduplicateProjectedActivity", () => {
  it("keeps the canonical event and removes its timeline projection", () => {
    const canonical = activity("event-1");
    const projection = activity("timeline-1", {
      metadata: { projection: true },
      eventId: "event-1",
    });

    expect(
      deduplicateProjectedActivity([projection, canonical]).map(
        (item) => item.id,
      ),
    ).toEqual(["event-1"]);
  });

  it("keeps a timeline projection when the canonical event is unavailable", () => {
    const projection = activity("timeline-1", { eventId: "event-1" });

    expect(deduplicateProjectedActivity([projection])).toEqual([projection]);
  });
});
