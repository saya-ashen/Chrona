import { describe, expect, it } from "bun:test";
import {
  buildActivityTimeline,
  deduplicateProjectedActivity,
  type WorkspaceActivityTimelineItem,
} from "./task-activity";

type ActivityEventInput = Parameters<typeof buildActivityTimeline>[0][number];

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

describe("buildActivityTimeline", () => {
  it("keeps only the latest progress update for one tool call", () => {
    const providerEvent = (id: string, sequence: number): ActivityEventInput => ({
      id,
      eventType: "provider.tool_progress",
      source: "provider",
      payload: {
        provider: "omp",
        runtimeName: "omp",
        runId: "run-1",
        event: {
          type: "tool_progress",
          toolName: "job",
          callId: "job-call-1",
          sequence,
        },
      },
      occurredAt: new Date(`2026-07-19T03:40:${String(sequence).padStart(2, "0")}.000Z`),
      createdAt: new Date(`2026-07-19T03:40:${String(sequence).padStart(2, "0")}.000Z`),
      ingestSequence: sequence,
      nodeId: "node-1",
      nodeTitle: "Search jobs",
    });

    const timeline = buildActivityTimeline([
      providerEvent("progress-1", 10),
      providerEvent("progress-2", 11),
      providerEvent("progress-3", 12),
    ]);

    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({
      id: "progress-3",
      kind: "tool_progress",
      raw: { sequence: 12 },
      tool: { name: "job", callId: "job-call-1", state: "progress" },
    });
  });
});
