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
      execute: async (operation: unknown) => ({
        operationId: rejected ? "op-rejected" : "op-1",
        toolName: (operation as { toolName: string }).toolName,
        status: rejected ? "rejected" : "accepted",
        reasonCode: rejected ? "STALE_STATE" : null,
        message: rejected ? "Expected state is stale." : "Tool executed.",
        affected: { taskId: "task-1" },
        state: { taskStatus: "Ready" },
        idempotency: rejected ? "new" : "not_applicable",
        auditRef: rejected ? "op-rejected" : null,
        recovery: rejected ? { nextTool: "chrona.task.read" } : null,
        completedAt: new Date().toISOString(),
      }),
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

  it("removes the obsolete custom task-tools endpoint", async () => {
    const response = await app().request("/api/mcp/task-tools");
    expect(response.status).toBe(404);
  });
});
