import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import {
  buildGatewayBody,
  createBridgeApp,
  createBridgeLogger,
  gatewayHeaders,
  resetBridgeSessions,
  startBridgeServer,
  summarizeBridgeRequest,
  type BridgeExecutionTaskRequest,
  type BridgeFeatureRequest,
  type BridgeLogEntry,
  type BridgeResponse,
  type ExecutionResult,
  type RouteKind,
} from "./server";

const realFetch = globalThis.fetch;
const originalEnv = {
  OPENCLAW_MODEL: process.env.OPENCLAW_MODEL,
  OPENCLAW_MESSAGE_CHANNEL: process.env.OPENCLAW_MESSAGE_CHANNEL,
  OPENCLAW_OPENRESPONSES_URL: process.env.OPENCLAW_OPENRESPONSES_URL,
  OPENCLAW_GATEWAY_URL: process.env.OPENCLAW_GATEWAY_URL,
};

beforeEach(() => {
  delete process.env.OPENCLAW_MODEL;
  delete process.env.OPENCLAW_MESSAGE_CHANNEL;
  process.env.OPENCLAW_OPENRESPONSES_URL = "http://127.0.0.1:18789";
  delete process.env.OPENCLAW_GATEWAY_URL;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  resetBridgeSessions();

  if (originalEnv.OPENCLAW_MODEL === undefined) {
    delete process.env.OPENCLAW_MODEL;
  } else {
    process.env.OPENCLAW_MODEL = originalEnv.OPENCLAW_MODEL;
  }

  if (originalEnv.OPENCLAW_MESSAGE_CHANNEL === undefined) {
    delete process.env.OPENCLAW_MESSAGE_CHANNEL;
  } else {
    process.env.OPENCLAW_MESSAGE_CHANNEL = originalEnv.OPENCLAW_MESSAGE_CHANNEL;
  }

  if (originalEnv.OPENCLAW_OPENRESPONSES_URL === undefined) {
    delete process.env.OPENCLAW_OPENRESPONSES_URL;
  } else {
    process.env.OPENCLAW_OPENRESPONSES_URL = originalEnv.OPENCLAW_OPENRESPONSES_URL;
  }

  if (originalEnv.OPENCLAW_GATEWAY_URL === undefined) {
    delete process.env.OPENCLAW_GATEWAY_URL;
  } else {
    process.env.OPENCLAW_GATEWAY_URL = originalEnv.OPENCLAW_GATEWAY_URL;
  }
});

