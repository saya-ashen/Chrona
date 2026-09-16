import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { LATEST_PROTOCOL_VERSION, ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv-provider.js";
import type { JsonSchemaType } from "@modelcontextprotocol/sdk/validation/types.js";
import { managementCreateSchema } from "@chrona/contracts/api";
import { createChronaEngine, createManagementClient, revokeManagementClient } from "@chrona/engine";
import { db } from "@chrona/db";
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
    expect(create.inputSchema.properties?.taskExecutionMode).toMatchObject({ enum: ["ai", "manual"] });
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

  it("advertises and captures a Goal draft through the actual protocol without task authority", async () => {
    const client = await createManagementClient({ name: "Capture agent", publicUrl: "http://localhost:3101", scopes: ["goals:read", "goals:propose"] });
    const response = await call(client.token, "tools/list", {});
    const tools = ListToolsResultSchema.parse(response.body.result).tools;
    const tool = tools.find((entry) => entry.name === "chrona_goal_propose")!;
    expect(tool.inputSchema.type).toBe("object");
    expect(tool.inputSchema.additionalProperties).toBe(false);
    expect(tool.description).toContain("never starts");
    expect(tools.find((entry) => entry.name === "chrona_goal_read")?.annotations?.readOnlyHint).toBe(true);
    const input = { requestId: crypto.randomUUID(), title: "Watch opportunities", rationale: "New opportunities appear", firstStep: "Review the source list", expectedOutcome: "Relevant verified findings", permissionRequest: "Public research only; ask before contacting anyone", sourceSummary: "The user asked for a continuing search" };
    const validate = new AjvJsonSchemaValidator().getValidator(tool.inputSchema as JsonSchemaType);
    expect(validate(input).valid).toBe(true);
    expect(validate({ ...input, approved: true }).valid).toBe(false);
    const created = await call(client.token, "tools/call", { name: "chrona_goal_propose", arguments: input });
    expect(created.body.result.isError).toBe(false);
    const receipt = created.body.result.structuredContent.data;
    expect(receipt.result).toMatchObject({ outcome: "goal_proposed", executionStarted: false, permissionsGranted: false });
    const goalId = receipt.result.goal.goalId;
    const read = await call(client.token, "tools/call", { name: "chrona_goal_read", arguments: { goalId, view: "brief" } });
    expect(read.body.result.structuredContent.data).toMatchObject({ goal: { status: "Draft" }, constraintsAreNotPermissionGrants: true });
    const forbidden = await call(client.token, "tools/call", { name: "chrona_task_create", arguments: { requestId: crypto.randomUUID(), title: "Must not run", mode: "automatic", start: "now" } });
    expect(forbidden.body.result.structuredContent.error.code).toBe("FORBIDDEN");
    expect(await db.task.count()).toBe(0);
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

  it("creates and completes a manual task through actual tools/call", async () => {
    const client = await createManagementClient({ name: "Manual MCP", publicUrl: "http://localhost:3101" });
    const created = await call(client.token, "tools/call", { name: "chrona_task_create", arguments: { requestId: crypto.randomUUID(), title: "Manual protocol task", mode: "todo", taskExecutionMode: "manual" } });
    expect(created.body.result.isError).toBe(false);
    const taskId = created.body.result.structuredContent.data.taskId;
    const compact = await call(client.token, "tools/call", { name: "chrona_task_read", arguments: { taskId, view: "compact" } });
    const expectedRevision = compact.body.result.structuredContent.data.revision;
    const requestId = crypto.randomUUID();
    const args = { requestId, taskId, action: { type: "manual_complete", expectedRevision } };
    const completed = await call(client.token, "tools/call", { name: "chrona_task_action", arguments: args });
    const replay = await call(client.token, "tools/call", { name: "chrona_task_action", arguments: args });
    expect(completed.body.result.isError).toBe(false);
    expect(replay.body.result.structuredContent.data).toMatchObject({ commandId: completed.body.result.structuredContent.data.commandId, replayed: true });
    expect(await db.event.count({ where: { taskId, eventType: "task.done" } })).toBe(1);
    const read = await call(client.token, "tools/call", { name: "chrona_task_read", arguments: { taskId } });
    expect(read.body.result.structuredContent.data.task).toMatchObject({ taskExecutionMode: "manual", status: "Done" });
    expect(read.body.result.structuredContent.data.availableActions).toContainEqual(expect.objectContaining({ type: "manual_reopen", expectedRevision: read.body.result.structuredContent.data.revision }));
    const stale = await call(client.token, "tools/call", { name: "chrona_task_action", arguments: { requestId: crypto.randomUUID(), taskId, action: { type: "manual_reopen", expectedRevision } } });
    const collision = await call(client.token, "tools/call", { name: "chrona_task_action", arguments: { requestId, taskId, action: { type: "manual_reopen", expectedRevision } } });
    const foreign = await createManagementClient({ name: "Foreign manual MCP", publicUrl: "http://localhost:3101" });
    const foreignWorkspace = await db.workspace.create({ data: { name: "Foreign management workspace", status: "Active" } });
    await db.managementClient.update({ where: { id: foreign.clientId }, data: { workspaceId: foreignWorkspace.id } });
    const foreignAction = await call(foreign.token, "tools/call", { name: "chrona_task_action", arguments: { requestId: crypto.randomUUID(), taskId, action: { type: "manual_reopen", expectedRevision: read.body.result.structuredContent.data.revision } } });
    expect(stale.body.result.isError).toBe(true);
    expect(collision.body.result.isError).toBe(true);
    expect(foreignAction.body.result.isError).toBe(true);
    expect(await db.task.findUniqueOrThrow({ where: { id: taskId }, select: { status: true } })).toEqual({ status: "Done" });
  });

  it("rejects manual MCP AI updates and actions before a command can create AI records", async () => {
    const client = await createManagementClient({ name: "Manual MCP guards", publicUrl: "http://localhost:3101" });
    const created = await call(client.token, "tools/call", { name: "chrona_task_create", arguments: { requestId: crypto.randomUUID(), title: "Manual guard task", mode: "todo", taskExecutionMode: "manual" } });
    const taskId = created.body.result.structuredContent.data.taskId;
    const read = await call(client.token, "tools/call", { name: "chrona_task_read", arguments: { taskId, view: "compact" } });
    const revision = read.body.result.structuredContent.data.revision;
    const update = await call(client.token, "tools/call", { name: "chrona_task_update", arguments: { requestId: crypto.randomUUID(), taskId, expectedRevision: revision, patch: { mode: "plan" } } });
    expect(update.body.result.isError).toBe(true);
    const generate = await call(client.token, "tools/call", { name: "chrona_task_action", arguments: { requestId: crypto.randomUUID(), taskId, action: { type: "generate_plan" } } });
    expect(generate.body.result.isError).toBe(true);
  });

  it("initializes statelessly, lists ten actual tools, calls through the protocol and revokes immediately", async () => {
    const client = await createManagementClient({ name: "MCP test", publicUrl: "http://localhost:3101" });
    const initialize = await call(client.token, "initialize", { protocolVersion: LATEST_PROTOCOL_VERSION, clientInfo: { name: "test", version: "1" }, capabilities: {} });
    expect(initialize.status).toBe(200);
    const tools = await call(client.token, "tools/list", {});
    expect(ListToolsResultSchema.parse(tools.body.result).tools).toHaveLength(10);
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
