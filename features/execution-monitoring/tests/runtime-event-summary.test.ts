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

  it("preserves provider completion output and duration for the live trace", () => {
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
      durationMs: 42,
      raw: { text: "export const secret = true" },
    });
    expect(JSON.stringify(event)).toContain("export const secret");
  });

  it("preserves provider error details for the live trace", () => {
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

    expect(event?.event).toMatchObject({
      type: "tool_completed",
      error: { code: "permission_denied", message: "credential leaked" },
    });
    expect(JSON.stringify(event)).toContain("credential leaked");
  });

  it("projects the actual provider request and response payloads", () => {
    const request = summarizeRuntimeEvent("start_manual", {
      nodeId: "node-a",
      executionScope: "scope-a",
      nodeTitle: "Node A",
      runtimeName: "hermes",
      event: {
        type: "raw_event",
        provider: "anthropic",
        runId: "run-1",
        raw: {
          kind: "provider_request",
          input: { instructions: "Inspect the repository", input: { target: "src" } },
        },
      },
    } satisfies PlanExecutionRuntimeEvent);
    const response = summarizeRuntimeEvent("start_manual", {
      nodeId: "node-a",
      executionScope: "scope-a",
      nodeTitle: "Node A",
      runtimeName: "hermes",
      event: {
        type: "run_completed",
        provider: "anthropic",
        runId: "run-1",
        run: { provider: "anthropic", runId: "run-1", sessionId: "session-1", status: "completed" },
        outputText: "Repository inspected",
        structuredPayload: { files: 12 },
      },
    } satisfies PlanExecutionRuntimeEvent);

    expect(request?.event).toMatchObject({
      type: "run_status",
      status: "started",
      input: { instructions: "Inspect the repository", input: { target: "src" } },
    });
    expect(response?.event).toMatchObject({
      type: "run_status",
      status: "completed",
      output: { text: "Repository inspected", structuredPayload: { files: 12 } },
    });
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
