import { describe, expect, it } from "bun:test";

import {
  buildAgentCLIArgs,
  buildAgentMessage,
  buildStructuredResult,
  createBridgeLogger,
  parseNDJSONEvents,
  parseToolCallsFromSessionTranscript,
  startBridgeServer,
  summarizeBridgeRequest,
  type BridgeLogEntry,
  type BridgeFeatureRequest,
  type BridgeExecutionTaskRequest,
} from "./server";

describe("openclaw bridge helpers", () => {
  it("summarizes feature request metadata without dumping payload bodies", () => {
    const request: BridgeFeatureRequest<{ title: string; workspaceId: string }> = {
      sessionId: "sess-1",
      timeout: 123,
      input: { title: "hello world", workspaceId: "ws-1" },
    };

    expect(
      summarizeBridgeRequest(
        { kind: "feature", feature: "suggest", stream: false },
        request,
      ),
    ).toEqual({
      route: "features.suggest",
      sessionId: "sess-1",
      timeout: 123,
      input: { keys: ["title", "workspaceId"] },
    });
  });

  it("builds a feature request prompt envelope from explicit route semantics", () => {
    const request: BridgeFeatureRequest<{ title: string }> = {
      sessionId: "sess-feature",
      input: { title: "Write unit tests" },
    };

    const message = buildAgentMessage(
      { kind: "feature", feature: "suggest", stream: false },
      request,
    );

    expect(message).toContain("[Chrona Feature Request]");
    expect(message).toContain("Feature: suggest");
    expect(message).toContain("suggest_task_completions");
    expect(message).toContain('"title": "Write unit tests"');
  });

  it("builds a task-execution prompt envelope from execution metadata", () => {
    const request: BridgeExecutionTaskRequest = {
      sessionId: "sess-task",
      instructions: "Implement the schedule automation flow.",
      taskId: "task-123",
      workspaceId: "ws-1",
      taskTitle: "Schedule automation",
      runtimeAdapterKey: "openclaw",
      runtimeInput: {
        model: "gpt-5.4",
        approvalPolicy: "never",
        toolMode: "workspace-write",
        temperature: 0.2,
      },
    };

    const message = buildAgentMessage(
      { kind: "execution", stream: false },
      request,
    );

    expect(message).toContain("[Chrona Task Execution Request]");
    expect(message).toContain("Task ID: task-123");
    expect(message).toContain("[Task Instructions]");
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
  });

  it("builds CLI args with explicit feature route semantics", () => {
    const request: BridgeFeatureRequest<{ title: string }> = {
      sessionId: "sess-feature",
      timeout: 60,
      input: { title: "Write tests" },
    };

    expect(
      buildAgentCLIArgs(
        { kind: "feature", feature: "suggest", stream: false },
        request,
        "sess-feature",
      ),
    ).toEqual([
      "agent",
      "--local",
      "--json",
      "--session-id",
      "sess-feature",
      "--message",
      buildAgentMessage(
        { kind: "feature", feature: "suggest", stream: false },
        request,
      ),
      "--timeout",
      "60",
    ]);
  });

  it("builds CLI args with explicit execution route semantics", () => {
    const request: BridgeExecutionTaskRequest = {
      sessionId: "sess-task",
      instructions: "Implement the schedule automation flow.",
      timeout: 60,
      taskId: "task-123",
      workspaceId: "ws-1",
      taskTitle: "Schedule automation",
      runtimeAdapterKey: "openclaw",
      runtimeInput: {
        model: "gpt-5.4",
        approvalPolicy: "never",
        toolMode: "workspace-write",
        temperature: 0.2,
      },
    };

    expect(
      buildAgentCLIArgs(
        { kind: "execution", stream: false },
        request,
        "sess-task",
      ),
    ).toEqual([
      "agent",
      "--local",
      "--json",
      "--session-id",
      "sess-task",
      "--message",
      buildAgentMessage({ kind: "execution", stream: false }, request),
      "--timeout",
      "60",
    ]);
  });
});

