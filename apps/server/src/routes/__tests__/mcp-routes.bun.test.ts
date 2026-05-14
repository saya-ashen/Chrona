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
        const missingIdempotency = toolName === "chrona.task.update" && !input.idempotencyKey;
        return {
          operationId: rejected ? "op-rejected" : "op-1",
          toolName,
          status: rejected || missingIdempotency ? "rejected" : "accepted",
          reasonCode: rejected
            ? "STALE_STATE"
            : missingIdempotency
              ? "VALIDATION_ERROR"
              : null,
          message: rejected
            ? "Expected state is stale."
            : missingIdempotency
              ? "idempotencyKey is required for mutating Chrona tool calls."
              : "Tool executed.",
          affected: { taskId: input.taskId ?? "task-1" },
          state: { taskStatus: "Ready" },
          idempotency: rejected || missingIdempotency ? "new" : "not_applicable",
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
    await expect(response.json()).resolves.toMatchObject({
      result: { tools: [{ name: "chrona.task.read" }, { name: "chrona.task.update" }] },
    });
  });

  it("lists tool-specific payload schemas derived from Chrona contracts", async () => {
    const response = await postRpc(rpc("tools/list"));

    expect(response.status).toBe(200);
    const body = await response.json();
    const taskRead = body.result.tools.find(
      (tool: { name: string }) => tool.name === "chrona.task.read",
    );
    const taskUpdate = body.result.tools.find(
      (tool: { name: string }) => tool.name === "chrona.task.update",
    );

    expect(taskRead.inputSchema.required ?? []).not.toContain("workspaceId");
    expect(taskRead.inputSchema.properties.sessionId).toMatchObject({ type: "string" });
    expect(taskRead.inputSchema.properties.payload).toMatchObject({ type: "object" });
    expect(taskUpdate.inputSchema.properties.payload.properties).toMatchObject({
      title: { type: "string" },
      status: { type: "string" },
    });
  });

  it("dispatches Chrona tools through tools/call", async () => {
    const response = await postRpc(
      rpc("tools/call", {
        name: "chrona.task.read",
        arguments: { workspaceId: "workspace-1", taskId: "task-1" },
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

  it("resolves injected sessionId before dispatching Chrona tools", async () => {
    const response = await postRpc(
      rpc("tools/call", {
        name: "chrona.task.read",
        arguments: { sessionId: "chrona:hermes:task:task-1:plan-graph" },
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
        name: "chrona.task.update",
        arguments: {
          workspaceId: "workspace-1",
          taskId: "task-1",
          idempotencyKey: "stale-update",
          payload: { title: "Updated" },
        },
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

  it("returns structured validation errors for mutating calls missing idempotency", async () => {
    const response = await postRpc(
      rpc("tools/call", {
        name: "chrona.task.update",
        arguments: {
          workspaceId: "workspace-1",
          taskId: "task-1",
          payload: { title: "Updated" },
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      result: {
        isError: true,
        structuredContent: {
          status: "rejected",
          reasonCode: "VALIDATION_ERROR",
          message: "idempotencyKey is required for mutating Chrona tool calls.",
        },
      },
    });
  });

  it("removes the obsolete custom task-tools endpoint", async () => {
    const response = await app().request("/api/mcp/task-tools");
    expect(response.status).toBe(404);
  });
});
