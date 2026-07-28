import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import type { ChronaToolName } from "@chrona/contracts/api";
import { __mcpRouteTestHooks, createMcpRoutes } from "../mcp/mcp.routes";

type CapturedToolOperation = {
  toolName: string;
  input: {
    sessionId?: string;
    idempotencyKey?: string;
    payload?: Record<string, unknown>;
    taskId?: string;
  };
};

type StubEngine = Parameters<typeof createMcpRoutes>[0];

const hiddenContextFieldNames = [
  "workspaceId",
  "taskId",
  "sessionId",
  "actorType",
  "actorId",
  "idempotencyKey",
  "expectedState",
  "expectedRevision",
  "evidence",
] as const;

const hiddenContextArguments = {
  sessionId: "chrona:task:task-1:plan-generation",
  actorType: "agent",
  actorId: "hermes",
  evidence: { providerText: "generated plan" },
};

const blockPayload = {
  reason: "Waiting on API",
  actionForm: {
    instructions: "Provide the missing API details.",
    inputFields: [{ name: "apiDetails", label: "API details" }],
  },
};


function createStubEngine(
  rejected = false,
  operations: CapturedToolOperation[] = [],
  resultOverride?: Record<string, unknown>,
): StubEngine {
  return {
    agentTools: {
      registry: () => ({
        tools: [
          { name: "chrona.execution.read", mutates: false, description: "Read execution." },
          { name: "chrona.node.complete", mutates: true, description: "Complete task node." },
        ],
      }),
      resolveInputContext: async (input: unknown) => ({
        ...(input as Record<string, unknown>),
        workspaceId: (input as { workspaceId?: string }).workspaceId ?? "workspace-from-session",
        taskId: (input as { taskId?: string }).taskId ?? "task-from-session",
      }),
      execute: async (operation: unknown) => {
        operations.push(operation as CapturedToolOperation);
        const toolName = (operation as { toolName: string }).toolName;
        const input = (operation as { input: { idempotencyKey?: string; taskId?: string } }).input;
        return {
          operationId: rejected ? "op-rejected" : "op-1",
          toolName,
          status: rejected ? "rejected" : "accepted",
          reasonCode: rejected ? "STALE_STATE" : null,
          message: rejected ? "Expected state is stale." : "Tool executed.",
          affected: { taskId: input.taskId ?? "task-1" },
          state: { taskStatus: "Ready", idempotencyKey: input.idempotencyKey },
          idempotency: rejected ? "new" : "not_applicable",
          auditRef: rejected ? "op-rejected" : null,
          recovery: rejected ? { nextTool: "chrona.execution.read" } : null,
          completedAt: new Date().toISOString(),
          ...resultOverride,
        };
      },
    },
  } as unknown as StubEngine;
}

function app(engine = createStubEngine()) {
  const a = new Hono();
  a.route("/api", createMcpRoutes(engine));
  return a;
}

function rpc(method: string, params: Record<string, unknown> = {}, id = 1) {
  return { jsonrpc: "2.0", id, method, params };
}

const mcpHeaders = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

function callTool(
  toolName: ChronaToolName,
  input: Record<string, unknown>,
  options: { rejected?: boolean; operations?: CapturedToolOperation[]; resultOverride?: Record<string, unknown>; requestSessionId?: string } = {},
) {
  const operations = options.operations ?? [];
  return __mcpRouteTestHooks.callChronaTool(
    createStubEngine(options.rejected, operations, options.resultOverride),
    toolName,
    input,
    undefined,
    options.requestSessionId,
  );
}

type ToolCallResult = Awaited<ReturnType<typeof callTool>>;

function expectStructuredContent(result: ToolCallResult) {
  expect(result.structuredContent).toBeDefined();
  return result.structuredContent as Record<string, unknown>;
}

function expectTextContent(result: ToolCallResult) {
  const content = result.content[0];
  expect(content?.type).toBe("text");
  return content as { type: "text"; text: string };
}