function makeSSEResponse(events: Array<{ event: string; data: Record<string, unknown> }>) {
  const payload = events
    .map(({ event, data }) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    .join("");
  return new Response(payload, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function getRequestUrl(input: Request | URL | string): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function makeResponse(overrides: Partial<BridgeResponse> = {}): BridgeResponse {
  return {
    sessionId: "sess-1",
    output: "ok",
    toolCalls: [],
    toolCallOutputs: [],
    usage: null,
    error: null,
    durationMs: 1,
    structured: null,
    feature: null,
    ...overrides,
  };
}

describe("openclaw bridge gateway helpers", () => {
  it("summarizes request metadata without payload body leaks", () => {
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

  it("builds gateway body with tools + forced tool_choice for generate_plan", () => {
    const request: BridgeFeatureRequest<Record<string, unknown>> = {
      sessionId: "sess-plan",
      sessionKey: "tenant-a:plan-1",
      input: { taskId: "task-1", title: "Plan" },
      timeout: 30,
    };

    const body = buildGatewayBody(
      { kind: "feature", feature: "generate_plan", stream: false },
      request,
      "sess-plan",
    );

    expect(body.model).toBe("openclaw");
    expect(body.user).toBe("tenant-a:plan-1");
    expect(body.instructions).toBeString();
    expect(body.input).toBe(JSON.stringify({ taskId: "task-1", title: "Plan" }));
    expect(body.tools).toBeArray();
    expect(body.tool_choice).toEqual({
      type: "function",
      function: { name: "generate_task_plan_graph" },
    });
  });

  it("builds execution body using openresponses session/model semantics", () => {
    const request: BridgeExecutionTaskRequest = {
      sessionId: "sess-exec",
      sessionKey: "tenant-a:workflow-7788",
      instructions: "Do work",
      taskId: "task-1",
      workspaceId: "ws-1",
      taskTitle: "Run task",
      runtimeInput: { model: "gpt-5", maxTokens: 777 },
    };

    const body = buildGatewayBody(
      { kind: "execution", stream: false },
      request,
      "sess-exec",
      { defaultPort: 7677, gatewayHttpUrl: "http://gateway", gatewayToken: "", agentId: "main", model: "gpt-5.4" },
    );

    expect(body.tool_choice).toBeUndefined();
    expect(body.tools).toBeUndefined();
    expect(body.model).toBe("gpt-5.4");
    expect(body.user).toBe("tenant-a:workflow-7788");
    expect(body.instructions).toBe("Do work");
    expect(body.max_output_tokens).toBe(777);
    expect(String(body.input)).toContain("Task title: Run task");
    expect(String(body.input)).toContain('"model": "gpt-5"');
  });

  it("adds openclaw headers for model, message channel, and explicit session key", () => {
    const headers = gatewayHeaders(
      {
        defaultPort: 7677,
        gatewayHttpUrl: "http://gateway",
        gatewayToken: "secret",
        agentId: "task-agent",
        model: "gpt-5.4",
        messageChannel: "internal_task_dispatcher",
      },
      {
        sessionId: "sess-1",
        sessionKey: "tenant-a:workflow-7788",
        instructions: "Run task",
      },
    );

    expect(headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer secret",
      "x-openclaw-agent-id": "task-agent",
      "x-openclaw-message-channel": "internal_task_dispatcher",
      "x-openclaw-model": "gpt-5.4",
      "x-openclaw-session-key": "tenant-a:workflow-7788",
    });
  });

  it("persists previous_response_id across gateway executions for a shared session key", async () => {
    const port = 18669;
    const requestBodies: Array<Record<string, unknown>> = [];

    globalThis.fetch = (async (input, init) => {
      const url = getRequestUrl(input);
      if (url.includes("/v1/health")) {
        return Response.json({ status: "ok" });
      }
      if (url.includes("/v1/responses")) {
        requestBodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
        return Response.json({
          id: `resp-${requestBodies.length}`,
          status: "completed",
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: `done ${requestBodies.length}` }],
            },
          ],
        });
      }
      return realFetch(input, init);
    }) as typeof fetch;

    const server = startBridgeServer({
      port,
      logger: createBridgeLogger({ minLevel: "error", sink: () => {} }),
    });

    try {
      const payload = {
        sessionKey: "tenant-a:workflow-7788",
        instructions: "Run task",
      };

      const first = await fetch(`http://127.0.0.1:${port}/v1/execution/task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      expect(first.status).toBe(200);

      const second = await fetch(`http://127.0.0.1:${port}/v1/execution/task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      expect(second.status).toBe(200);

      expect(requestBodies).toHaveLength(2);
      expect(requestBodies[0]?.user).toBe("tenant-a:workflow-7788");
      expect(requestBodies[0]?.previous_response_id).toBeUndefined();
      expect(requestBodies[1]?.user).toBe("tenant-a:workflow-7788");
      expect(requestBodies[1]?.previous_response_id).toBe("resp-1");
    } finally {
      server.stop(true);
    }
  });

  it("emits structured log entries through sink", () => {
    const entries: BridgeLogEntry[] = [];
    const logger = createBridgeLogger({
      minLevel: "info",
      sink: (entry) => entries.push(entry),
    });

    logger.info("bridge.started", { port: 7677 });
    logger.debug("bridge.debug", { ignored: true });
    logger.error("bridge.failed", { reason: "boom" });

    expect(entries).toHaveLength(2);
    expect(entries[0]?.event).toBe("bridge.started");
    expect(entries[1]?.event).toBe("bridge.failed");
  });
});

describe("openclaw bridge hono app", () => {
  it("health route responds through hono app", async () => {
    const app = createBridgeApp({
      logger: createBridgeLogger({ minLevel: "error", sink: () => {} }),
      checkGatewayAvailable: async () => true,
      executeRequest: async () => {
        throw new Error("should not be called");
      },
    });

    const res = await app.request("http://bridge.local/v1/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "ok",
      gateway: process.env.OPENCLAW_OPENRESPONSES_URL ?? process.env.OPENCLAW_GATEWAY_URL ?? "http://127.0.0.1:18789",
    });
  });

  it("explicit feature and execution routes exist through hono app", async () => {
    const calls: Array<{ route: RouteKind; body: BridgeFeatureRequest | BridgeExecutionTaskRequest }> = [];
    const executeRequest = async (
      route: RouteKind,
      body: BridgeFeatureRequest | BridgeExecutionTaskRequest,
    ): Promise<ExecutionResult> => {
      calls.push({ route, body });
      return { response: makeResponse(), events: [] };
    };
    const app = createBridgeApp({
      logger: createBridgeLogger({ minLevel: "error", sink: () => {} }),
      checkGatewayAvailable: async () => true,
      executeRequest,
    });

    const featureRes = await app.request("http://bridge.local/v1/features/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: { title: "test" } }),
    });
    const executionRes = await app.request("http://bridge.local/v1/execution/task", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instructions: "run" }),
    });

    expect(featureRes.status).toBe(200);
    expect(executionRes.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.route).toEqual({ kind: "feature", feature: "suggest", stream: false });
    expect(calls[1]?.route).toEqual({ kind: "execution", stream: false });
  });

  it("streaming endpoint emits done event semantics", async () => {
    const app = createBridgeApp({
      logger: createBridgeLogger({ minLevel: "error", sink: () => {} }),
      checkGatewayAvailable: async () => true,
      executeRequest: async () => ({
        response: makeResponse({ sessionId: "stream-session" }),
        events: [{ type: "status", sessionId: "stream-session", status: "in_progress" }],
      }),
    });

    const res = await app.request("http://bridge.local/v1/execution/task/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instructions: "run" }),
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("event: event");
    expect(text).toContain('"type":"status"');
    expect(text).toContain("event: done");
  });

  it("streaming endpoint emits error event semantics", async () => {
    const app = createBridgeApp({
      logger: createBridgeLogger({ minLevel: "error", sink: () => {} }),
      checkGatewayAvailable: async () => true,
      executeRequest: async () => {
        throw new Error("kaboom");
      },
    });

    const res = await app.request("http://bridge.local/v1/execution/task/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instructions: "run" }),
    });

    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toContain("event: error");
    expect(text).toContain("kaboom");
  });
});

