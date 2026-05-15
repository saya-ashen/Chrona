import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { createMcpRoutes } from "../mcp/mcp.routes";

function app(rejected = false) {
  const engine = {
    agentTools: {
      registry: () => ({
        tools: [
          { name: "chrona.task.read", mutates: false, description: "Read task." },
          { name: "chrona.task.update", mutates: true, description: "Update task." },
        ],
      }),
      resolveInputContext: async (input: unknown) => ({
        ...(input as Record<string, unknown>),
        workspaceId: (input as { workspaceId?: string }).workspaceId ?? "workspace-from-session",
        taskId: (input as { taskId?: string }).taskId ?? "task-from-session",
      }),
      execute: async (operation: unknown) => {
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
          recovery: rejected ? { nextTool: "chrona.task.read" } : null,
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
    expect(body.result.tools.map((tool: { name: string }) => tool.name)).toContain("chrona_task_read");
    expect(body.result.tools.map((tool: { name: string }) => tool.name)).toContain("chrona_plan_read");
  });

  it("lists minimal external tool schemas with descriptions", async () => {
    const response = await postRpc(rpc("tools/list"));

    expect(response.status).toBe(200);
    const body = await response.json();
    const planRead = body.result.tools.find(
      (tool: { name: string }) => tool.name === "chrona_plan_read",
    );
    const planMutate = body.result.tools.find(
      (tool: { name: string }) => tool.name === "chrona_plan_mutate",
    );

    expect(planRead.description).toBe("Read the accepted plan graph state for a task.");
    expect(planRead.inputSchema.required).toBeUndefined();
    expect(Object.keys(planRead.inputSchema.properties)).toEqual([]);
    expect(planRead.inputSchema.properties.sessionId).toBeUndefined();
    const planGenerate = body.result.tools.find(
      (tool: { name: string }) => tool.name === "chrona_plan_generate",
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
    expect(planMutate.inputSchema.required).toEqual(["reason", "operations"]);
    expect(planMutate.inputSchema.properties).toMatchObject({
      operations: { type: "array", description: "Plan graph mutation operations." },
    });
    expect(planMutate.inputSchema.properties.expectedRevision).toBeUndefined();
    expect(planMutate.inputSchema.properties.evidence).toBeUndefined();
    expect(planMutate.inputSchema.properties.idempotencyKey).toBeUndefined();
  });

  it("registers the full external Chrona MCP tool surface", async () => {
    const response = await postRpc(rpc("tools/list"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.tools.map((tool: { name: string }) => tool.name).sort()).toEqual([
      "chrona_execution_dispatch",
      "chrona_execution_read",
      "chrona_plan_generate",
      "chrona_plan_mutate",
      "chrona_plan_read",
      "chrona_schedule_clear",
      "chrona_schedule_propose",
      "chrona_schedule_read",
      "chrona_schedule_set",
      "chrona_task_create",
      "chrona_task_read",
      "chrona_task_update",
    ]);
  });

  it("dispatches Chrona tools through tools/call", async () => {
    const response = await postRpc(
      rpc("tools/call", {
        name: "chrona_task_read",
        arguments: {},
        _meta: { sessionId: "chrona:hermes:task:task-1:execute" },
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

  it("generates idempotency keys for mutating tools without exposing them to the model", async () => {
    const response = await postRpc(
      rpc("tools/call", {
        name: "chrona_task_update",
        arguments: { title: "Updated" },
        _meta: { sessionId: "chrona:hermes:task:task-1:execute" },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.structuredContent.status).toBe("accepted");
    expect(body.result.structuredContent.state.idempotencyKey).toContain("chrona.task.update:");
  });

  it("resolves injected sessionId before dispatching Chrona tools", async () => {
    const response = await postRpc(
      rpc("tools/call", {
        name: "chrona_task_read",
        arguments: {},
        _meta: { sessionId: "chrona:hermes:task:task-1:plan-graph" },
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
        name: "chrona_task_update",
        arguments: {
          idempotencyKey: "stale-update",
          title: "Updated",
        },
        _meta: { sessionId: "chrona:hermes:task:task-1:execute" },
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
          recovery: { nextTool: "chrona.task.read" },
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
    const taskUpdate = body.result.tools.find(
      (tool: { name: string }) => tool.name === "chrona_task_update",
    );
    expect(taskUpdate.inputSchema.properties.idempotencyKey).toBeUndefined();
    expect(taskUpdate.inputSchema.properties.evidence).toBeUndefined();
    expect(taskUpdate.inputSchema.properties.expectedRevision).toBeUndefined();
  });

  it("removes the obsolete custom task-tools endpoint", async () => {
    const response = await app().request("/api/mcp/task-tools");
    expect(response.status).toBe(404);
  });
});
