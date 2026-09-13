import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { LATEST_PROTOCOL_VERSION, ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv-provider.js";
import type { JsonSchemaType } from "@modelcontextprotocol/sdk/validation/types.js";
import { managementCreateSchema } from "@chrona/contracts/api";
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
  it("advertises mode constraints and valid examples in the actual tools/list schema", async () => {
    const client = await createManagementClient({ name: "Schema test", publicUrl: "http://localhost:3101" });
    const response = await call(client.token, "tools/list", {});
    const tools = ListToolsResultSchema.parse(response.body.result).tools;
    const create = tools.find((tool) => tool.name === "chrona_task_create")!;
    expect(create.inputSchema.type).toBe("object");
    expect(create.inputSchema.allOf).toBeArray();
    expect(create.inputSchema.properties?.start).toMatchObject({ description: expect.stringContaining("Only for automatic") });
    expect(create.inputSchema.properties?.mode).toMatchObject({ description: expect.stringContaining("not an independent manual-todo") });
    expect(tools.find((tool) => tool.name === "chrona_task_read")!.inputSchema.properties?.view).toMatchObject({ enum: expect.arrayContaining(["compact", "summary", "config"]) });
    const validate = new AjvJsonSchemaValidator().getValidator(create.inputSchema as JsonSchemaType);
    const examples = managementCreateSchema.meta()!.examples as unknown[];
    expect(examples).toHaveLength(3);
    for (const example of examples) {
      expect(create.inputSchema.description).toContain(JSON.stringify(example));
      expect(validate(example).valid).toBe(true);
      expect(managementCreateSchema.safeParse(example).success).toBe(true);
    }
    const window = { startsAt: "2030-01-01T10:00:00+08:00", endsAt: "2030-01-01T11:00:00+08:00", timezone: "Asia/Shanghai" };
    // Structural conditions must survive SDK conversion, including omitted keys.
    // Timestamp ordering and timezone equality still require runtime validation.
    const dimensions = {
      mode: ["todo", "plan", "automatic"], start: [undefined, "now", "scheduled"], schedule: [undefined, window],
      timing: [undefined, {}, { plan: "immediate" }, { plan: "before_1d" }, { execution: "immediate" }, { execution: "before_1d" }],
      recurrence: [undefined, { rule: "FREQ=DAILY;COUNT=2", timezone: "Asia/Shanghai" }],
    };
    let cases: Record<string, unknown>[] = [{ requestId: crypto.randomUUID(), title: "Schema parity" }];
    for (const [key, values] of Object.entries(dimensions)) {
      cases = cases.flatMap((input) => values.map((value) => ({ ...input, [key]: value })));
    }
    for (const value of cases) {
      const input = JSON.parse(JSON.stringify(value));
      expect({ input, valid: validate(input).valid }).toEqual({ input, valid: managementCreateSchema.safeParse(input).success });
    }
  });

  it("returns schedule receipts and compact reads without claiming notification delivery", async () => {
    const client = await createManagementClient({ name: "Schedule protocol", publicUrl: "http://localhost:3101", timezone: "Asia/Shanghai" });
    const context = await call(client.token, "tools/call", { name: "chrona_context_read", arguments: {} });
    expect(context.body.result.structuredContent.data.capabilities.reminders).toMatchObject({ customRules: false, deliveryChannels: [] });
    const input = { requestId: crypto.randomUUID(), title: "Application check", mode: "todo",
      schedule: { startsAt: "2030-10-01T09:00:00+08:00", endsAt: "2030-10-01T09:15:00+08:00", timezone: "Asia/Shanghai" } };
    const invalid = await call(client.token, "tools/call", { name: "chrona_task_create", arguments: { ...input, start: "scheduled" } });
    expect(invalid.body.result.isError).toBe(true);
    const created = await call(client.token, "tools/call", { name: "chrona_task_create", arguments: input });
    expect(created.body.result.isError).toBe(false);
    const receipt = created.body.result.structuredContent.data;
    expect(receipt.result.task.status).toBe("Draft");
    expect(receipt.result.schedule.startsAt).toBe("2030-10-01T01:00:00.000Z");
    const read = await call(client.token, "tools/call", { name: "chrona_task_read", arguments: { taskId: receipt.taskId, view: "compact" } });
    const compact = read.body.result.structuredContent.data;
    expect(compact.schedule).toEqual(receipt.result.schedule);
    expect(compact.automation).toMatchObject({ autoPlanGeneration: false, autoExecute: false });
    expect(Object.keys(compact).sort()).toEqual(["automation", "dueAt", "revision", "schedule", "task"]);
    const invalidRead = await call(client.token, "tools/call", { name: "chrona_task_read", arguments: { taskId: receipt.taskId, view: "compact", planSource: "saved" } });
    expect(invalidRead.body.result.isError).toBe(true);
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