describe("openclaw bridge gateway endpoints", () => {
  it("extracts generate_plan payload from function_call.arguments", async () => {
    const port = 18670;

    globalThis.fetch = (async (input, _init) => {
      const url = getRequestUrl(input);
      if (url.includes("/v1/health")) {
        return Response.json({ status: "ok" });
      }
      if (url.includes("/v1/responses")) {
        return Response.json({
          id: "resp-plan-1",
          status: "completed",
          output: [
            {
              type: "function_call",
              id: "fc-1",
              call_id: "call-1",
              name: "generate_task_plan_graph",
              arguments: JSON.stringify({
                summary: "Plan ready",
                nodes: [{ id: "n1", title: "Step 1" }],
                edges: [],
              }),
            },
          ],
          usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
        });
      }
      return realFetch(input, _init);
    }) as typeof fetch;

    const server = startBridgeServer({
      port,
      logger: createBridgeLogger({ minLevel: "error", sink: () => {} }),
    });

    try {
      const res = await fetch(`http://127.0.0.1:${port}/v1/features/generate-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: { taskId: "task-1", title: "Plan task" } }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.feature).toMatchObject({
        feature: "generate_plan",
        source: "business_tool",
        toolName: "generate_task_plan_graph",
      });
      expect(body.usage).toEqual({ inputTokens: 10, outputTokens: 20, totalTokens: 30 });
    } finally {
      server.stop(true);
    }
  });

  it("returns 422 when required function_call is missing", async () => {
    const port = 18671;

    globalThis.fetch = (async (input, _init) => {
      const url = getRequestUrl(input);
      if (url.includes("/v1/responses")) {
        return Response.json({
          id: "resp-plan-2",
          status: "completed",
          output: [{ type: "message", content: [{ type: "output_text", text: "text only" }] }],
        });
      }
      return realFetch(input, _init);
    }) as typeof fetch;

    const server = startBridgeServer({
      port,
      logger: createBridgeLogger({ minLevel: "error", sink: () => {} }),
    });

    try {
      const res = await fetch(`http://127.0.0.1:${port}/v1/features/generate-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: { taskId: "task-1", title: "Plan task" } }),
      });
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(String(body.error)).toContain("requires function_call");
    } finally {
      server.stop(true);
    }
  });

  it("extracts suggest and dispatch payloads from function_call.arguments", async () => {
    const port = 18672;

    globalThis.fetch = (async (input, init) => {
      const url = getRequestUrl(input);
      if (url.includes("/v1/responses")) {
        const req = JSON.parse(String(init?.body ?? "{}")) as { tool_choice?: { function?: { name?: string } } };
        const toolName = req.tool_choice?.function?.name;
        if (toolName === "suggest_task_completions") {
          return Response.json({
            id: "resp-suggest",
            status: "completed",
            output: [
              {
                type: "function_call",
                call_id: "call-suggest",
                name: "suggest_task_completions",
                arguments: JSON.stringify({ suggestions: [{ title: "Write tests" }] }),
              },
            ],
          });
        }
        return Response.json({
          id: "resp-dispatch",
          status: "completed",
          output: [
            {
              type: "function_call",
              call_id: "call-dispatch",
              name: "dispatch_next_task_action",
              arguments: JSON.stringify({
                schemaName: "task_dispatch_decision",
                schemaVersion: "1.0.0",
                action: "materialize_node",
                targetNodeId: "node-1",
                safety: { requiresHumanApproval: false, riskLevel: "low" },
                confidence: 0.9,
                reason: "Node is ready",
              }),
            },
          ],
        });
      }
      return realFetch(input, init);
    }) as typeof fetch;

    const server = startBridgeServer({
      port,
      logger: createBridgeLogger({ minLevel: "error", sink: () => {} }),
    });

    try {
      const suggestRes = await fetch(`http://127.0.0.1:${port}/v1/features/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: { input: "write tests", kind: "general" } }),
      });
      expect(suggestRes.status).toBe(200);

      const dispatchRes = await fetch(`http://127.0.0.1:${port}/v1/features/dispatch-task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: { taskId: "t1", workspaceId: "w1" } }),
      });
      expect(dispatchRes.status).toBe(200);
      const dispatchBody = await dispatchRes.json();
      expect(dispatchBody.feature).toMatchObject({
        feature: "dispatch_task",
        toolName: "dispatch_next_task_action",
      });
    } finally {
      server.stop(true);
    }
  });

  it("execution/task returns output + function_call + function_call_output + usage", async () => {
    const port = 18673;

    globalThis.fetch = (async (input, init) => {
      const url = getRequestUrl(input);
      if (url.includes("/v1/responses")) {
        const req = JSON.parse(String(init?.body ?? "{}")) as { tools?: unknown[] };
        expect(req.tools).toBeUndefined();

        return Response.json({
          id: "resp-exec-1",
          status: "completed",
          output: [
            {
              type: "function_call",
              call_id: "call-1",
              name: "read_file",
              arguments: JSON.stringify({ path: "README.md" }),
            },
            {
              type: "function_call_output",
              call_id: "call-1",
              output: "file-content",
            },
            {
              type: "message",
              content: [{ type: "output_text", text: "Execution done" }],
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 7, total_tokens: 10 },
        });
      }
      return realFetch(input, init);
    }) as typeof fetch;

    const server = startBridgeServer({
      port,
      logger: createBridgeLogger({ minLevel: "error", sink: () => {} }),
    });

    try {
      const res = await fetch(`http://127.0.0.1:${port}/v1/execution/task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instructions: "run it" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.output).toBe("Execution done");
      expect(body.toolCalls).toHaveLength(1);
      expect(body.toolCallOutputs).toHaveLength(1);
      expect(body.usage).toEqual({ inputTokens: 3, outputTokens: 7, totalTokens: 10 });
    } finally {
      server.stop(true);
    }
  });

  it("streaming endpoint maps gateway SSE to bridge events", async () => {
    const port = 18674;

    globalThis.fetch = (async (input, _init) => {
      const url = getRequestUrl(input);
      if (url.includes("/v1/responses")) {
        return makeSSEResponse([
          {
            event: "response.created",
            data: { response: { id: "resp-1", status: "in_progress" } },
          },
          {
            event: "response.output_text.delta",
            data: { delta: "Hello " },
          },
          {
            event: "response.output_item.added",
            data: {
              item: {
                type: "function_call",
                call_id: "call-1",
                name: "generate_task_plan_graph",
                arguments: JSON.stringify({ summary: "s", nodes: [], edges: [] }),
              },
            },
          },
          {
            event: "response.completed",
            data: {
              response: {
                id: "resp-1",
                status: "completed",
                output: [
                  {
                    type: "function_call",
                    call_id: "call-1",
                    name: "generate_task_plan_graph",
                    arguments: JSON.stringify({ summary: "s", nodes: [], edges: [] }),
                  },
                  {
                    type: "message",
                    content: [{ type: "output_text", text: "Hello world" }],
                  },
                ],
                usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
              },
            },
          },
        ]);
      }
      return realFetch(input, _init);
    }) as typeof fetch;

    const server = startBridgeServer({
      port,
      logger: createBridgeLogger({ minLevel: "error", sink: () => {} }),
    });

    try {
      const res = await fetch(`http://127.0.0.1:${port}/v1/features/generate-plan/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: { taskId: "task-1", title: "Plan task" } }),
      });
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('"type":"status"');
      expect(text).toContain('"type":"text_delta"');
      expect(text).toContain('"type":"tool_call"');
      expect(text).toContain("event: done");
    } finally {
      server.stop(true);
    }
  });
});