describe("openclaw bridge runtime entrypoint", () => {
  it("starts a Bun server that answers health checks", async () => {
    const server = startBridgeServer({
      port: 17677,
      logger: createBridgeLogger({ minLevel: "error", sink: () => {} }),
      checkCLIAvailable: async () => true,
    });

    try {
      const res = await fetch("http://127.0.0.1:17677/v1/health");
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({
        status: "ok",
        bin: "openclaw",
      });
    } finally {
      server.stop(true);
    }
  });

  it("serves explicit feature endpoints and extracts generate-plan business tool results", async () => {
    const server = startBridgeServer({
      port: 17678,
      logger: createBridgeLogger({ minLevel: "error", sink: () => {} }),
      checkCLIAvailable: async () => true,
      executeRequest: async (route, request) => {
        expect(route).toEqual({
          kind: "feature",
          feature: "generate_plan",
          stream: false,
        });
        expect(request).toEqual({
          input: { taskId: "task-1", title: "Plan task" },
        });
        return {
          response: {
            sessionId: "sess-plan",
            runId: "run-plan",
            output: "plan output",
            toolCalls: [
              {
                tool: "generate_task_plan_graph",
                callId: "call-1",
                input: {
                  summary: "Plan ready",
                  nodes: [{ id: "n1", title: "Draft outline" }],
                  edges: [],
                },
                status: "completed",
              },
            ],
            usage: null,
            error: null,
            durationMs: 42,
            structured: null,
            feature: {
              feature: "generate_plan",
              source: "business_tool",
              toolName: "generate_task_plan_graph",
              payload: {
                summary: "Plan ready",
                nodes: [{ id: "n1", title: "Draft outline" }],
                edges: [],
              },
            },
          },
          events: [],
        };
      },
    });

    try {
      const res = await fetch("http://127.0.0.1:17678/v1/features/generate-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: { taskId: "task-1", title: "Plan task" } }),
      });
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({
        feature: {
          feature: "generate_plan",
          source: "business_tool",
          toolName: "generate_task_plan_graph",
        },
      });
    } finally {
      server.stop(true);
    }
  });

  it("serves explicit suggest endpoint and extracts suggest business tool results", async () => {
    const server = startBridgeServer({
      port: 17679,
      logger: createBridgeLogger({ minLevel: "error", sink: () => {} }),
      checkCLIAvailable: async () => true,
      executeRequest: async (route) => ({
        response: {
          sessionId: "sess-suggest",
          output: "",
          toolCalls: [
            {
              tool: "suggest_task_completions",
              callId: "call-1",
              input: {
                suggestions: [
                  {
                    title: "Write unit tests",
                    description: "Cover the new bridge routes",
                    priority: "High",
                    estimatedMinutes: 45,
                    tags: ["testing"],
                  },
                ],
              },
              status: "completed",
            },
          ],
          usage: null,
          error: null,
          durationMs: 10,
          structured: null,
          feature: {
            feature: "suggest",
            source: "business_tool",
            toolName: "suggest_task_completions",
            payload: {
              suggestions: [
                {
                  title: "Write unit tests",
                },
              ],
            },
          },
        },
        events: route.stream
          ? [{ type: "tool_use", tool: "suggest_task_completions", input: {} }]
          : [],
      }),
    });

    try {
      const res = await fetch("http://127.0.0.1:17679/v1/features/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: { input: "write tests", kind: "general" } }),
      });
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({
        feature: {
          feature: "suggest",
          toolName: "suggest_task_completions",
        },
      });
    } finally {
      server.stop(true);
    }
  });

  it("execution endpoint succeeds without structured result payloads", async () => {
    const server = startBridgeServer({
      port: 17680,
      logger: createBridgeLogger({ minLevel: "error", sink: () => {} }),
      checkCLIAvailable: async () => true,
      executeRequest: async () => ({
        response: {
          sessionId: "sess-exec",
          runId: "run-exec",
          output: "completed task execution output",
          toolCalls: [
            {
              tool: "read_file",
              callId: "tool-1",
              input: { path: "README.md" },
              status: "completed",
            },
          ],
          usage: { inputTokens: 10, outputTokens: 20 },
          error: null,
          durationMs: 99,
          structured: {
            ok: false,
            parsed: null,
            structured: null,
            rawOutput: "completed task execution output",
            error:
              "Structured result tool 'submit_structured_result' was not called; raw assistant text fallback is unreliable.",
            reliability: "fallback_text",
            sessionId: "sess-exec",
            runId: "run-exec",
          },
          feature: null,
        },
        events: [],
      }),
    });

    try {
      const res = await fetch("http://127.0.0.1:17680/v1/execution/task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instructions: "Do the work" }),
      });
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({
        output: "completed task execution output",
        error: null,
        structured: { ok: false, reliability: "fallback_text" },
      });
    } finally {
      server.stop(true);
    }
  });

  it("feature stream endpoint returns SSE done payload with explicit semantics", async () => {
    const server = startBridgeServer({
      port: 17681,
      logger: createBridgeLogger({ minLevel: "error", sink: () => {} }),
      checkCLIAvailable: async () => true,
      executeRequest: async () => ({
        response: {
          sessionId: "sess-stream",
          output: "plan output",
          toolCalls: [
            {
              tool: "generate_task_plan_graph",
              callId: "call-1",
              input: { summary: "Plan ready", nodes: [], edges: [] },
              status: "completed",
            },
          ],
          usage: null,
          error: null,
          durationMs: 5,
          structured: null,
          feature: {
            feature: "generate_plan",
            source: "business_tool",
            toolName: "generate_task_plan_graph",
            payload: { summary: "Plan ready", nodes: [], edges: [] },
          },
        },
        events: [
          {
            type: "tool_use",
            tool: "generate_task_plan_graph",
            callId: "call-1",
            input: { title: "Plan task" },
          },
        ],
      }),
    });

    try {
      const res = await fetch(
        "http://127.0.0.1:17681/v1/features/generate-plan/stream",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: { taskId: "task-1", title: "Plan task" } }),
        },
      );
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("event: event");
      expect(text).toContain("generate_task_plan_graph");
      expect(text).toContain("event: done");
      expect(text).toContain('"feature":{"feature":"generate_plan"');
    } finally {
      server.stop(true);
    }
  });
});

