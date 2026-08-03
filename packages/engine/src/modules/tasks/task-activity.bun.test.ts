import { describe, expect, it } from "bun:test";
import {
  buildActivityTimeline,
  deduplicateProjectedActivity,
  type WorkspaceActivityTimelineItem,
} from "./task-activity";

type ActivityEventInput = Parameters<typeof buildActivityTimeline>[0][number];

function activity(id: string): WorkspaceActivityTimelineItem {
  return {
    id,
    kind: "node",
    title: id,
    summary: id,
    description: id,
    tone: "info",
  };
}

describe("deduplicateProjectedActivity", () => {
  it("removes duplicate activity items by ID", () => {
    const duplicate = activity("event-1");
    const canonical = activity("event-1");

    expect(
      deduplicateProjectedActivity([duplicate, canonical]).map((item) => item.id),
    ).toEqual(["event-1"]);
  });
});

describe("buildActivityTimeline", () => {
  it("keeps only the latest progress update for one tool call", () => {
    const providerEvent = (id: string, sequence: number, executionScope = "scope-1"): ActivityEventInput => ({
      id,
      eventType: "provider.tool_progress",
      source: "provider",
      payload: {
        executionScope,
        providerLabel: "AI provider",
        runtimeLabel: "Execution runtime",
        runId: "run-1",
        event: {
          type: "tool_progress",
          toolLabel: "Runtime tool",
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
      tool: { name: "Runtime tool", state: "progress" },
      executionScope: "scope-1",
    });
    expect(JSON.stringify(timeline)).not.toContain("job-call-1");
    expect(JSON.stringify(timeline)).not.toContain("run-1");

    const separateScopes = buildActivityTimeline([
      providerEvent("scope-a-progress", 1, "scope-a"),
      providerEvent("scope-b-progress", 1, "scope-b"),
    ]);
    expect(separateScopes.map((item) => item.executionScope)).toEqual(["scope-a", "scope-b"]);
  });


  it("does not expose plan prompts or provider diagnostics", () => {
    const occurredAt = new Date("2026-07-19T03:41:00.000Z");
    const event = (id: string, eventType: string, payload: Record<string, unknown>): ActivityEventInput => ({
      id,
      eventType,
      source: "plan_generation",
      payload,
      occurredAt,
      createdAt: occurredAt,
      ingestSequence: 20,
      nodeId: null,
      nodeTitle: null,
    });

    const timeline = buildActivityTimeline([
      event("started", "plan_generation.started", { instruction: "secret planning prompt" }),
      event("status", "plan_generation.status", { message: "provider reasoning and /private/path" }),
      event("failed", "plan_generation.failed", { message: "token=secret", code: "native_error" }),
      event("tool", "plan_generation.tool_called", { tool: "native_tool", input: { token: "secret" } }),
    ]);

    expect(timeline.map((item) => item.description)).toEqual([
      "Generating a task plan.",
      "Plan generation progressed.",
      "Plan generation failed.",
    ]);
    expect(JSON.stringify(timeline)).not.toMatch(/secret|reasoning|private|native_tool|native_error/);
  });
});
