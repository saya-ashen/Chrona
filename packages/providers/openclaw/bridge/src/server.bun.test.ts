import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import {
  buildGatewayBody,
  createBridgeApp,
  createBridgeLogger,
  gatewayHeaders,
  resetBridgeSessions,
  setSessionPendingToolOutputs,
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
      instructionsChars: 0,
      input: { keys: ["title", "workspaceId"] },
    });
  });

  it("builds gateway body with tools + forced tool_choice for generate_plan", () => {
    const request: BridgeFeatureRequest<Record<string, unknown>> = {
      sessionId: "sess-plan",
      sessionKey: "tenant-a:plan-1",
      input: {
        task: {
          title: "Plan thesis defense slides",
          description: "Prepare a concise deck for the final defense",
          estimatedDurationMinutes: 180,
        },
      },
      timeout: 30,
    };

    const body = buildGatewayBody(
      { kind: "feature", feature: "generate_plan", stream: false },
      request,
      "sess-plan",
    );

    expect(body.model).toBe("openclaw");
    expect(body.user).toBe("tenant-a:plan-1");
    expect(String(body.instructions)).toContain("You are Chrona's task planning assistant");
    expect(String(body.instructions)).toContain("generate_task_plan_graph");
    expect(String(body.instructions)).toContain("Do not ask follow-up questions");
    expect(String(body.instructions)).toContain("Call generate_task_plan_graph exactly once");
    expect(body.input).toEqual([
      {
        type: "input_text",
        text: expect.stringContaining("Create an execution-ready plan graph for the task below."),
      },
    ]);
    const inputText = ((body.input as Array<{ type: string; text?: string }>)[0]?.text) ?? "";
    expect(inputText).toContain("Use only the information provided");
    expect(inputText).toContain("Make reasonable assumptions");
    expect(inputText).toContain("Task to plan");
    expect(inputText).toContain("Title: Plan thesis defense slides");
    expect(inputText).toContain("Description: Prepare a concise deck for the final defense");
    expect(inputText).toContain("Estimated duration: 180 minutes");
    expect(inputText).toContain("Output requirements");
    expect(inputText).toContain("nodes");
    expect(inputText).toContain("edges");
    expect(inputText).not.toContain("taskId");
    expect(inputText).not.toContain("sessionKey");
    expect(body.tools).toEqual([
      {
        type: "function",
        name: "generate_task_plan_graph",
        description: expect.stringContaining("Create and persist the Chrona task plan graph"),
        parameters: expect.any(Object),
      },
    ]);
    const tool = (body.tools as Array<{ parameters: Record<string, unknown> }>)[0];
    const parameters = tool.parameters as {
      required?: string[];
      properties?: Record<string, { required?: string[]; items?: { required?: string[] } }>;
    };
    expect(parameters.required).toEqual(expect.arrayContaining(["title", "goal", "nodes", "edges"]));
    expect(parameters.properties?.nodes?.items?.required).toEqual(
      expect.arrayContaining(["id", "type", "title"]),
    );
    const nodeProperties =
      (parameters.properties?.nodes?.items as {
        properties?: Record<string, { enum?: string[]; description?: string }>;
      } | undefined)?.properties ?? {};
    expect(nodeProperties.executionMode).toBeUndefined();
    expect(nodeProperties.executor?.enum).toEqual(["human", "automation"]);
    expect(String(nodeProperties.executor?.description)).toContain("Use 'automation' ONLY");
    expect(parameters.properties?.edges?.items?.required).toEqual(
      expect.arrayContaining(["id", "fromNodeId", "toNodeId", "type"]),
    );
    expect(
      ((parameters.properties?.edges?.items as {
        properties?: Record<string, { enum?: string[] }>;
      } | undefined)?.properties?.type?.enum ?? []).sort(),
    ).toEqual(["depends_on", "sequential"]);
    expect(body.tool_choice).toBe("required");
  });

  it("prefers explicit feature instructions when provided", () => {
    const body = buildGatewayBody(
      { kind: "feature", feature: "suggest", stream: false },
      {
        sessionId: "sess-suggest",
        sessionKey: "tenant-a:suggest-1",
        instructions: "Use domain-specific suggestion guidance.",
        input: { input: "draft agenda" },
      },
      "sess-suggest",
    );

    expect(String(body.instructions)).toContain("Use domain-specific suggestion guidance.");
    expect(String(body.instructions)).not.toContain(
      "Return suggestions only via function call suggest_task_completions.",
    );
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
    expect(body.input).toEqual([
      {
        type: "input_text",
        text: expect.stringContaining("Task title: Run task"),
      },
    ]);
    const inputText = ((body.input as Array<{ type: string; text?: string }>)[0]?.text) ?? "";
    expect(inputText).toContain('"model": "gpt-5"');
  });

  it("builds readable default session ids when no session is provided", async () => {
    const port = 18668;
    const requestBodies: Array<Record<string, unknown>> = [];
    const entries: BridgeLogEntry[] = [];

    globalThis.fetch = (async (input, init) => {
      const url = getRequestUrl(input);
      if (url.includes("/v1/responses")) {
        requestBodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
        return Response.json({
          id: "resp-default-session",
          status: "completed",
          output: [{ type: "message", content: [{ type: "output_text", text: "done" }] }],
        });
      }
      return realFetch(input, init);
    }) as typeof fetch;

    const server = startBridgeServer({
      port,
      logger: createBridgeLogger({ minLevel: "info", sink: (entry) => entries.push(entry) }),
    });

    try {
      const res = await fetch(`http://127.0.0.1:${port}/v1/execution/task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: "task-42", taskTitle: "Draft release notes", instructions: "Run task" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(String(body.sessionId)).toMatch(/^execution-task-42-\d{8}-\d{6}$/);
      expect(requestBodies[0]?.user).toBe(body.sessionId);
      const startEntry = entries.find((entry) => entry.event === "bridge.request.start");
      expect(String(startEntry?.data?.sessionId)).toBe(body.sessionId);
    } finally {
      server.stop(true);
    }
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

  it("redacts sensitive values and truncates long payloads in logs", () => {
    const entries: BridgeLogEntry[] = [];
    const logger = createBridgeLogger({
      minLevel: "debug",
      sink: (entry) => entries.push(entry),
    });

    logger.info("bridge.request", {
      authorization: "Bearer secret-token",
      nested: { apiKey: "abc123", text: "x".repeat(1200) },
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.data?.authorization).toBe("[REDACTED]");
    expect((entries[0]?.data?.nested as Record<string, unknown>)?.apiKey).toBe("[REDACTED]");
    expect(typeof (entries[0]?.data?.nested as Record<string, unknown>)?.text).toBe("string");
    expect(String((entries[0]?.data?.nested as Record<string, unknown>)?.text).length).not.toBe("1200");
  });

  it("pending tool outputs do not cause mixed-type arrays in the input field", () => {
    const sessionKey = "chrona:openclaw:task:t-multi:default";
    const staleOutputs = [
      { type: "function_call_output" as const, call_id: "call-1", output: '{"ok":true}' },
      { type: "function_call_output" as const, call_id: "call-2", output: '{"ok":true}' },
    ];
    setSessionPendingToolOutputs(sessionKey, staleOutputs);

    const request: BridgeFeatureRequest<{ title: string }> = {
      sessionId: "sess-multi",
      sessionKey,
      input: { title: "Test task" },
      timeout: 30,
    };

    const body = buildGatewayBody(
      { kind: "feature", feature: "suggest", stream: false },
      request,
      "sess-multi",
    );

    const inputValue = body.input;
    // When pending outputs exist, input must be an array of only typed objects
    expect(Array.isArray(inputValue)).toBe(true);
    for (const item of inputValue as unknown[]) {
      expect(item && typeof item === "object" && !Array.isArray(item)).toBe(true);
    }
    // The function_call_output items must come first
    expect((inputValue as Array<Record<string, unknown>>)[0]).toMatchObject({ type: "function_call_output", call_id: "call-1" });
    expect((inputValue as Array<Record<string, unknown>>)[1]).toMatchObject({ type: "function_call_output", call_id: "call-2" });
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
      const response = makeResponse(
        route.kind === "feature"
          ? { toolCalls: [{ tool: "suggest_task_completions", callId: "call-1", input: { suggestions: [] }, result: undefined, status: "completed" }] }
          : {},
      );
      return { response, events: [] };
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
    const legacyChatRes = await app.request("http://bridge.local/v1/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "legacy" }] }),
    });

    expect(featureRes.status).toBe(200);
    expect(executionRes.status).toBe(200);
    expect(legacyChatRes.status).toBe(404);
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

  it("defers function_call_output acknowledgement until the same session is used again", async () => {
    const port = 18671;
    const requestBodies: Array<Record<string, unknown>> = [];

    globalThis.fetch = (async (input, init) => {
      const url = getRequestUrl(input);
      if (url.includes("/v1/responses")) {
        const req = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        requestBodies.push(req);
        if (requestBodies.length === 1) {
          return Response.json({
            id: "resp-plan-tool-call",
            status: "requires_action",
            output: [
              {
                type: "function_call",
                call_id: "call-plan-1",
                name: "generate_task_plan_graph",
                arguments: JSON.stringify({
                  summary: "Plan created",
                  nodes: [{ id: "n1", type: "task", title: "Clarify investment goal", objective: "Define target university investment project" }],
                  edges: [],
                }),
              },
            ],
          });
        }
        return Response.json({
          id: "resp-plan-finished",
          status: "completed",
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: "Next task turn finished." }],
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
        sessionKey: "task:task-1",
        input: { taskId: "task-1", title: "Plan task" },
      };
      const first = await fetch(`http://127.0.0.1:${port}/v1/features/generate-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      expect(first.status).toBe(200);
      const firstBody = await first.json();
      expect(firstBody.feature.payload.summary).toBe("Plan created");
      expect(firstBody.toolCallOutputs).toEqual([]);
      expect(requestBodies).toHaveLength(1);

      const second = await fetch(`http://127.0.0.1:${port}/v1/features/generate-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      expect(second.status).toBe(422);
      expect(requestBodies).toHaveLength(2);
      expect(requestBodies[1].previous_response_id).toBe("resp-plan-tool-call");
      expect(requestBodies[1].input).toEqual([
        {
          type: "function_call_output",
          call_id: "call-plan-1",
          output: expect.stringContaining("Chrona accepted the generated task plan graph"),
        },
        {
          type: "input_text",
          text: expect.stringContaining("Create an execution-ready plan graph"),
        },
      ]);

      const third = await fetch(`http://127.0.0.1:${port}/v1/features/generate-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      expect(third.status).toBe(422);
      expect(requestBodies).toHaveLength(3);
      expect(requestBodies[2].input).toEqual([
        {
          type: "input_text",
          text: expect.stringContaining("Create an execution-ready plan graph"),
        },
      ]);
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
        const req = JSON.parse(String(init?.body ?? "{}")) as {
          tool_choice?: string;
          tools?: Array<{ name?: string }>;
        };
        const toolName =
          req.tool_choice === "required" ? req.tools?.[0]?.name : undefined;
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

  it("logs inbound request payloads and outbound gateway traffic", async () => {
    const port = 18672;
    const entries: BridgeLogEntry[] = [];

    globalThis.fetch = (async (input, init) => {
      const url = getRequestUrl(input);
      if (url.includes("/v1/responses")) {
        return Response.json({
          id: "resp-log-1",
          status: "completed",
          output: [
            {
              type: "function_call",
              call_id: "call-log-1",
              name: "generate_task_plan_graph",
              arguments: JSON.stringify({ summary: "ok", nodes: [], edges: [] }),
            },
          ],
        });
      }
      return realFetch(input, init);
    }) as typeof fetch;

    const server = startBridgeServer({
      port,
      logger: createBridgeLogger({ minLevel: "debug", sink: (entry) => entries.push(entry) }),
    });

    try {
      const res = await fetch(`http://127.0.0.1:${port}/v1/features/generate-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "sess-log",
          sessionKey: "tenant-a:task-1",
          input: { taskId: "task-1", title: "Plan" },
        }),
      });
      expect(res.status).toBe(200);
      expect(entries.some((entry) => entry.event === "bridge.http.request.received")).toBeTrue();
      expect(entries.some((entry) => entry.event === "bridge.gateway.request")).toBeTrue();
      expect(entries.some((entry) => entry.event === "bridge.gateway.response")).toBeTrue();
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
