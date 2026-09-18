import { afterEach, beforeEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { db, resetTestDb, seedTask } from "@chrona/db";
import { createChronaEngine, createManagementClient, revokeManagementClient } from "@chrona/engine";
import { MANAGEMENT_ACCESS_PRESETS } from "@chrona/contracts/api";
import { exampleWorkPage } from "@chrona/ui-protocol/work-pages/example";
import { createManagementMcpRoutes } from "../../../../../features/mcp-control-plane/server";
import { createWorkResultRoutes } from "../tasks/work-results.routes";
import { resetEnvCacheForTests } from "../../config/env";
const keys = ["API_KEY", "CHRONA_WORK_PAGES_WRITES_ENABLED", "CHRONA_RESULT_WRITES_ENABLED", "ALLOWED_ORIGINS"] as const;
const previous = keys.map((key) => process.env[key]);
const engine = createChronaEngine(), app = new Hono().route("/api", createManagementMcpRoutes(engine)).route("/api", createWorkResultRoutes());
beforeEach(async () => { await resetTestDb(); process.env.API_KEY = crypto.randomUUID(); process.env.CHRONA_WORK_PAGES_WRITES_ENABLED = "true"; process.env.CHRONA_RESULT_WRITES_ENABLED = "true"; delete process.env.ALLOWED_ORIGINS; resetEnvCacheForTests(); });
afterEach(async () => { await resetTestDb(); keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; }); resetEnvCacheForTests(); });
async function mcp(token: string, name: string, args: unknown) {
  const response = await app.request("http://localhost/api/mcp/management", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": LATEST_PROTOCOL_VERSION }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
  const body = await response.json(); return { status: response.status, result: body.result?.structuredContent, body };
}
async function owner(path: string, body: unknown, token = process.env.API_KEY, origin?: string) {
  const response = await app.request(`http://localhost/api/results/${path}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

test("real MCP author → owner HTTP answers → fresh MCP reader → next immutable page version", async () => {
  const author = await createManagementClient({ name: "Author", publicUrl: "http://localhost:3101", scopes: [...MANAGEMENT_ACCESS_PRESETS["pages-author"]] });
  const reader = await createManagementClient({ name: "Reader", publicUrl: "http://localhost:3101", scopes: [...MANAGEMENT_ACCESS_PRESETS["pages-read"]] });
  const old = await createManagementClient({ name: "Old results", publicUrl: "http://localhost:3101", scopes: [...MANAGEMENT_ACCESS_PRESETS["results-submit"]] });
  const identity = await engine.management.authorize(author.token), { taskId } = await seedTask(identity.workspaceId);
  const args = { taskId, requestId: crypto.randomUUID(), expectedRevision: null, content: { schemaVersion: 1, outcome: { title: "Plan", summary: "Ready for input" }, readiness: { status: "partial", summary: "Waiting" }, page: exampleWorkPage } };
  expect((await mcp(author.token, "chrona_page_catalog", { taskId })).result.data.components).toContain("Form");
  expect((await mcp(author.token, "chrona_page_validate", { taskId, page: exampleWorkPage })).result.data.valid).toBe(true);
  expect((await mcp(reader.token, "chrona_page_validate", { taskId, page: exampleWorkPage })).result.error.code).toBe("FORBIDDEN");
  expect((await mcp(old.token, "chrona_result_submit", args)).result.error.code).toBe("FORBIDDEN");
  const published = (await mcp(author.token, "chrona_result_submit", args)).result.data.receipt;
  expect(published.version).toBe(1);
  expect((await mcp(old.token, "chrona_result_read", { taskId })).result.data.version.content.page).toBeUndefined();
  const input = await owner("page/read", { taskId });
  const write = { taskId, requestId: crypto.randomUUID(), expectedRevision: input.body.revision, action: { type: "respond", versionId: published.versionId, formKey: "decision", answers: { timing: "wait", thoughts: "Discuss with family" } } };
  expect((await owner("page/input", write, author.token)).status).toBe(401);
  expect((await owner("page/input", write, process.env.API_KEY, "https://evil.invalid")).status).toBe(401);
  expect((await owner("page/input", write)).status).toBe(200);
  expect((await owner("page/input", write)).body.replayed).toBe(true);
  expect((await mcp(reader.token, "chrona_page_read", { taskId })).result.data.entries[0].content.answers.thoughts).toBe("Discuss with family");
  expect((await mcp(author.token, "chrona_page_read", { taskId, actorId: "owner" })).body.result.isError).toBe(true);
  expect((await mcp(author.token, "chrona_result_submit", { ...args, requestId: crypto.randomUUID(), expectedRevision: published.editRevision })).result.data.receipt.version).toBe(2);
  expect((await mcp(reader.token, "chrona_page_read", { taskId, view: "history" })).result.data.entries[0].versionId).toBe(published.versionId);
  expect(await Promise.all([db.run.count(), db.taskPlan.count(), db.taskResultReview.count(), db.executionSession.count(), db.managementCommand.count()])).toEqual([0, 0, 0, 0, 0]);
  await revokeManagementClient(author.clientId); expect((await mcp(author.token, "chrona_result_submit", args)).status).toBe(401);
});

test("default-off page gate preserves reads/validation and never broadens old presets", async () => {
  const author = await createManagementClient({ name: "Author", publicUrl: "http://localhost:3101", scopes: [...MANAGEMENT_ACCESS_PRESETS["pages-author"]] });
  const identity = await engine.management.authorize(author.token), { taskId } = await seedTask(identity.workspaceId);
  delete process.env.CHRONA_WORK_PAGES_WRITES_ENABLED;
  expect((await mcp(author.token, "chrona_page_validate", { taskId, page: exampleWorkPage })).result.data.valid).toBe(true);
  expect((await mcp(author.token, "chrona_context_read", {})).result.data.capabilities.workPages).toMatchObject({ writesEnabled: false, canPublish: false, canRead: true, canSubmitUserResponses: false });
  const note = { taskId, requestId: crypto.randomUUID(), expectedRevision: null, action: { type: "note", noteId: crypto.randomUUID(), text: "disabled" } };
  expect((await owner("page/input", note)).status).toBe(412);
  expect((await owner("page/read", { taskId })).body.canRespond).toBe(false);
  for (const [preset, scopes] of Object.entries(MANAGEMENT_ACCESS_PRESETS)) if (!preset.startsWith("pages-")) expect(scopes.some((s) => s.startsWith("pages:"))).toBe(false);
  expect((await mcp(author.token, "chrona_page_validate", { taskId, page: { ...exampleWorkPage, on: { action: "execute" } } })).result.data.valid).toBe(false);
});
