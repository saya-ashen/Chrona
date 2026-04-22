import { describe, expect, it } from "bun:test";

import {
  buildAgentMessage,
  buildStructuredResult,
  createBridgeLogger,
  parseNDJSONEvents,
  parseToolCallsFromSessionTranscript,
  summarizeBridgeRequest,
  type BridgeLogEntry,
} from "./server";

describe("openclaw bridge logging helpers", () => {
  it("summarizes request metadata without dumping full prompt bodies", () => {
    expect(
      summarizeBridgeRequest({
        sessionId: "sess-1",
        message: "hello world",
        systemPrompt: "system prompt text",
        timeout: 123,
      }),
    ).toEqual({
      sessionId: "sess-1",
      timeout: 123,
      messageChars: 11,
      hasSystemPrompt: true,
      systemPromptChars: 18,
      hasExecution: false,
      executionMode: null,
      runtimeAdapterKey: null,
      taskId: null,
      runtimeInputKeys: [],
    });
  });

  it("builds a task-execution prompt envelope from bridge metadata", () => {
    expect(
      buildAgentMessage({
        sessionId: "sess-task",
        message: "Implement the schedule automation flow.",
        execution: {
          mode: "task",
          runtimeAdapterKey: "openclaw",
          taskId: "task-123",
          workspaceId: "ws-1",
          taskTitle: "Schedule automation",
          runtimeInput: {
            model: "gpt-5.4",
            approvalPolicy: "never",
            toolMode: "workspace-write",
            temperature: 0.2,
          },
        },
      }),
    ).toContain("[Chrona Task Execution Request]");
    expect(
      buildAgentMessage({
        sessionId: "sess-task",
        message: "Implement the schedule automation flow.",
        execution: {
          mode: "task",
          runtimeAdapterKey: "openclaw",
          taskId: "task-123",
          workspaceId: "ws-1",
          taskTitle: "Schedule automation",
          runtimeInput: {
            model: "gpt-5.4",
            approvalPolicy: "never",
            toolMode: "workspace-write",
            temperature: 0.2,
          },
        },
      }),
    ).toContain("Task ID: task-123");
  });

  it("emits structured log entries through an injectable sink", () => {
    const entries: BridgeLogEntry[] = [];
    const logger = createBridgeLogger({
      minLevel: "info",
      sink: (entry) => entries.push(entry),
    });

    logger.info("bridge.started", { port: 7677, pid: 1234 });
    logger.debug("bridge.debug", { ignored: true });
    logger.error("bridge.failed", { reason: "boom" });

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      level: "info",
      event: "bridge.started",
      data: { port: 7677, pid: 1234 },
    });
    expect(entries[1]).toMatchObject({
      level: "error",
      event: "bridge.failed",
      data: { reason: "boom" },
    });
    expect(typeof entries[0].ts).toBe("string");
  });
});

describe("openclaw bridge structured parsing", () => {
  it("parses NDJSON lines", () => {
    const events = parseNDJSONEvents([
      '{"type":"text","text":"hello"}',
      'not-json',
      '{"type":"tool_use","tool":"submit_structured_result","callId":"call-1","input":{"schemaName":"demo","schemaVersion":"1.0.0","status":"success","confidence":1,"result":{"value":1},"missingFields":[],"followUpQuestions":[],"notes":[]}}',
    ]);

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: "text", text: "hello" });
    expect(events[1]).toMatchObject({ type: "tool_use", tool: "submit_structured_result" });
  });

  it("extracts structured result from tool call args", () => {
    const response = buildStructuredResult({
      sessionId: "sess-test",
      runId: "run-1",
      output: "human summary",
      error: null,
      toolCalls: [
        {
          tool: "submit_structured_result",
          callId: "call-1",
          status: "completed",
          input: {
            schemaName: "demo",
            schemaVersion: "1.0.0",
            status: "success",
            confidence: 0.95,
            result: { answer: 42 },
            missingFields: [],
            followUpQuestions: [],
            notes: ["done"],
          },
          result: "accepted",
        },
      ],
    });

    expect(response.ok).toBe(true);
    expect(response.parsed).toEqual({ answer: 42 });
    expect(response.status).toBe("success");
    expect(response.reliability).toBe("tool_call");
  });

  it("marks missing tool call as unreliable fallback", () => {
    const response = buildStructuredResult({
      sessionId: "sess-missing-tool",
      runId: "run-2",
      output: "plain text only",
      error: null,
      toolCalls: [],
    });

    expect(response.ok).toBe(false);
    expect(response.reliability).toBe("fallback_text");
    expect(response.error).toContain("submit_structured_result");
  });

  it("should extract submit_structured_result from legacy single-blob output metadata", () => {
    const legacyToolCall = {
      tool: "submit_structured_result",
      callId: "legacy-call-1",
      input: {
        schemaName: "task_plan_graph",
        schemaVersion: "1.0.0",
        status: "needs_clarification",
        confidence: 0.62,
        result: { summary: "need more info" },
        missingFields: ["jurisdiction"],
        followUpQuestions: ["竞选哪个国家或地区的总统？"],
        notes: ["legacy blob"],
      },
      status: "completed",
    };

    const response = buildStructuredResult({
      sessionId: "sess-legacy-tool",
      runId: "run-legacy",
      output: "已生成结构化结果",
      error: null,
      toolCalls: [],
      legacyToolCalls: [legacyToolCall],
    });

    expect(response.ok).toBe(true);
    expect(response.status).toBe("needs_clarification");
    expect(response.structured?.missingFields).toEqual(["jurisdiction"]);
    expect(response.parsed).toEqual({ summary: "need more info" });
    expect(response.rawToolCall).toMatchObject({ tool: "submit_structured_result", callId: "legacy-call-1" });
  });

  it("should prefer explicit legacy structured-result extraction error over generic missing-tool fallback", () => {
    const response = buildStructuredResult({
      sessionId: "sess-legacy-error",
      runId: "run-legacy-error",
      output: "plain text only",
      error: null,
      toolCalls: [],
      legacyExtractionError: "Legacy blob detected but did not contain submit_structured_result metadata",
    });

    expect(response.ok).toBe(false);
    expect(response.error).toContain("Legacy blob detected");
    expect(response.error).not.toContain("was not called");
  });

  it("parses tool calls from session transcript jsonl content", () => {
    const transcript = [
      '{"type":"message","message":{"role":"assistant","content":[{"type":"toolCall","id":"call-1","name":"submit_structured_result","arguments":{"schemaName":"task_plan_graph","schemaVersion":"1.0.0","status":"success","confidence":0.9,"result":{"summary":"ok"},"missingFields":[],"followUpQuestions":[],"notes":[]}}]}}',
      '{"type":"message","message":{"role":"toolResult","toolCallId":"call-1","toolName":"submit_structured_result","details":{"schemaName":"task_plan_graph","schemaVersion":"1.0.0","status":"success","confidence":0.9,"result":{"summary":"ok"},"missingFields":[],"followUpQuestions":[],"notes":[]},"isError":false}}',
    ].join("\n");

    const toolCalls = parseToolCallsFromSessionTranscript(transcript);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toMatchObject({
      tool: "submit_structured_result",
      callId: "call-1",
      status: "completed",
      input: {
        schemaName: "task_plan_graph",
        schemaVersion: "1.0.0",
        status: "success",
      },
    });
  });
});
