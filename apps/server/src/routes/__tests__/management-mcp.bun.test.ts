import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { LATEST_PROTOCOL_VERSION, ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { createChronaEngine, createManagementClient, revokeManagementClient } from "@chrona/engine";
import { resetTestDb } from "@chrona/db/test-support";
import { createManagementMcpRoutes } from "../../../../../features/mcp-control-plane/server";

beforeEach(resetTestDb);
const app = new Hono().route("/api", createManagementMcpRoutes(createChronaEngine()));
async function call(token: string, method: string, params: unknown, id = 1) {
  const response = await app.request("http://localhost/api/mcp/management", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": LATEST_PROTOCOL_VERSION }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
  return { status: response.status, body: await response.json() };
}

describe("management MCP protocol", () => {
  it("never accepts an anonymous/local/API-key caller", async () => {
    expect((await call("", "tools/list", {})).status).toBe(401);
    expect((await call("global-key", "tools/list", {})).status).toBe(401);
  });
  it("initializes statelessly, lists seven actual tools, calls through the protocol and revokes immediately", async () => {
    const client = await createManagementClient({ name: "MCP test", publicUrl: "http://localhost:3101" });
    const initialize = await call(client.token, "initialize", { protocolVersion: LATEST_PROTOCOL_VERSION, clientInfo: { name: "test", version: "1" }, capabilities: {} });
    expect(initialize.status).toBe(200);
    const tools = await call(client.token, "tools/list", {});
    expect(ListToolsResultSchema.parse(tools.body.result).tools).toHaveLength(7);
    const create = await call(client.token, "tools/call", { name: "chrona_task_create", arguments: { requestId: crypto.randomUUID(), title: "From external agent", mode: "todo" } });
    expect(create.body.result.isError).toBe(false);
    expect(create.body.result.structuredContent.data.state).toBe("completed");
    const taskId = create.body.result.structuredContent.data.taskId;
    const read = await call(client.token, "tools/call", { name: "chrona_task_read", arguments: { taskId } });
    expect(read.body.result.structuredContent.data.task.title).toBe("From external agent");
    const invalid = await call(client.token, "tools/call", { name: "chrona_task_create", arguments: { requestId: crypto.randomUUID(), title: "No arbitrary scope", mode: "todo", workspaceId: "injected" } });
    expect(invalid.body.result.isError).toBe(true);
    const get = await app.request("http://localhost/api/mcp/management", { headers: { Authorization: `Bearer ${client.token}` } });
    expect(get.status).toBe(405);
    await revokeManagementClient(client.clientId);
    expect((await call(client.token, "tools/list", {})).status).toBe(401);
  });
});
