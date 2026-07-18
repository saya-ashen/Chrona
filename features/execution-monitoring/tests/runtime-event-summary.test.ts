import { describe, expect, it } from "vitest";
import { summarizeRuntimeEvent } from "@features/execution-monitoring/server";
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
        inputSummary: '"task id"',
      },
    });
  });

  it("keeps tool-call intent visible as live activity preview", () => {
    const event = summarizeRuntimeEvent("start_manual", {
      nodeId: "node-a",
      nodeTitle: "Review architecture",
      runtimeName: "hermes",
      event: {
        type: "tool_call",
        provider: "omp",
        runId: "run-1",
        callId: "call-1",
        tool: "mcp__codegraph_explore",
        input: {},
        status: "pending",
        preview: "Mapping architectural risk",
      },
    } satisfies PlanExecutionRuntimeEvent);

    expect(event.event).toMatchObject({
      type: "tool_started",
      label: "mcp__codegraph_explore",
      callId: "call-1",
      inputSummary: "{}",
      preview: "Mapping architectural risk",
    });
  });

  it("keeps incremental tool progress visible", () => {
    const event = summarizeRuntimeEvent("start_manual", {
      nodeId: "node-a",
      nodeTitle: "Review architecture",
      runtimeName: "hermes",
      event: {
        type: "tool_progress",
        provider: "omp",
        runId: "run-1",
        callId: "call-1",
        toolName: "task",
        preview: "Reviewer is inspecting persistence boundaries",
      },
    } satisfies PlanExecutionRuntimeEvent);

    expect(event.event).toEqual({
      type: "tool_progress",
      toolName: "task",
      callId: "call-1",
      label: "task",
      preview: "Reviewer is inspecting persistence boundaries",
    });
  });

  it("redacts secrets and exposes tool results for the transcript", () => {
    const started = summarizeRuntimeEvent("start_manual", {
      nodeId: "node-a",
      nodeTitle: "Inspect repository",
      runtimeName: "omp",
      event: {
        type: "tool_call",
        provider: "omp",
        runId: "run-1",
        callId: "call-1",
        tool: "read",
        input: { path: "src/app.ts", apiKey: "secret-value", nested: { authorization: "Bearer secret" } },
        status: "pending",
      },
    } satisfies PlanExecutionRuntimeEvent);
    const completed = summarizeRuntimeEvent("start_manual", {
      nodeId: "node-a",
      nodeTitle: "Inspect repository",
      runtimeName: "omp",
      event: {
        type: "tool_result",
        provider: "omp",
        runId: "run-1",
        callId: "call-1",
        tool: "read",
        result: { content: [{ type: "text", text: "export const ready = true;" }] },
      },
    } satisfies PlanExecutionRuntimeEvent);

    expect(started.event).toMatchObject({
      type: "tool_started",
      callId: "call-1",
      inputSummary: expect.stringContaining('"apiKey": "[redacted]"'),
    });
    expect(JSON.stringify(started.event)).not.toContain("secret-value");
    expect(JSON.stringify(started.event)).not.toContain("Bearer secret");
    expect(completed.event).toMatchObject({
      type: "tool_completed",
      callId: "call-1",
      preview: "export const ready = true;",
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
  it("summarizes provider task progress raw events", () => {
    const event = summarizeRuntimeEvent("start_manual", {
      nodeId: "node-a",
      nodeTitle: "Search jobs",
      runtimeName: "hermes",
      event: {
        type: "raw_event",
        provider: "claude_code",
        rawEventType: "system",
        raw: {
          type: "system",
          subtype: "task_progress",
          description: "Search: AI PhD jobs",
          usage: { tool_uses: 84 },
          workflow_progress: [
            { lastToolName: "WebSearch", lastToolSummary: "euraxess funded AI" },
          ],
        },
      },
    } satisfies PlanExecutionRuntimeEvent);

    expect(event).toMatchObject({
      event: {
        type: "raw_event",
        rawEventType: "system",
        message: "Search: AI PhD jobs · WebSearch: euraxess funded AI · 84 tool uses",
      },
    });
  });

});
