import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { createMcpRoutes } from "../mcp/mcp.routes";

type CapturedToolOperation = {
  toolName: string;
  input: {
    sessionId?: string;
    idempotencyKey?: string;
    payload?: Record<string, unknown>;
    taskId?: string;
  };
};

function app(rejected = false, operations: CapturedToolOperation[] = []) {
  const engine = {
    agentTools: {
      registry: () => ({
        tools: [
          { name: "chrona.plan.generate", mutates: true, description: "Generate plan." },
          { name: "chrona.execution.read", mutates: false, description: "Read execution." },
          { name: "chrona.node.result", mutates: true, description: "Report node result." },
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
          reasonCode: rejected
            ? "STALE_STATE"
            : null,
          message: rejected
            ? "Expected state is stale."
            : "Tool executed.",
          affected: { taskId: input.taskId ?? "task-1" },
          state: { taskStatus: "Ready", idempotencyKey: input.idempotencyKey },
          idempotency: rejected ? "new" : "not_applicable",
          auditRef: rejected ? "op-rejected" : null,
          recovery: rejected ? { nextTool: "chrona.execution.read" } : null,
          completedAt: new Date().toISOString(),
        };
      },
    },
  };
  const a = new Hono();
  a.route("/api", createMcpRoutes(engine as unknown as Parameters<typeof createMcpRoutes>[0]));
  return a;
}

function rpc(method: string, params: Record<string, unknown> = {}, id = 1) {
  return {
    jsonrpc: "2.0",
    id,
    method,
    params,
  };
}

async function postRpc(body: unknown, rejected = false) {
  return app(rejected).request("/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });
}

async function postRpcWithOperations(body: unknown) {
  const operations: CapturedToolOperation[] = [];
  const response = await app(false, operations).request("/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });
  return { response, operations };
}

describe("MCP routes", () => {
  it("responds to standard MCP initialize", async () => {
    const response = await postRpc(
      rpc("initialize", {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "chrona-test", version: "1.0.0" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      result: { capabilities: { tools: {} }, serverInfo: { name: "chrona" } },
    });
  });

  it("lists Chrona tools through tools/list", async () => {
    const response = await postRpc(rpc("tools/list"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.tools.map((tool: { name: string }) => tool.name)).toContain("chrona_plan_generate");
    expect(body.result.tools.map((tool: { name: string }) => tool.name)).toContain("chrona_node_result");
  });

  it("lists minimal external tool schemas with descriptions", async () => {
    const response = await postRpc(rpc("tools/list"));

    expect(response.status).toBe(200);
    const body = await response.json();
    const planGenerate = body.result.tools.find(
      (tool: { name: string }) => tool.name === "chrona_plan_generate",
    );
    const nodeResult = body.result.tools.find(
      (tool: { name: string }) => tool.name === "chrona_node_result",
    );

    expect(planGenerate.description).toBe("Persist a complete Hermes-generated plan graph for the session task.");
    expect(planGenerate.inputSchema.required).toEqual(["title", "goal", "nodes"]);
    expect(Object.keys(planGenerate.inputSchema.properties).sort()).toEqual([
      "assumptions",
      "edges",
      "goal",
      "nodes",
      "title",
    ]);
    expect(nodeResult.description).toBe("Report the current execution node result. Chrona resolves the active node from the session.");
    expect(nodeResult.inputSchema.required).toEqual(["status"]);
    expect(nodeResult.inputSchema.properties.nodeId).toMatchObject({ type: "string" });
    expect(nodeResult.inputSchema.properties.idempotencyKey).toBeUndefined();
    expect(nodeResult.inputSchema.properties.evidence).toBeUndefined();
  });

  it("registers the minimal external Chrona MCP tool surface", async () => {
    const response = await postRpc(rpc("tools/list"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.tools.map((tool: { name: string }) => tool.name).sort()).toEqual([
      "chrona_execution_read",
      "chrona_node_result",
      "chrona_plan_generate",
    ]);
  });

  it("dispatches Chrona tools through tools/call", async () => {
    const response = await postRpc(
      rpc("tools/call", {
        name: "chrona_execution_read",
        arguments: {},
        _meta: { sessionId: "chrona:task:task-1:execute" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      result: {
        content: [{ type: "text", text: "Tool executed." }],
        structuredContent: { status: "accepted", state: { taskStatus: "Ready" } },
      },
    });
  });

  it("dispatches every exposed Chrona MCP tool to the expected internal operation", async () => {
    const sessionId = "chrona:task:task-1:execute";
    const planBlueprint = {
      title: "Generated MCP plan",
      goal: "Persist a complete graph",
      nodes: [{ id: "first_step", type: "task", title: "First step" }],
      edges: [],
    };
    const cases = [
      ["chrona_plan_generate", "chrona.plan.generate", planBlueprint, planBlueprint],
      ["chrona_execution_read", "chrona.execution.read", {}, {}],
      ["chrona_node_result", "chrona.node.result", { status: "complete", nodeId: "node-1", summary: "Done", output: { ok: true } }, { status: "complete", nodeId: "node-1", summary: "Done", output: { ok: true } }],
      ["chrona_node_result", "chrona.node.result", { status: "blocked", reason: "Waiting on API" }, { status: "blocked", reason: "Waiting on API" }],
      ["chrona_node_result", "chrona.node.result", { status: "failed", error: "Command failed" }, { status: "failed", error: "Command failed" }],
    ] as const;

    for (const [externalName, internalName, args, expectedPayload] of cases) {
      const { response, operations } = await postRpcWithOperations(
        rpc("tools/call", {
          name: externalName,
          arguments: args,
          _meta: { sessionId },
        }),
      );

      expect(response.status).toBe(200);
      expect(operations).toHaveLength(1);
      expect(operations[0]).toMatchObject({
        toolName: internalName,
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
    const response = await postRpc(
      rpc("tools/call", {
        name: "chrona_node_result",
        arguments: { status: "complete", summary: "Done" },
        _meta: { sessionId: "chrona:task:task-1:execute" },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.structuredContent.status).toBe("accepted");
    expect(body.result.structuredContent.state.idempotencyKey).toContain("chrona.node.result:");
  });

  it("resolves injected sessionId before dispatching Chrona tools", async () => {
    const response = await postRpc(
      rpc("tools/call", {
        name: "chrona_execution_read",
        arguments: {},
        _meta: { sessionId: "chrona:task:task-1:plan-graph" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      result: {
        structuredContent: {
          status: "accepted",
          affected: { taskId: "task-from-session" },
        },
      },
    });
  });

  it("returns rejected Chrona results as MCP tool errors with structured content", async () => {
    const response = await postRpc(
      rpc("tools/call", {
        name: "chrona_node_result",
        arguments: {
          idempotencyKey: "stale-update",
          status: "complete",
          summary: "Done",
        },
        _meta: { sessionId: "chrona:task:task-1:execute" },
      }),
      true,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      result: {
        isError: true,
        structuredContent: {
          status: "rejected",
          reasonCode: "STALE_STATE",
          recovery: { nextTool: "chrona.execution.read" },
        },
      },
    });
  });

  it("does not expose idempotency fields in mutating tool schemas", async () => {
    const response = await postRpc(
      rpc("tools/list"),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    const nodeResult = body.result.tools.find(
      (tool: { name: string }) => tool.name === "chrona_node_result",
    );
    expect(nodeResult.inputSchema.properties.idempotencyKey).toBeUndefined();
    expect(nodeResult.inputSchema.properties.evidence).toBeUndefined();
    expect(nodeResult.inputSchema.properties.expectedRevision).toBeUndefined();
  });

  it("removes the obsolete custom task-tools endpoint", async () => {
    const response = await app().request("/api/mcp/task-tools");
    expect(response.status).toBe(404);
  });
});