describe("openclaw bridge parsing", () => {
  it("parses NDJSON lines", () => {
    const events = parseNDJSONEvents([
      '{"type":"text","text":"hello"}',
      "not-json",
      '{"type":"tool_use","tool":"submit_structured_result","callId":"call-1","input":{"schemaName":"demo","schemaVersion":"1.0.0","status":"success","confidence":1,"result":{"value":1},"missingFields":[],"followUpQuestions":[],"notes":[]}}',
    ]);

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: "text", text: "hello" });
    expect(events[1]).toMatchObject({
      type: "tool_use",
      tool: "submit_structured_result",
    });
  });

  it("extracts structured result from tool call args and preserves business tool calls", () => {
    const response = buildStructuredResult({
      sessionId: "sess-test",
      runId: "run-1",
      output: "human summary",
      error: null,
      toolCalls: [
        {
          tool: "suggest_task_completions",
          callId: "call-biz-1",
          status: "completed",
          input: {
            input: "参加美国总统竞选",
          },
          result: "generated 1 suggestion",
        },
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
    expect(response.bridgeToolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tool: "suggest_task_completions" }),
        expect.objectContaining({ tool: "submit_structured_result" }),
      ]),
    );
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

  it("extracts submit_structured_result from legacy single-blob output metadata", () => {
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
      status: "completed" as const,
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
    expect(response.rawToolCall).toMatchObject({
      tool: "submit_structured_result",
      callId: "legacy-call-1",
    });
  });

  it("prefers explicit legacy extraction errors over generic fallback messaging", () => {
    const response = buildStructuredResult({
      sessionId: "sess-legacy-error",
      runId: "run-legacy-error",
      output: "plain text only",
      error: null,
      toolCalls: [],
      legacyExtractionError:
        "Legacy blob detected but did not contain tool metadata",
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
