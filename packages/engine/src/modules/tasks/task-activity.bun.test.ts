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
          toolName: "eval",
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
      tool: { name: "eval", state: "progress" },
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


  it("merges completion and result events by tool call without exposing IDs", () => {
    const providerEvent = (
      id: string,
      type: "tool_completed" | "tool_result",
      callId: string | undefined,
      failed = false,
      rawEventType?: string,
      sequence?: number,
      nodeAttemptId = "attempt-1",
      providerRunId = "provider-run-1",
    ): ActivityEventInput => ({
      id,
      eventType: `provider.${type}`,
      source: "provider",
      payload: {
        executionScope: "scope-1",
        providerLabel: "AI provider",
        runtimeLabel: "Execution runtime",
        runId: "run-1",
        event: {
          type,
          toolName: type === "tool_completed" ? "chrona_node_read" : undefined,
          tool: type === "tool_result" ? "chrona_node_read" : undefined,
          callId,
          rawEventType,
          sequence,
          ...(failed ? { error: { message: "Read failed" } } : {}),
          ...(type === "tool_result" ? { result: { ok: false } } : {}),
        },
      },
      occurredAt: new Date("2026-07-19T03:41:00.000Z"),
      createdAt: new Date("2026-07-19T03:41:00.000Z"),
      ingestSequence: 20,
      nodeAttemptId,
      providerRunId,
      nodeId: "node-1",
      nodeTitle: "Search jobs",
    });

    const timeline = buildActivityTimeline([
      providerEvent("completed-1", "tool_completed", "call-1", true),
      providerEvent("result-1", "tool_result", "call-1"),
      providerEvent("completed-2", "tool_completed", "call-2"),
      providerEvent(
        "legacy-completed",
        "tool_completed",
        undefined,
        false,
        "tool_execution_end",
        30,
      ),
      providerEvent(
        "legacy-result",
        "tool_result",
        undefined,
        false,
        "tool_execution_end:result",
        31,
      ),
      providerEvent("result-without-call", "tool_result", undefined),
      providerEvent(
        "retry-completed",
        "tool_completed",
        "call-1",
        false,
        undefined,
        undefined,
        "attempt-2",
        "provider-run-2",
      ),
      providerEvent(
        "retry-result",
        "tool_result",
        "call-1",
        false,
        undefined,
        undefined,
        "attempt-2",
        "provider-run-2",
      ),
    ]);

    expect(timeline).toHaveLength(5);
    expect(timeline[0]).toMatchObject({
      id: "completed-1",
      kind: "tool_completed",
      tone: "danger",
      tool: { name: "chrona_node_read", state: "failed" },
      providerOutput: { ok: false },
    });
    expect(timeline[1]).toMatchObject({
      id: "completed-2",
      kind: "tool_completed",
      tool: { name: "chrona_node_read", state: "completed" },
    });
    expect(timeline[2]).toMatchObject({
      id: "legacy-completed",
      kind: "tool_completed",
      providerOutput: { ok: false },
    });
    expect(timeline[3]).toMatchObject({
      id: "result-without-call",
      kind: "tool_completed",
      title: "Tool result",
    });
    expect(timeline[4]).toMatchObject({
      id: "retry-completed",
      kind: "tool_completed",
      tool: { name: "chrona_node_read", state: "completed" },
    });
    expect(JSON.stringify(timeline)).not.toMatch(/call-[12]|run-1/);
  });

  it("redacts secrets from persisted provider text and reasoning", () => {
    const event = (
      id: string,
      type: "text_delta" | "reasoning_delta",
      text: string,
    ): ActivityEventInput => ({
      id,
      eventType: `provider.${type}`,
      source: "provider",
      payload: {
        executionScope: "scope-secret",
        providerLabel: "AI provider",
        runtimeLabel: "Execution runtime",
        event: { type, text },
      },
      occurredAt: new Date("2026-07-19T03:42:00.000Z"),
      createdAt: new Date("2026-07-19T03:42:00.000Z"),
      ingestSequence: 30,
      nodeId: "node-secret",
      nodeTitle: "Safe output",
    });

    const serialized = JSON.stringify(buildActivityTimeline([
      event("text-secret", "text_delta", '{"apiKey":"sk-live"}'),
      event(
        "reasoning-secret",
        "reasoning_delta",
        "Authorization: Bearer bearer-live",
      ),
    ]));

    expect(serialized).toContain("[redacted]");
    expect(serialized).not.toMatch(/sk-live|bearer-live/);
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
