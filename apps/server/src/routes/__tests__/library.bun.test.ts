import { beforeEach, afterEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { db, resetTestDb, seedTask } from "@chrona/db";
import { createChronaEngine, createManagementClient, revokeManagementClient } from "@chrona/engine";
import { MANAGEMENT_ACCESS_PRESETS } from "@chrona/contracts/api";
import { createManagementMcpRoutes } from "../../../../../features/mcp-control-plane/server";
import { createLibraryRoutes } from "../tasks/library.routes";
import { resetEnvCacheForTests } from "../../config/env";
const keys = ["API_KEY", "CHRONA_LIBRARY_WRITES_ENABLED", "ALLOWED_ORIGINS"] as const, previous = keys.map(k=>process.env[k]);
const engine = createChronaEngine(), app = new Hono().route("/api", createManagementMcpRoutes(engine)).route("/api", createLibraryRoutes());
beforeEach(async () => { await resetTestDb(); process.env.API_KEY = crypto.randomUUID(); process.env.CHRONA_LIBRARY_WRITES_ENABLED = "true"; delete process.env.ALLOWED_ORIGINS; resetEnvCacheForTests(); });
afterEach(async () => { await resetTestDb(); keys.forEach((k,i)=>{ if(previous[i] === undefined) delete process.env[k]; else process.env[k] = previous[i]; }); resetEnvCacheForTests(); });
async function mcp(token: string, name: string, args: unknown) {
  const response = await app.request("http://localhost/api/mcp/management", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": LATEST_PROTOCOL_VERSION }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
  const body = await response.json(); return { status: response.status, result: body.result?.structuredContent, body };
}
async function owner(path: string, body: unknown, token = process.env.API_KEY, origin?: string) {
  const response = await app.request(`http://localhost/api/library/${path}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
test("HTTP owner configures, MCP organizer creates/places, independent reader finds same item; manual placement wins", async () => {
  const agent = await createManagementClient({ name: "Organizer", publicUrl: "http://localhost:3101", scopes: [...MANAGEMENT_ACCESS_PRESETS["library-organize"]] });
  const reader = await createManagementClient({ name: "Reader", publicUrl: "http://localhost:3101", scopes: [...MANAGEMENT_ACCESS_PRESETS["library-read"]] });
  const old = await createManagementClient({ name: "Legacy", publicUrl: "http://localhost:3101", scopes: [...MANAGEMENT_ACCESS_PRESETS.full] });
  const { workspaceId } = await engine.management.authorize(agent.token), { taskId } = await seedTask(workspaceId);
  const read = await owner("read", { view: "catalog" }); expect(read.status).toBe(200);
  const groupInput = { requestId: crypto.randomUUID(), expectedRevision: read.body.revision, action: { type: "group_create", name: "主题", instructions: "根据内容主题整理" } };
  expect((await mcp(agent.token, "chrona_library_update", groupInput)).result.error.code).toBe("FORBIDDEN");
  expect((await owner("update", groupInput, agent.token)).status).toBe(401);
  expect((await owner("update", groupInput, process.env.API_KEY, "https://evil.invalid")).status).toBe(401);
  const configured = await owner("update", groupInput); expect(configured.status).toBe(200);
  const groupId = configured.body.receipt.changes[0].groupId;
  const current = (await mcp(agent.token, "chrona_library_read", { view: "catalog", groupId })).result.data;
  expect(current.groups[0].instructions).toBe("根据内容主题整理");
  const place = { requestId: crypto.randomUUID(), expectedRevision: current.revision, action: { type: "assign", taskId, placements: [{ groupId, destination: { type: "create", name: "设备数码" } }] } };
  const result = await mcp(agent.token, "chrona_library_update", place); expect(result.result.ok).toBe(true);
  expect((await mcp(agent.token, "chrona_library_update", place)).result.data.replayed).toBe(true);
  const content = (await mcp(reader.token, "chrona_library_read", { view: "item", taskId })).result.data;
  expect(content.items[0].placements[0].folderName).toBe("设备数码");
  expect((await mcp(old.token, "chrona_library_read", {})).result.error.code).toBe("FORBIDDEN");
  expect((await mcp(reader.token, "chrona_library_update", place)).result.error.code).toBe("FORBIDDEN");
  const manual = await owner("update", { requestId: crypto.randomUUID(), expectedRevision: content.revision, action: { type: "assign", taskId, placements: [{ groupId, destination: { type: "unclassified" } }] } });
  const attempt = { ...place, requestId: crypto.randomUUID(), expectedRevision: manual.body.receipt.revision };
  expect((await mcp(agent.token, "chrona_library_update", attempt)).result.error.code).toBe("PRECONDITION_FAILED");
  expect((await mcp(agent.token, "chrona_context_read", {})).result.data.capabilities.library).toMatchObject({ canOrganize: true, canConfigure: false });
  expect(await Promise.all([db.run.count(), db.taskPlan.count(), db.taskResult.count(), db.workBlock.count(), db.executionSession.count()])).toEqual([0,0,0,0,0]);
  await revokeManagementClient(agent.clientId); expect((await mcp(agent.token, "chrona_library_update", place)).status).toBe(401);
});
test("default-off, strict schemas, body limits and new scopes do not change legacy credentials", async () => {
  const admin = await createManagementClient({ name: "Explicit taxonomy setup", publicUrl: "http://localhost:3101", scopes: [...MANAGEMENT_ACCESS_PRESETS["library-configure"]] });
  const read = (await mcp(admin.token, "chrona_library_read", {})).result.data;
  delete process.env.CHRONA_LIBRARY_WRITES_ENABLED;
  expect((await mcp(admin.token, "chrona_library_update", { requestId: crypto.randomUUID(), expectedRevision: read.revision, action: { type: "group_create", name: "Topic" } })).result.error.code).toBe("PRECONDITION_FAILED");
  expect((await owner("read", {})).body.canConfigure).toBe(false);
  expect((await owner("read", { workspaceId: "spoof" })).status).toBe(400);
  expect((await owner("read", { query: "x".repeat(40000) })).status).toBe(413);
  for(const [preset, scopes] of Object.entries(MANAGEMENT_ACCESS_PRESETS)) if(!preset.startsWith("library-")) expect(scopes.some(s=>s.startsWith("library:"))).toBe(false);
  await expect(createManagementClient({ name: "Bad", publicUrl: "http://localhost:3101", scopes: ["tasks:read","library:organize"] })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
});
