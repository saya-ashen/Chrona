import { describe, expect, it } from "vitest";
import { summarizeRuntimeEvent } from "@features/execution-monitoring/server";
import type { PlanExecutionRuntimeEvent } from "@chrona/engine/modules/plan-execution";

describe("summarizeRuntimeEvent", () => {
  it("projects a safe tool lifecycle event", () => {
    const event = summarizeRuntimeEvent("start_manual", {
      nodeId: "node-a",
      executionScope: "scope-a",
      nodeTitle: "Node A",
      runtimeName: "hermes",
      event: {
        type: "tool_started",
        provider: "anthropic",
        runId: "run-1",
        nativeRunId: "native-1",
        sequence: 7,
        timestamp: "2026-05-22T00:00:03.000Z",
        toolName: "chrona_task_read",
        preview: "Read task",
        input: "task id",
      },
    } satisfies PlanExecutionRuntimeEvent);

    expect(event).toMatchObject({
      type: "runtime_event",
      nodeId: "node-a",
      executionScope: "scope-a",
      runtime: { category: "runtime", label: "Execution runtime" },
      provider: { category: "ai_provider", label: "AI provider" },
      sequence: 7,
      event: { type: "tool_started", tool: { category: "tool", label: "Runtime tool" }, label: "Runtime tool" },
    });
    expect(JSON.stringify(event)).not.toContain("run-1");
    expect(JSON.stringify(event)).not.toContain("Read task");
  });

  it("keeps safe completion status and duration without result content", () => {
    const event = summarizeRuntimeEvent("start_manual", {
      nodeId: "node-a",
      executionScope: "scope-a",
      nodeTitle: "Inspect repository",
      runtimeName: "omp",
      event: {
        type: "tool_completed",
        provider: "omp",
        runId: "run-1",
        sequence: 8,
        toolName: "read",
        durationMs: 42,
        raw: { text: "export const secret = true" },
      },
    } satisfies PlanExecutionRuntimeEvent);

    expect(event?.event).toMatchObject({
      type: "tool_completed",
      tool: { category: "tool", label: "Runtime tool" },
      durationMs: 42,
    });
    expect(JSON.stringify(event)).not.toContain("run-1");
    expect(JSON.stringify(event)).not.toContain("export const secret");
  });

  it("projects a generic failed tool status without provider error text", () => {
    const event = summarizeRuntimeEvent("start_manual", {
      nodeId: "node-a",
      executionScope: "scope-a",
      nodeTitle: "Inspect repository",
      runtimeName: "omp",
      event: {
        type: "tool_completed",
        provider: "omp",
        runId: "run-1",
        sequence: 9,
        toolName: "read",
        error: { message: "credential leaked", code: "permission_denied" },
      },
    } satisfies PlanExecutionRuntimeEvent);

    expect(event?.event).toMatchObject({ type: "tool_completed", error: { code: "permission_denied" } });
    expect(JSON.stringify(event)).not.toContain("credential leaked");
  });

  it("drops text, reasoning, and raw provider events", () => {
    const unsafe = {
      type: "text_delta",
      provider: "anthropic",
      runId: "run-1",
      text: "private response",
    } as PlanExecutionRuntimeEvent["event"];

    expect(summarizeRuntimeEvent("start_manual", {
      nodeId: "node-a",
      executionScope: "scope-a",
      nodeTitle: "Node A",
      runtimeName: "hermes",
      event: unsafe,
    })).toBeNull();
  });
});
