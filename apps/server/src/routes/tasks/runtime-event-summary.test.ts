import { describe, expect, it } from "vitest";
import { summarizeRuntimeEvent } from "./runtime-event-summary";
import type { PlanExecutionRuntimeEvent } from "@chrona/engine/modules/plan-execution";

describe("summarizeRuntimeEvent", () => {
  it("keeps full tool runtime payload for workspace activity", () => {
    const event = summarizeRuntimeEvent("start_manual", {
      nodeId: "node-a",
      nodeTitle: "Node A",
      runtimeName: "hermes",
      event: {
        type: "tool_started",
        provider: "anthropic",
        runId: "run-1",
        nativeRunId: "native-1",
        sequence: 7,
        timestamp: "2026-05-22T00:00:03.000Z",
        rawEventType: "tool_use",
        toolName: "chrona_task_read",
        preview: "Read task",
        input: "task id",
      },
    } satisfies PlanExecutionRuntimeEvent);

    expect(event).toMatchObject({
      type: "runtime_event",
      action: "start_manual",
      nodeId: "node-a",
      nodeTitle: "Node A",
      runtimeName: "hermes",
      provider: "anthropic",
      runId: "run-1",
      nativeRunId: "native-1",
      sequence: 7,
      timestamp: "2026-05-22T00:00:03.000Z",
      rawEventType: "tool_use",
      event: {
        type: "tool_started",
        toolName: "chrona_task_read",
        label: "Reading task",
        preview: "Read task",
        input: "task id",
      },
    });
  });

  it("backfills the receipt time when the provider omits a timestamp", () => {
    const before = Date.now();
    const event = summarizeRuntimeEvent("start_manual", {
      nodeId: "node-a",
      nodeTitle: "Node A",
      runtimeName: "hermes",
      event: {
        type: "text_delta",
        provider: "anthropic",
        runId: "run-1",
        text: "partial output",
      },
    } satisfies PlanExecutionRuntimeEvent);
    const after = Date.now();

    expect(event.timestamp).toBeDefined();
    const stamped = Date.parse(event.timestamp as string);
    expect(Number.isNaN(stamped)).toBe(false);
    expect(stamped).toBeGreaterThanOrEqual(before);
    expect(stamped).toBeLessThanOrEqual(after);
  });
});