describe("MCP routes", () => {
  it("responds to standard MCP initialize", async () => {
    const response = await app().request("/api/mcp", {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify(rpc("initialize", {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "chrona-test", version: "1.0.0" },
      })),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      result: { capabilities: { tools: {} }, serverInfo: { name: "chrona" } },
    });
  });

  it("lists tools after MCP initialize", async () => {
    const testApp = app();
    const initResponse = await testApp.request("/api/mcp", {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify(rpc("initialize", {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "chrona-test", version: "1.0.0" },
      })),
    });
    const sessionId = initResponse.headers.get("mcp-session-id");

    const response = await testApp.request("/api/mcp", {
      method: "POST",
      headers: {
        ...mcpHeaders,
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      },
      body: JSON.stringify(rpc("tools/list", {}, 2)),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ jsonrpc: "2.0" });
    expect(body.result.tools.map((tool: { name: string }) => tool.name).sort()).toEqual([
      "chrona_condition_select",
      "chrona_dashboard_brief",
      "chrona_execution_read",
      "chrona_goal_results_read",
      "chrona_node_block",
      "chrona_node_complete",
      "chrona_node_fail",
      "chrona_node_read",
      "chrona_plan_generate",
      "chrona_plan_read",
      "chrona_wait_complete",
    ]);
  });

  it("lists minimal external tool schemas with descriptions", () => {
    const conditionSelect = __mcpRouteTestHooks.externalTools.chrona_condition_select;

    expect(conditionSelect.description).toBe("Select a condition branch by nodeId and branchRef. Chrona validates the node against the current task.");
    expect(conditionSelect.inputSchema.shape.nodeId).toBeDefined();
    expect(conditionSelect.inputSchema.shape.branchRef).toBeDefined();
    expect(conditionSelect.inputSchema.shape.summary).toBeDefined();
    expect(conditionSelect.inputSchema.shape.nextNodeId).toBeUndefined();
    expect(conditionSelect.inputSchema.shape.idempotencyKey).toBeUndefined();
    expect(conditionSelect.inputSchema.shape.evidence).toBeUndefined();
  });

  it("exports bounded Goal result search without backend Goal identity", () => {
    const goalResults = __mcpRouteTestHooks.externalTools.chrona_goal_results_read;
    expect(goalResults.inputSchema.shape.query).toBeDefined();
    expect(goalResults.inputSchema.shape.limit).toBeDefined();
    expect(goalResults.inputSchema.shape.cursor).toBeDefined();
    expect(goalResults.inputSchema.shape.goalId).toBeUndefined();
    expect(goalResults.inputSchema.safeParse({ query: "research", limit: 5 }).success).toBe(true);
    expect(goalResults.inputSchema.safeParse({ limit: 11 }).success).toBe(false);
  });


  it("does not expose hidden context fields in plan generation schema", () => {
    const planGenerate = __mcpRouteTestHooks.externalTools.chrona_plan_generate;

    expect(planGenerate.inputSchema.shape.title).toBeDefined();
    expect(planGenerate.inputSchema.shape.goal).toBeDefined();
    expect(planGenerate.inputSchema.shape.nodes).toBeDefined();
    expect(planGenerate.inputSchema.shape.sessionId).toBeUndefined();
    expect(planGenerate.inputSchema.shape.actorType).toBeUndefined();
    expect(planGenerate.inputSchema.shape.actorId).toBeUndefined();
    expect(planGenerate.inputSchema.shape.idempotencyKey).toBeUndefined();
    expect(planGenerate.inputSchema.shape.evidence).toBeUndefined();
    expect(planGenerate.inputSchema.shape.expectedRevision).toBeUndefined();
  });

  it("does not expose hidden context fields in any public tool schema", () => {
    for (const tool of Object.values(__mcpRouteTestHooks.externalTools) as Array<{ inputSchema: { shape: Record<string, unknown> } }>) {
      const shape = tool.inputSchema.shape;
      for (const fieldName of hiddenContextFieldNames) {
        expect(shape[fieldName]).toBeUndefined();
      }
    }
  });

  it("builds Chrona input from visible payload and hidden context", () => {
    const input = __mcpRouteTestHooks.toChronaInput(
      "chrona.node.complete",
      { ...hiddenContextArguments, summary: "Done" },
    );

    expect(input.sessionId).toBe(hiddenContextArguments.sessionId);
    expect(input.payload).toEqual({ summary: "Done" });
    const goalResultInput = __mcpRouteTestHooks.toChronaInput(
      "chrona.goal.results.read",
      { query: "research", limit: 3, _meta: { sessionId: hiddenContextArguments.sessionId } },
    );
    expect(goalResultInput.payload).toEqual({ query: "research", offset: 0, maxChars: 12_000, limit: 3 });
    expect(input.evidence).toBeUndefined();
  });

  it("returns slim accepted mutating tool results to the model", async () => {
    const result = await callTool("chrona.node.complete", {
      summary: "Done",
      _meta: { sessionId: "chrona:task:task-1:execute" },
    });

    const structuredContent = expectStructuredContent(result);

    expect(structuredContent).toEqual({
      status: "accepted",
      message: "Tool executed.",
      next: "stop",
    });
    expect(JSON.stringify(structuredContent)).not.toContain("operationId");
    expect(JSON.stringify(structuredContent)).not.toContain("affected");
    expect(JSON.stringify(structuredContent)).not.toContain("auditRef");
    expect(JSON.stringify(structuredContent)).not.toContain("idempotency");
  });


  it("returns bounded Goal results without internal operation metadata", async () => {
    const result = await callTool("chrona.goal.results.read", {
      query: "research",
      limit: 3,
      _meta: { sessionId: "chrona:task:task-1:plan-generation" },
    }, {
      resultOverride: {
        state: {
          result: {
            linked: true,
            goal: { title: "Launch program" },
            results: [{ ref: "GRABCDEF012345", title: "Accepted research", summary: "Evidence" }],
            nextCursor: null,
          },
        },
      },
    });

    expect(expectStructuredContent(result)).toEqual({
      status: "accepted",
      message: "Tool executed.",
      result: {
        linked: true,
        goal: { title: "Launch program" },
        results: [{ ref: "GRABCDEF012345", title: "Accepted research", summary: "Evidence" }],
        nextCursor: null,
      },
    });
    expect(JSON.stringify(expectStructuredContent(result))).not.toContain("operationId");
    expect(JSON.stringify(expectStructuredContent(result))).not.toContain("taskId");
  });
  it("allows execution tools in plan execution main sessions", async () => {
    const operations: CapturedToolOperation[] = [];
    await callTool("chrona.node.complete", {
      summary: "Done",
      _meta: { sessionId: "chrona:task:task-1:execute:35faa86e" },
    }, { operations });

    expect(operations).toEqual([
      expect.objectContaining({
        toolName: "chrona.node.complete",
        input: expect.objectContaining({ sessionId: "chrona:task:task-1:execute:35faa86e" }),
      }),
    ]);
  });

  it("dispatches every exposed Chrona MCP tool to the expected internal operation", async () => {
    const executionSessionId = "chrona:task:task-1:execute";
    const planSessionId = "chrona:task:task-1:plan-generation";
    const cases = [
      ["chrona.execution.read", executionSessionId, {}, {}],
      ["chrona.goal.results.read", executionSessionId, { query: "research", limit: 3 }, { query: "research", offset: 0, maxChars: 12_000, limit: 3 }],
      ["chrona.plan.read", executionSessionId, {}, {}],
      ["chrona.plan.generate", planSessionId, {
        title: "Generated MCP plan",
        goal: "Persist a complete graph",
        nodes: [{ id: "first_step", type: "task", title: "First step" }],
        edges: [],
      }, {
        title: "Generated MCP plan",
        goal: "Persist a complete graph",
        nodes: [{ id: "first_step", type: "task", title: "First step" }],
        edges: [],
      }],
      ["chrona.node.read", executionSessionId, {}, {}],
      ["chrona.node.complete", executionSessionId, { summary: "Done" }, { summary: "Done" }],
      ["chrona.node.condition_select", executionSessionId, { nodeId: "condition-node", branchRef: "B20260516-01-A", summary: "Yes" }, { nodeId: "condition-node", branchRef: "B20260516-01-A", summary: "Yes" }],
      ["chrona.node.block", executionSessionId, blockPayload, blockPayload],
      ["chrona.node.fail", executionSessionId, { error: "Command failed" }, { error: "Command failed" }],
      ["chrona.node.wait_complete", executionSessionId, { summary: "Event observed" }, { summary: "Event observed" }],
    ] as const;

    for (const [toolName, sessionId, args, expectedPayload] of cases) {
      const operations: CapturedToolOperation[] = [];
      await callTool(toolName, { ...args, _meta: { sessionId } }, { operations });

      expect(operations).toHaveLength(1);
      expect(operations[0]).toMatchObject({
        toolName,
        input: {
          sessionId,
          taskId: "task-from-session",
          payload: expectedPayload,
        },
      });
      expect(operations[0].input.payload).toEqual(expectedPayload);
    }
  });

  it("generates idempotency keys for mutating tools without exposing them to the model", async () => {
    const result = await callTool("chrona.node.complete", {
      summary: "Done",
      _meta: { sessionId: "chrona:task:task-1:execute" },
    });

    const structuredContent = expectStructuredContent(result);

    expect(structuredContent.status).toBe("accepted");
    expect(structuredContent.next).toBe("stop");
    expect(JSON.stringify(structuredContent)).not.toContain("idempotencyKey");
  });

  it("uses session_id from MCP URL when tool payload omits sessionId", async () => {
    const operations: CapturedToolOperation[] = [];
    await callTool("chrona.node.complete", { summary: "Done" }, {
      operations,
      requestSessionId: "chrona:task:task-1:execute:url",
    });

    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      toolName: "chrona.node.complete",
      input: { sessionId: "chrona:task:task-1:execute:url" },
    });
  });

  it("fails fast when mutating Chrona tools are called without sessionId", async () => {
    await expect(callTool("chrona.node.complete", { summary: "Done" }))
      .rejects.toThrow("chrona.node.complete requires sessionId for idempotency");
  });

  it("fails fast when Chrona tool context uses unsupported session_id", async () => {
    await expect(callTool("chrona.node.complete", {
      summary: "Done",
      _meta: { session_id: "chrona:task:task-1:execute" },
    })).rejects.toThrow("arguments._meta.session_id is not supported; expected sessionId");
  });

  it("accepts hidden context injected into plan generation arguments", async () => {
    const blueprint = {
      title: "Generated MCP plan",
      goal: "Persist a complete graph",
      nodes: [{ id: "first_step", type: "task", title: "First step" }],
      edges: [],
    };
    const operations: CapturedToolOperation[] = [];
    await callTool("chrona.plan.generate", { ...blueprint, ...hiddenContextArguments }, { operations });

    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      toolName: "chrona.plan.generate",
      input: {
        sessionId: "chrona:task:task-1:plan-generation",
        taskId: "task-from-session",
        payload: blueprint,
      },
    });
    expect(operations[0].input.payload).toEqual(blueprint);
  });

  it("accepts hidden context injected into every public tool call", async () => {
    const executionSessionId = "chrona:task:task-1:execute";
    const cases = [
      ["chrona.execution.read", executionSessionId, {}, {}],
      ["chrona.plan.read", hiddenContextArguments.sessionId, {}, {}],
      ["chrona.plan.generate", hiddenContextArguments.sessionId, {
        title: "Generated MCP plan",
        goal: "Persist a complete graph",
        nodes: [{ id: "first_step", type: "task", title: "First step" }],
        edges: [],
      }, {
        title: "Generated MCP plan",
        goal: "Persist a complete graph",
        nodes: [{ id: "first_step", type: "task", title: "First step" }],
        edges: [],
      }],
      ["chrona.node.read", executionSessionId, {}, {}],
      ["chrona.node.complete", executionSessionId, { summary: "Done" }, { summary: "Done" }],
      ["chrona.node.condition_select", executionSessionId, { nodeId: "condition-node", branchRef: "B20260516-01-A", summary: "Yes" }, { nodeId: "condition-node", branchRef: "B20260516-01-A", summary: "Yes" }],
      ["chrona.node.block", executionSessionId, blockPayload, blockPayload],
      ["chrona.node.fail", executionSessionId, { error: "Command failed" }, { error: "Command failed" }],
      ["chrona.node.wait_complete", executionSessionId, { summary: "Event observed" }, { summary: "Event observed" }],
    ] as const;

    for (const [toolName, sessionId, args, expectedPayload] of cases) {
      const operations: CapturedToolOperation[] = [];
      await callTool(toolName, { ...args, ...hiddenContextArguments, sessionId }, { operations });

      expect(operations).toHaveLength(1);
      expect(operations[0]).toMatchObject({
        toolName,
        input: {
          sessionId,
          taskId: "task-from-session",
          payload: expectedPayload,
        },
      });
      expect(operations[0].input.payload).toEqual(expectedPayload);
    }
  });

  it("resolves injected sessionId before dispatching Chrona tools", async () => {
    const result = await callTool("chrona.execution.read", {
      _meta: { sessionId: "chrona:task:task-1:execute" },
    });

    expect(expectStructuredContent(result)).toMatchObject({
      status: "accepted",
      message: "Tool executed.",
      state: { taskStatus: "Ready" },
    });
  });

  it("allows frozen Goal knowledge reads in plan generation sessions", async () => {
    const operations: CapturedToolOperation[] = [];
    const result = await callTool("chrona.goal.results.read", {
      ref: "GA123456ABCDEF",
      offset: 0,
      maxChars: 4_000,
      limit: 1,
      _meta: { sessionId: "chrona:task:task-1:plan-generation" },
    }, { operations });

    expect(result.isError).toBeFalsy();
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      toolName: "chrona.goal.results.read",
      input: { sessionId: "chrona:task:task-1:plan-generation" },
    });
  });

  it("rejects execution tools in plan generation sessions before dispatch", async () => {
    const operations: CapturedToolOperation[] = [];
    const result = await callTool("chrona.execution.read", {
      _meta: { sessionId: "chrona:task:task-1:plan-generation" },
    }, { operations });

    expect(operations).toHaveLength(0);
    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        status: "rejected",
        reasonCode: "UNAUTHORIZED",
        recovery: { action: "stop" },
      },
    });
  });

  it("rejects execution tools in work-block plan generation sessions", async () => {
    const operations: CapturedToolOperation[] = [];
    const result = await callTool("chrona.node.complete", {
      summary: "Done",
      _meta: { sessionId: "chrona:task:task-1:work-block:block-1:plan-generation" },
    }, { operations });

    expect(operations).toHaveLength(0);
    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        status: "rejected",
        reasonCode: "UNAUTHORIZED",
        recovery: { action: "stop" },
      },
    });
  });

  it("rejects plan generation in execution sessions before dispatch", async () => {
    const operations: CapturedToolOperation[] = [];
    const result = await callTool("chrona.plan.generate", {
      title: "Generated MCP plan",
      goal: "Persist a complete graph",
      nodes: [{ id: "first_step", type: "task", title: "First step" }],
      edges: [],
      _meta: { sessionId: "chrona:task:task-1:work-block:block-1" },
    }, { operations });

    expect(operations).toHaveLength(0);
    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        status: "rejected",
        reasonCode: "UNAUTHORIZED",
        recovery: { action: "use_allowed_tool" },
      },
    });
  });

  it("returns rejected Chrona results as MCP tool errors with structured content", async () => {
    const result = await callTool("chrona.execution.read", {
      _meta: { sessionId: "chrona:task:task-1:execute" },
    }, { rejected: true });

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        status: "rejected",
        reasonCode: "STALE_STATE",
        recovery: { nextTool: "chrona.execution.read" },
      },
    });
  });

  it("exposes plan generation validation issues to the model", async () => {
    const issue = {
      path: "edges.0.to",
      message: "Unknown target node 'missing_target'",
    };
    const result = await callTool("chrona.plan.generate", {
      title: "Invalid plan",
      goal: "Expose validation issues",
      nodes: [{ id: "task_inspect_unscheduled_cards", type: "task", title: "Inspect unscheduled cards" }],
      edges: [{ from: "task_inspect_unscheduled_cards", to: "missing_target" }],
      _meta: { sessionId: "chrona:task:task-1:plan-generation" },
    }, {
      resultOverride: {
        status: "rejected",
        reasonCode: "VALIDATION_ERROR",
        message: "Plan blueprint compilation failed",
        recovery: { nextTool: "chrona.plan.read", details: { issues: [issue] } },
        evidence: { validationIssues: [issue] },
      },
    });

    expect(result.isError).toBe(true);
    const textContent = expectTextContent(result);

    expect(textContent.text).toContain("Validation issues:");
    expect(textContent.text).toContain(issue.path);
    expect(expectStructuredContent(result)).toMatchObject({
      status: "rejected",
      reasonCode: "VALIDATION_ERROR",
      recovery: { details: { issues: [issue] } },
      evidence: { validationIssues: [issue] },
    });
  });

  it("does not expose idempotency fields in mutating tool schemas", () => {
    const taskComplete = __mcpRouteTestHooks.externalTools.chrona_node_complete;

    expect(taskComplete.inputSchema.shape.idempotencyKey).toBeUndefined();
    expect(taskComplete.inputSchema.shape.evidence).toBeUndefined();
    expect(taskComplete.inputSchema.shape.expectedRevision).toBeUndefined();
  });

  it("does not expose the removed shared plan output tool", () => {
    expect((__mcpRouteTestHooks.externalTools as Record<string, unknown>).chrona_plan_output).toBeUndefined();
  });

  it("rejects branch target IDs in public condition terminal schema", async () => {
    await expect(callTool("chrona.node.condition_select", {
      nodeId: "condition-node",
      branchRef: "B20260516-01-A",
      nextNodeId: "node-2",
      summary: "No branch target ids",
      _meta: { sessionId: "chrona:task:task-1:execute" },
    })).rejects.toThrow("Unrecognized key");
  });

  it("removes the obsolete custom task-tools endpoint", async () => {
    const response = await app().request("/api/mcp/task-tools");
    expect(response.status).toBe(404);
  });
});
