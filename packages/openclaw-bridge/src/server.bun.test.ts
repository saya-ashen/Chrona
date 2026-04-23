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

  it("reports bridge online but cli unavailable via health endpoint", async () => {
    const server = startBridgeServer({
      port: 17682,
      logger: createBridgeLogger({ minLevel: "error", sink: () => {} }),
      checkCLIAvailable: async () => false,
    });

    try {
      const res = await fetch("http://127.0.0.1:17682/v1/health");
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({
        status: "unavailable",
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

  it("serves suggest stream endpoint with SSE event and done payloads", async () => {
    const server = startBridgeServer({
      port: 17683,
      logger: createBridgeLogger({ minLevel: "error", sink: () => {} }),
      checkCLIAvailable: async () => true,
      executeRequest: async () => ({
        response: {
          sessionId: "sess-suggest-stream",
          output: "",
          toolCalls: [
            {
              tool: "suggest_task_completions",
              callId: "call-1",
              input: { suggestions: [{ title: "Write tests" }] },
              status: "completed",
            },
          ],
          usage: null,
          error: null,
          durationMs: 6,
          structured: {
            ok: true,
            parsed: { suggestions: [{ title: "Write tests" }] },
            source: "business_tool",
            feature: "suggest",
            toolName: "suggest_task_completions",
            rawOutput: "",
            error: null,
            validationIssues: [],
            sessionId: "sess-suggest-stream",
            runId: "run-suggest-stream",
            bridgeToolCalls: [
              {
                tool: "suggest_task_completions",
                callId: "call-1",
                input: { suggestions: [{ title: "Write tests" }] },
                status: "completed",
              },
            ],
          },
          feature: {
            feature: "suggest",
            source: "business_tool",
            toolName: "suggest_task_completions",
            payload: { suggestions: [{ title: "Write tests" }] },
          },
        },
        events: [
          {
            type: "tool_use",
            tool: "suggest_task_completions",
            callId: "call-1",
            input: { input: "write tests", kind: "general" },
          },
        ],
      }),
    });

    try {
      const res = await fetch("http://127.0.0.1:17683/v1/features/suggest/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: { input: "write tests", kind: "general" } }),
      });
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("event: event");
      expect(text).toContain("suggest_task_completions");
      expect(text).toContain("event: done");
      expect(text).toContain('"feature":{"feature":"suggest"');
    } finally {
      server.stop(true);
    }
  });

  it("serves analyze-conflicts endpoint with explicit feature payloads", async () => {
    const server = startBridgeServer({
      port: 17684,
      logger: createBridgeLogger({ minLevel: "error", sink: () => {} }),
      checkCLIAvailable: async () => true,
      executeRequest: async (route, request) => {
        expect(route).toEqual({ kind: "feature", feature: "conflicts", stream: false });
        expect(request).toEqual({
          input: { tasks: [{ id: "t1", title: "Task", status: "open" }] },
        });
        return {
          response: {
            sessionId: "sess-conflicts",
            output: "{}",
            toolCalls: [],
            usage: null,
            error: null,
            durationMs: 11,
            structured: {
              ok: true,
              parsed: {
                conflicts: [{ id: "c1", type: "time_overlap", severity: "high", taskIds: ["t1"], description: "Overlap" }],
                resolutions: [],
                summary: "1 conflict",
              },
              source: "output_json",
              feature: "conflicts",
              toolName: null,
              rawOutput: "{}",
              error: null,
              validationIssues: [],
              sessionId: "sess-conflicts",
              runId: "run-conflicts",
              bridgeToolCalls: [],
            },
            feature: {
              feature: "conflicts",
              source: "output_json",
              payload: {
                conflicts: [{ id: "c1", type: "time_overlap", severity: "high", taskIds: ["t1"], description: "Overlap" }],
                resolutions: [],
                summary: "1 conflict",
              },
            },
          },
          events: [],
        };
      },
    });

    try {
      const res = await fetch("http://127.0.0.1:17684/v1/features/analyze-conflicts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: { tasks: [{ id: "t1", title: "Task", status: "open" }] } }),
      });
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({
        feature: { feature: "conflicts", source: "output_json" },
      });
    } finally {
      server.stop(true);
    }
  });

  it("serves suggest-timeslot endpoint with explicit feature payloads", async () => {
    const server = startBridgeServer({
      port: 17685,
      logger: createBridgeLogger({ minLevel: "error", sink: () => {} }),
      checkCLIAvailable: async () => true,
      executeRequest: async () => ({
        response: {
          sessionId: "sess-timeslots",
          output: "{}",
          toolCalls: [],
          usage: null,
          error: null,
          durationMs: 12,
          structured: {
            ok: true,
            parsed: { slots: [{ startAt: "2026-04-24T09:00:00Z", endAt: "2026-04-24T10:00:00Z", score: 0.9, reason: "Free slot" }], reasoning: "Best morning slot" },
            source: "output_json",
            feature: "timeslots",
            toolName: null,
            rawOutput: "{}",
            error: null,
            validationIssues: [],
            sessionId: "sess-timeslots",
            runId: "run-timeslots",
            bridgeToolCalls: [],
          },
          feature: {
            feature: "timeslots",
            source: "output_json",
            payload: { slots: [{ startAt: "2026-04-24T09:00:00Z", endAt: "2026-04-24T10:00:00Z", score: 0.9, reason: "Free slot" }], reasoning: "Best morning slot" },
          },
        },
        events: [],
      }),
    });

    try {
      const res = await fetch("http://127.0.0.1:17685/v1/features/suggest-timeslot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: { taskTitle: "Write tests", estimatedMinutes: 60, currentSchedule: [] } }),
      });
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({
        feature: { feature: "timeslots", source: "output_json" },
      });
    } finally {
      server.stop(true);
    }
  });

  it("serves chat endpoint with explicit feature payloads", async () => {
    const server = startBridgeServer({
      port: 17686,
      logger: createBridgeLogger({ minLevel: "error", sink: () => {} }),
      checkCLIAvailable: async () => true,
      executeRequest: async () => ({
        response: {
          sessionId: "sess-chat",
          output: "Hello from chat",
          toolCalls: [],
          usage: null,
          error: null,
          durationMs: 7,
          structured: {
            ok: true,
            parsed: { content: "Hello from chat" },
            source: "assistant_text",
            feature: "chat",
            toolName: null,
            rawOutput: "Hello from chat",
            error: null,
            validationIssues: [],
            sessionId: "sess-chat",
            runId: "run-chat",
            bridgeToolCalls: [],
          },
          feature: {
            feature: "chat",
            source: "assistant_text",
            payload: { content: "Hello from chat" },
          },
        },
        events: [],
      }),
    });

    try {
      const res = await fetch("http://127.0.0.1:17686/v1/features/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: { messages: [{ role: "user", content: "Hello?" }] } }),
      });
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({
        feature: { feature: "chat", source: "assistant_text" },
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
            source: "fallback_text",
            rawOutput: "completed task execution output",
            error:
              "No feature-specific payload was extracted; raw assistant text fallback is unreliable.",
            validationIssues: [],
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
        structured: { ok: false, source: "fallback_text" },
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

  it("serves execution stream endpoint with SSE done payloads", async () => {
    const server = startBridgeServer({
      port: 17687,
      logger: createBridgeLogger({ minLevel: "error", sink: () => {} }),
      checkCLIAvailable: async () => true,
      executeRequest: async () => ({
        response: {
          sessionId: "sess-exec-stream",
          output: "done execution",
          toolCalls: [],
          usage: null,
          error: null,
          durationMs: 3,
          structured: {
            ok: false,
            parsed: null,
            source: "fallback_text",
            rawOutput: "done execution",
            error: "No feature-specific payload was extracted; raw assistant text fallback is unreliable.",
            validationIssues: [],
            sessionId: "sess-exec-stream",
            runId: "run-exec-stream",
            bridgeToolCalls: [],
          },
          feature: null,
        },
        events: [{ type: "text", text: "running" }],
      }),
    });

    try {
      const res = await fetch("http://127.0.0.1:17687/v1/execution/task/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instructions: "Do the work" }),
      });
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("event: event");
      expect(text).toContain("running");
      expect(text).toContain("event: done");
      expect(text).toContain("done execution");
    } finally {
      server.stop(true);
    }
  });

  it("returns 204 for OPTIONS with CORS headers", async () => {
    const server = startBridgeServer({
      port: 17688,
      logger: createBridgeLogger({ minLevel: "error", sink: () => {} }),
      checkCLIAvailable: async () => true,
    });

    try {
      const res = await fetch("http://127.0.0.1:17688/v1/features/suggest", {
        method: "OPTIONS",
      });
      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    } finally {
      server.stop(true);
    }
  });

  it("returns 404 for unknown routes", async () => {
    const server = startBridgeServer({
      port: 17689,
      logger: createBridgeLogger({ minLevel: "error", sink: () => {} }),
      checkCLIAvailable: async () => true,
    });

    try {
      const res = await fetch("http://127.0.0.1:17689/v1/unknown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(404);
      await expect(res.json()).resolves.toEqual({ error: "Not found" });
    } finally {
      server.stop(true);
    }
  });

  it("returns 400 for invalid JSON request bodies", async () => {
    const server = startBridgeServer({
      port: 17690,
      logger: createBridgeLogger({ minLevel: "error", sink: () => {} }),
      checkCLIAvailable: async () => true,
    });

    try {
      const res = await fetch("http://127.0.0.1:17690/v1/features/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{bad-json",
      });
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({ error: "Invalid JSON body" });
    } finally {
      server.stop(true);
    }
  });

  it("returns 400 when feature input is missing", async () => {
    const server = startBridgeServer({
      port: 17691,
      logger: createBridgeLogger({ minLevel: "error", sink: () => {} }),
      checkCLIAvailable: async () => true,
    });

    try {
      const res = await fetch("http://127.0.0.1:17691/v1/features/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "sess-1" }),
      });
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({ error: "Missing required field: input" });
    } finally {
      server.stop(true);
    }
  });

  it("returns 400 when execution instructions are missing", async () => {
    const server = startBridgeServer({
      port: 17692,
      logger: createBridgeLogger({ minLevel: "error", sink: () => {} }),
      checkCLIAvailable: async () => true,
    });

    try {
      const res = await fetch("http://127.0.0.1:17692/v1/execution/task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "sess-1" }),
      });
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({ error: "Missing required field: instructions" });
    } finally {
      server.stop(true);
    }
  });

  it("returns 500 SSE error events when a streaming route execution throws", async () => {
    const server = startBridgeServer({
      port: 17693,
      logger: createBridgeLogger({ minLevel: "error", sink: () => {} }),
      checkCLIAvailable: async () => true,
      executeRequest: async () => {
        throw new Error("stream boom");
      },
    });

    try {
      const res = await fetch("http://127.0.0.1:17693/v1/features/suggest/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: { input: "write tests", kind: "general" } }),
      });
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(text).toContain("event: error");
      expect(text).toContain("stream boom");
    } finally {
      server.stop(true);
    }
  });

  it("returns 500 JSON errors when a blocking route execution throws", async () => {
    const server = startBridgeServer({
      port: 17694,
      logger: createBridgeLogger({ minLevel: "error", sink: () => {} }),
      checkCLIAvailable: async () => true,
      executeRequest: async () => {
        throw new Error("blocking boom");
      },
    });

    try {
      const res = await fetch("http://127.0.0.1:17694/v1/features/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: { messages: [{ role: "user", content: "hello" }] } }),
      });
      expect(res.status).toBe(500);
      await expect(res.json()).resolves.toEqual({ error: "blocking boom" });
    } finally {
      server.stop(true);
    }
  });

  it("returns 422 when a feature endpoint has no valid feature payload", async () => {
    const server = startBridgeServer({
      port: 17695,
      logger: createBridgeLogger({ minLevel: "error", sink: () => {} }),
      checkCLIAvailable: async () => true,
      executeRequest: async () => ({
        response: {
          sessionId: "sess-invalid-feature",
          output: "plain text only",
          toolCalls: [],
          usage: null,
          error: "Feature 'suggest' requires business tool 'suggest_task_completions' but no matching payload was extracted",
          durationMs: 4,
          structured: {
            ok: false,
            parsed: null,
            source: "fallback_text",
            feature: "suggest",
            toolName: null,
            rawOutput: "plain text only",
            error: "Feature 'suggest' requires business tool 'suggest_task_completions' but no matching payload was extracted",
            validationIssues: [],
            sessionId: "sess-invalid-feature",
            runId: "run-invalid-feature",
            bridgeToolCalls: [],
          },
          feature: null,
        },
        events: [],
      }),
    });

    try {
      const res = await fetch("http://127.0.0.1:17695/v1/features/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: { input: "write tests", kind: "general" } }),
      });
      expect(res.status).toBe(422);
      await expect(res.json()).resolves.toMatchObject({
        error: expect.stringContaining("suggest_task_completions"),
      });
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
      '{"type":"tool_use","tool":"generate_task_plan_graph","callId":"call-1","input":{"summary":"demo","nodes":[],"edges":[]}}',
    ]);

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: "text", text: "hello" });
    expect(events[1]).toMatchObject({
      type: "tool_use",
      tool: "generate_task_plan_graph",
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
      ],
      feature: "suggest",
      featurePayload: { input: "参加美国总统竞选" },
      featureToolName: "suggest_task_completions",
      featureSource: "business_tool",
    });

    expect(response.ok).toBe(true);
    expect(response.parsed).toEqual({ input: "参加美国总统竞选" });
    expect(response.source).toBe("business_tool");
    expect(response.toolName).toBe("suggest_task_completions");
    expect(response.bridgeToolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tool: "suggest_task_completions" }),
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
    expect(response.source).toBe("fallback_text");
    expect(response.error).toContain("No feature-specific payload");
  });

  it("accepts legacy business-tool extraction as a valid feature payload", () => {
    const legacyToolCall = {
      tool: "generate_task_plan_graph",
      callId: "legacy-call-1",
      input: { summary: "need more info", nodes: [], edges: [] },
      status: "completed" as const,
    };

    const response = buildStructuredResult({
      sessionId: "sess-legacy-tool",
      runId: "run-legacy",
      output: "已生成结构化结果",
      error: null,
      toolCalls: [],
      legacyToolCalls: [legacyToolCall],
      feature: "generate_plan",
      featurePayload: legacyToolCall.input,
      featureToolName: "generate_task_plan_graph",
      featureSource: "business_tool",
    });

    expect(response.ok).toBe(true);
    expect(response.source).toBe("business_tool");
    expect(response.toolName).toBe("generate_task_plan_graph");
    expect(response.parsed).toEqual({ summary: "need more info", nodes: [], edges: [] });
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
    expect(response.error).not.toContain("No feature-specific payload");
  });

  it("parses tool calls from session transcript jsonl content", () => {
    const transcript = [
      '{"type":"message","message":{"role":"assistant","content":[{"type":"toolCall","id":"call-1","name":"generate_task_plan_graph","arguments":{"summary":"ok","nodes":[],"edges":[]}}]}}',
      '{"type":"message","message":{"role":"toolResult","toolCallId":"call-1","toolName":"generate_task_plan_graph","details":{"summary":"ok","nodes":[],"edges":[]},"isError":false}}',
    ].join("\n");

    const toolCalls = parseToolCallsFromSessionTranscript(transcript);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toMatchObject({
      tool: "generate_task_plan_graph",
      callId: "call-1",
      status: "completed",
      input: {
        summary: "ok",
      },
    });
  });
});
