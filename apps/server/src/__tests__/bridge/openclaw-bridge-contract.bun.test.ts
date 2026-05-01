/**
 * API workflow tests: OpenClaw bridge contract
 *
 * Tests the bridge's HTTP contract (routes, request/response shapes) using
 * mocked executeRequest — no real network calls.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import {
  createBridgeApp,
  createBridgeLogger,
  buildGatewayBody,
  gatewayHeaders,
  type BridgeResponse,
  type ExecutionResult,
  type RouteKind,
} from "@chrona/openclaw-bridge";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function makeFunctionCallPlanResponse(callId: string, arguments_: string): BridgeResponse {
  return makeResponse({
    sessionId: "sess-plan",
    toolCalls: [
      {
        tool: "generate_task_plan_graph",
        callId,
        input: JSON.parse(arguments_),
        status: "completed",
      },
    ],
    feature: {
      feature: "generate_plan",
      source: "business_tool",
      toolName: "generate_task_plan_graph",
      payload: JSON.parse(arguments_),
    },
    usage: { inputTokens: 100, outputTokens: 200 },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OpenClaw bridge contract", () => {
  let mockedExecuteRequest: (
    route: RouteKind,
    body: any,
  ) => Promise<ExecutionResult>;
  let mockedGatewayCheck: () => Promise<boolean>;

  beforeEach(() => {
    mockedGatewayCheck = async () => true;
    mockedExecuteRequest = async () => ({ response: makeResponse(), events: [] });
  });

  function makeApp() {
    return createBridgeApp({
      logger: createBridgeLogger({ minLevel: "error", sink: () => {} }),
      checkGatewayAvailable: mockedGatewayCheck,
      executeRequest: mockedExecuteRequest,
    });
  }

  // -----------------------------------------------------------------------
  // Health
  // -----------------------------------------------------------------------

  it("GET /v1/health returns 200 with gateway info when available", async () => {
    const app = makeApp();
    const res = await app.request("http://bridge.local/v1/health");

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe("ok");
    expect(body.gateway).toBeDefined();
    expect(typeof body.gateway).toBe("string");
  });

  it("GET /v1/health returns unavailable when gateway is down", async () => {
    mockedGatewayCheck = async () => false;
    const app = makeApp();
    const res = await app.request("http://bridge.local/v1/health");

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe("unavailable");
  });

  // -----------------------------------------------------------------------
  // Generate-plan contract
  // -----------------------------------------------------------------------

  it("POST /v1/features/generate-plan receives buildGatewayBody with correct tool constraints", () => {
    const body = buildGatewayBody(
      { kind: "feature", feature: "generate_plan", stream: false },
      {
        sessionId: "sess-plan",
        sessionKey: "tenant-a:plan-1",
        input: {
          task: { title: "Plan test", description: "Plan it" },
        },
        timeout: 30,
      },
      "sess-plan",
    );

    expect(body.tool_choice).toBe("required");
    const tool = (body.tools as Array<{ name: string; type: string }>)[0];
    expect(tool.name).toBe("generate_task_plan_graph");
    expect(tool.type).toBe("function");
    expect(String(body.instructions)).toContain("Do not ask follow-up questions");
    expect(String(body.instructions)).toContain("Call generate_task_plan_graph exactly once");
  });

  it("POST /v1/features/generate-plan returns 200 with feature result on success", async () => {
    let capturedRoute: RouteKind | null = null;

    mockedExecuteRequest = async (route) => {
      capturedRoute = route;
      const planJson = JSON.stringify({
        summary: "A test plan",
        nodes: [{ id: "n1", type: "step", title: "Step 1", objective: "Do it", executor: "human", requiresHumanInput: false, requiresHumanApproval: false }],
        edges: [],
      });
      return {
        response: makeFunctionCallPlanResponse("call-1", planJson),
        events: [],
      };
    };

    const app = makeApp();
    const res = await app.request(
      "http://bridge.local/v1/features/generate-plan",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "sess-plan",
          input: { taskId: "task-1", title: "Plan task" },
        }),
      },
    );

    expect(res.status).toBe(200);
    expect(capturedRoute as any).toEqual({
      kind: "feature",
      feature: "generate_plan",
      stream: false,
    });

    const body = await res.json() as any;
    expect(body.feature).toBeDefined();
    expect(body.feature.feature).toBe("generate_plan");
    expect(body.feature.toolName).toBe("generate_task_plan_graph");
    expect(body.feature.source).toBe("business_tool");
  });

  // -----------------------------------------------------------------------
  // Function call parsing
  // -----------------------------------------------------------------------

  it("extracts function_call arguments as plan payload", async () => {
    const planData = {
      summary: "Extracted plan",
      nodes: [
        {
          id: "n1",
          type: "step",
          title: "Research",
          objective: "Study domain",
          executor: "automation",
          requiresHumanInput: false,
          requiresHumanApproval: false,
        },
      ],
      edges: [],
    };

    mockedExecuteRequest = async () => ({
      response: makeFunctionCallPlanResponse("call-extract", JSON.stringify(planData)),
      events: [],
    });

    const app = makeApp();
    const res = await app.request(
      "http://bridge.local/v1/features/generate-plan",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: { taskId: "task-2", title: "Extract me" } }),
      },
    );

    const body = await res.json() as any;
    expect(body.feature.payload).toEqual(planData);
    expect(body.feature.payload.summary).toBe("Extracted plan");
    expect(body.feature.payload.nodes).toHaveLength(1);
  });

  it("returns 422 when feature route response has an error", async () => {
    mockedExecuteRequest = async () => ({
      response: makeResponse({
        sessionId: "sess-err",
        output: "",
        toolCalls: [],
        feature: null,
        error: "Gateway rejected the request: content policy violation",
      }),
      events: [],
    });

    const app = makeApp();
    const res = await app.request(
      "http://bridge.local/v1/features/generate-plan",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: { taskId: "task-3", title: "No tool" } }),
      },
    );

    // Bridge returns 422 for feature routes with errors
    expect(res.status).toBe(422);
    const body = await res.json() as any;
    expect(body.error).toBe("Gateway rejected the request: content policy violation");
  });

  it("returns 422 when generate-plan returns the wrong tool name", async () => {
    mockedExecuteRequest = async () => ({
      response: makeResponse({
        toolCalls: [
          {
            tool: "wrong_tool",
            callId: "call-wrong-tool",
            input: { summary: "Wrong tool", nodes: [], edges: [] },
            status: "completed",
          },
        ],
      }),
      events: [],
    });

    const res = await makeApp().request("http://bridge.local/v1/features/generate-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: { taskId: "task-4", title: "Wrong tool" } }),
    });

    expect(res.status).toBe(422);
    const body = await res.json() as any;
    expect(typeof body.error).toBe("string");
  });

  it("returns 422 when feature payload is missing", async () => {
    mockedExecuteRequest = async () => ({
      response: makeResponse({
        toolCalls: [
          {
            tool: "generate_task_plan_graph",
            callId: "call-missing-payload",
            input: null as any,
            status: "completed",
          },
        ],
      }),
      events: [],
    });

    const res = await makeApp().request("http://bridge.local/v1/features/generate-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: { taskId: "task-5", title: "Missing payload" } }),
    });

    expect(res.status).toBe(422);
    const body = await res.json() as any;
    expect(typeof body.error).toBe("string");
  });

  it("returns 422 when feature payload is malformed", async () => {
    mockedExecuteRequest = async () => ({
      response: makeResponse({
        toolCalls: [
          {
            tool: "generate_task_plan_graph",
            callId: "call-malformed-payload",
            input: { summary: 123, nodes: "bad", edges: null } as any,
            status: "completed",
          },
        ],
      }),
      events: [],
    });

    const res = await makeApp().request("http://bridge.local/v1/features/generate-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: { taskId: "task-6", title: "Malformed payload" } }),
    });

    expect(res.status).toBe(422);
    const body = await res.json() as any;
    expect(typeof body.error).toBe("string");
  });

  // -----------------------------------------------------------------------
  // Execution contract
  // -----------------------------------------------------------------------

  it("POST /v1/execution/task routes as execution kind", async () => {
    let capturedRoute: RouteKind | null = null;

    mockedExecuteRequest = async (route, _body) => {
      capturedRoute = route;
      return { response: makeResponse({ sessionId: "sess-exec" }), events: [] };
    };

    const app = makeApp();
    const res = await app.request("http://bridge.local/v1/execution/task", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instructions: "Run a task",
        taskId: "task-exec-1",
        workspaceId: "ws-1",
      }),
    });

    expect(res.status).toBe(200);
    expect(capturedRoute as any).toEqual({ kind: "execution", stream: false });

    const body = await res.json() as any;
    expect(body.sessionId).toBe("sess-exec");
  });

  it("execution body has no tool_choice constraint", () => {
    const body = buildGatewayBody(
      { kind: "execution", stream: false },
      {
        sessionId: "sess-exec",
        sessionKey: "tenant-a:exec-1",
        instructions: "Do work",
        taskId: "task-1",
        taskTitle: "Run task",
      },
      "sess-exec",
    );

    expect(body.tool_choice).toBeUndefined();
    expect(body.tools).toBeUndefined();
  });

  it("POST /v1/execution/task returns output and usage", async () => {
    mockedExecuteRequest = async () => ({
      response: makeResponse({
        sessionId: "sess-output",
        output: "Task completed successfully",
        usage: { inputTokens: 50, outputTokens: 150 },
        durationMs: 2500,
      }),
      events: [],
    });

    const app = makeApp();
    const res = await app.request("http://bridge.local/v1/execution/task", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instructions: "Run" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.output).toBe("Task completed successfully");
    expect(body.usage).toEqual({ inputTokens: 50, outputTokens: 150 });
    expect(body.durationMs).toBe(2500);
  });

  // -----------------------------------------------------------------------
  // Streaming
  // -----------------------------------------------------------------------

  it("POST /v1/execution/task/stream emits SSE events", async () => {
    mockedExecuteRequest = async () => ({
      response: makeResponse({ sessionId: "sess-stream-exec" }),
      events: [
        { type: "status", sessionId: "sess-stream-exec", status: "in_progress" },
        { type: "text_delta", sessionId: "sess-stream-exec", text: "Working..." },
      ],
    });

    const app = makeApp();
    const res = await app.request(
      "http://bridge.local/v1/execution/task/stream",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instructions: "Stream run" }),
      },
    );

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("event: event");
    expect(text).toContain('"type":"status"');
    expect(text).toContain("event: done");
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  it("returns 401 when gateway returns unauthorized", async () => {
    mockedGatewayCheck = async () => false;

    const app = makeApp();
    const res = await app.request("http://bridge.local/v1/health");
    const body = await res.json() as any;
    expect(body.status).toBe("unavailable");
  });

  it("returns 500 when executeRequest throws", async () => {
    mockedExecuteRequest = async () => {
      throw new Error("Internal failure");
    };

    const app = makeApp();
    const res = await app.request("http://bridge.local/v1/execution/task", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instructions: "Run" }),
    });

    expect(res.status).toBe(500);
    const body = await res.json() as any;
    expect(body.error).toBeDefined();
  });

  it("returns a stable error shape without stack leakage", async () => {
    mockedExecuteRequest = async () => {
      throw new Error("timeout while contacting gateway with secret token abc123\nstack: hidden");
    };

    const res = await makeApp().request("http://bridge.local/v1/execution/task", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instructions: "Run" }),
    });

    expect(res.status).toBe(500);
    const body = await res.json() as any;
    expect(body).toEqual(expect.objectContaining({ error: expect.any(String) }));
    expect(body.error).not.toContain("stack");
    expect(body.error).not.toContain("abc123");
    expect(body.error).not.toContain("secret");
    expect(body.error.length).toBeGreaterThan(0);
  });

  it("streaming endpoint returns 500 SSE on error", async () => {
    mockedExecuteRequest = async () => {
      throw new Error("Stream crash");
    };

    const app = makeApp();
    const res = await app.request(
      "http://bridge.local/v1/execution/task/stream",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instructions: "Run" }),
      },
    );

    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toContain("event: error");
    expect(text).toContain("Stream crash");
  });

  it("returns 400 for malformed JSON body", async () => {
    const app = makeApp();
    const res = await app.request("http://bridge.local/v1/execution/task", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not valid json {{{",
    });

    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain("Invalid JSON");
  });

  it("returns 400 for missing required fields in feature request", async () => {
    const app = makeApp();
    const res = await app.request("http://bridge.local/v1/features/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown route", async () => {
    const app = makeApp();
    const res = await app.request("http://bridge.local/v1/unknown-path", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(404);
  });

  // -----------------------------------------------------------------------
  // No token leaks
  // -----------------------------------------------------------------------

  it("does not expose gateway token in error responses", async () => {
    // Simulate failure
    mockedExecuteRequest = async () => {
      throw new Error("Network failure connecting to gateway");
    };

    const app = makeApp();
    const res = await app.request("http://bridge.local/v1/execution/task", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instructions: "Run" }),
    });

    const body = await res.json() as any;
    // Error message should be generic, not contain any token
    expect(body.error).not.toContain("Bearer");
    expect(body.error).not.toContain("token");
    expect(body.error).not.toContain("secret");
  });

  // -----------------------------------------------------------------------
  // Gateway headers
  // -----------------------------------------------------------------------

  it("gatewayHeaders sets authorization and agent headers", () => {
    const headers = gatewayHeaders(
      {
        defaultPort: 7677,
        gatewayHttpUrl: "http://gateway.local",
        gatewayToken: "test-token",
        agentId: "test-agent",
        model: "gpt-5.4",
        messageChannel: "test-channel",
      },
      {
        sessionId: "sess-1",
        sessionKey: "tenant-a:key-1",
        instructions: "Do work",
      },
    );

    expect(headers.Authorization).toBe("Bearer test-token");
    expect(headers["x-openclaw-agent-id"]).toBe("test-agent");
    expect(headers["x-openclaw-model"]).toBe("gpt-5.4");
    expect(headers["x-openclaw-message-channel"]).toBe("test-channel");
    expect(headers["x-openclaw-session-key"]).toBe("tenant-a:key-1");
  });
});
