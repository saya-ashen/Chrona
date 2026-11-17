import { afterEach, expect, test } from "bun:test";
import "./module-effects";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moduleManifestSchema, RUN_LIMITS, type ModuleManifest } from "@chrona/contracts/steward";
import { createModules } from "./modules";
import { registerSystemModules } from "../system/system-modules";
import { callModuleTool, moduleToolCatalog } from "./module-tools";
import type { StewardPorts } from "../ports";
import { testDb } from "../__testing__/test-db";
import { testModuleSandbox } from "../__testing__/module-test-process";
import { moduleSupervisor } from "./module-supervisor";
import { callsSettled } from "./module-calls";
import { moduleContext } from "./module-context";
import { recordModuleActivation } from "./module-evolution";
import { notice, notices } from "../__testing__/test-notices";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture() {
  const db = testDb(), dataDir = await mkdtemp(join(tmpdir(), "chrona-module-tools-"));
  cleanups.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const now = new Date("2026-10-21T04:00:00Z"), calls: unknown[] = [];
  let error: string | null = null;
  const ports: StewardPorts = { db, dataDir, now: () => now, publicUrl: null,
    sandbox: testModuleSandbox(async input => {
      if (input.codeDir.endsWith("notify-fixture")) return { status: "succeeded", exitCode: 0, error: null, output: JSON.stringify({ result: { id: "fixture-notice", status: "pending", duplicate: false } }) };
      calls.push(input);
      return { status: error ? "failed" : "succeeded", exitCode: error ? 1 : 0, error,
        output: JSON.stringify({ result: { found: 3 }, effects: [{ type: "notify_user", key: "found", level: "now", title: "Found", body: "Three" }] }) };
    }),
  };
  cleanups.push(async () => { await callsSettled(ports); await moduleSupervisor(ports).stop(); });
  const workspaceId = (await db.workspace.create({ data: { name: "tools" } })).id;
  registerSystemModules();
  const notifyManifest = moduleManifestSchema.parse({ name: "notify", entry: "index.ts", tests: ["test.ts"], effects: [], tools: [{ name: "send", description: "Synthetic send", visibility: ["modules"], parameters: { type: "object", properties: {}, additionalProperties: true }, output: {} }] });
  const notify = await db.module.create({ data: { workspaceId, name: "notify", activeHash: "notify-fixture" } });
  await db.moduleVersion.create({ data: { moduleId: notify.id, hash: "notify-fixture", manifest: notifyManifest, intent: {}, source: "user", report: {}, status: "approved" } });
  const api = createModules(ports, workspaceId);
  const module = await db.module.create({ data: { workspaceId, name: "mail-sort", activeHash: "hash" } });
  const tool: ModuleManifest["tools"][number] = { name: "find-mail", description: "Find matching mail", visibility: ["provider", "owner"], idempotent: false, parameters: { type: "object", properties: { query: { type: "string" }, count: { type: "number" }, unread: { type: "boolean" }, folder: { type: "string", enum: ["inbox", "sent"] } }, required: ["query"] },
      output: {}
};
  const manifest = { name: module.name, entry: "index.ts", tests: ["test.ts"], effects: ["network"], uses: ["notify.send"], params: { limit: { type: "number", value: 3 } }, tools: [tool] };
  await db.moduleVersion.create({ data: { moduleId: module.id, hash: "hash", manifest, intent: {}, source: "user", report: {}, status: "approved" } });
  await db.$transaction(tx => recordModuleActivation(moduleContext(ports, workspaceId), tx, { moduleId: module.id, previousHash: null, hash: "hash" }));
  const session = await db.agentContext.create({ data: { workspaceId, ownerId: "owner", moduleId: module.id, hash: "hash" } });
  const run = await db.run.create({ data: { workspaceId, sessionId: session.id, lane: "foreground", trigger: "message", prompt: "Find mail", provider: "fake", tokenHash: "fixture-provider-token", cwd: dataDir } });
  return { db, ports, api, module, manifest, tool, session, run, calls, workspaceId,
    catalog: () => moduleToolCatalog(ports, { workspaceId }),
    call: (args: unknown = { query: "hello" }, name = "m_mail_sort_find_mail") => callModuleTool(ports, { workspaceId, sessionId: session.id, runId: run.id }, name, args),
    fail: (message = "public stderr") => { error = message; } };
}
test("catalog groups deferred application tools with their schema and description", async () => {
  const f = await fixture(), catalog = await f.catalog();
  expect(catalog.at(-1)).toEqual({ name: "m_mail_sort_find_mail", exposure: "deferred", namespace: { name: "module_mail_sort", description: "Find matching mail" }, description: "Find matching mail",
    inputSchema: { ...f.tool.parameters, additionalProperties: false, description: "[module mail-sort] Find matching mail" }, outputSchema: {}, examples: null, sideEffects: null, errors: null,
    idempotent: false, retry: "Unknown async outcomes are not redelivered automatically." });
});
test("deferred tools retain routed caller identity", async () => {
  const f = await fixture();
  await f.db.moduleVersion.updateMany({ where: { moduleId: f.module.id }, data: { manifest: { ...f.manifest, description: "Sort and search work mail" } } });
  expect((await f.catalog()).at(-1)).toMatchObject({ name: "m_mail_sort_find_mail", exposure: "deferred", namespace: { name: "module_mail_sort", description: "Sort and search work mail" } });
  expect(await f.call()).toMatchObject({ result: { found: 3 } });
  expect(await notice(f.db)).toMatchObject({ moduleId: f.module.id });
  expect(await f.db.audit.findFirstOrThrow({ where: { kind: "module_tool_call" } })).toMatchObject({ actorKey: "chrona", subjectId: f.module.id, details: { tool: "m_mail_sort_find_mail", callerRunId: f.run.id, callerSessionId: f.session.id } });
});
test("module names are unique within the workspace", async () => {
  const f = await fixture();
  await expect((async () => { await f.db.module.create({ data: { workspaceId: f.workspaceId, name: "mail-sort" } }); })()).rejects.toThrow();
});
test("owner tools list every toolset and call as the user", async () => {
  const f = await fixture(), api = f.api;
  const { tools, toolsets } = await api.tools();
  // Chrona's own tools open to the user (v2-13) come first.
  expect(tools.map(tool => tool.name)).toEqual([
    "m_approvals_list", "m_approvals_resolve",
    "m_modules_list", "m_modules_describe", "m_modules_health", "m_modules_admit", "m_modules_receipt",
    "m_modules_enable", "m_modules_disable", "m_modules_rollback", "m_modules_remove", "m_modules_operation", "m_settings_update",
    "m_secrets_set", "m_secrets_remove", "m_secrets_list", "m_activity_runtime", "m_activity_runs", "m_activity_records", "m_activity_usage", "m_activity_consumer", "m_agent_providers", "m_mail_sort_find_mail",
  ]);
  expect(toolsets.find(set => set.name === "module_mail_sort")).toEqual({ name: "module_mail_sort", description: "Find matching mail", tools: ["m_mail_sort_find_mail"] });
  expect(await api.callTool("m_mail_sort_find_mail", { query: "hi" })).toMatchObject({ result: { found: 3 } });
  expect(await f.db.audit.findFirstOrThrow({ where: { kind: "module_tool_call" } })).toMatchObject({ actorKey: "user", details: { callerRunId: null, callerSessionId: null } });
  await expect(api.callTool("m_mail_sort_find_mail", {})).rejects.toMatchObject({ code: "invalid" });
});
test.each([
  [{}, "query"], [{ query: 1 }, "query"], [{ query: "ok", count: "1" }, "count"],
  [{ query: "ok", unread: "yes" }, "unread"], [{ query: "ok", folder: "trash" }, "folder"],
  [{ query: "ok", extra: true }, "extra"],
])("argument validation lists invalid fields: %j", async (args, field) => {
  const f = await fixture();
  await expect(f.call(args)).rejects.toMatchObject({ code: "invalid", message: expect.stringContaining(field) });
  expect(f.calls).toEqual([]); expect(await f.db.moduleRun.count()).toBe(0);
});
test("native objects and arrays stay structured through validation, Provider schema and module event", async () => {
  const f = await fixture();
  const tool = { ...f.tool, parameters: { type: "object" as const, properties: { filters: { type: "array" as const, items: { type: "object" as const,
    properties: { query: { type: "string" as const, enum: ["open", "closed"] }, tags: { type: "array" as const, items: { type: "string" as const } }, count: { type: "number" as const } }, required: ["query"], additionalProperties: false } }, empty: { type: "object" as const, properties: {}, required: [] } }, required: ["filters"] } };
  await f.db.moduleVersion.updateMany({ where: { moduleId: f.module.id }, data: { manifest: { ...f.manifest, tools: [tool] } } });
  const schema = (await f.catalog()).at(-1)?.inputSchema;
  expect(schema).toMatchObject({ properties: { filters: { type: "array", items: { type: "object", additionalProperties: false, required: ["query"] } } } });
  const args = { filters: [{ query: "open", tags: ["priority", "today"], count: 2 }, { query: "closed" }], empty: {} };
  expect(await f.call(args)).toMatchObject({ result: { found: 3 } });
  expect(f.calls[0]).toMatchObject({ input: { trigger: { args } } });
  expect(await f.api.callTool("m_mail_sort_find_mail", args)).toMatchObject({ result: { found: 3 } });
  expect(f.calls[1]).toMatchObject({ input: { trigger: { args } } });
  for (const invalid of [null, { filters: "[]" }, { filters: [{ query: "other" }] }, { filters: [{ query: "open", unexpected: true }] }, { filters: [{ query: "open", count: Infinity }] }, { filters: [{ query: "open" }, null] }, {}]) {
    f.calls.length = 0;
    await expect(f.call(invalid)).rejects.toMatchObject({ code: "invalid" });
    expect(f.calls).toEqual([]);
  }
});
test("success returns result, runs sandbox with scoped input and deduplicates shared effects", async () => {
  const f = await fixture(), args = { query: "hello", count: 2, unread: true, folder: "inbox" };
  expect(await f.call(args)).toEqual({ result: { found: 3 } });
  expect(await f.call(args)).toEqual({ result: { found: 3 } });
  expect(await f.db.moduleCall.count({ where: { moduleId: f.module.id, method: "call", status: { not: "rejected" } } })).toBe(0);
  expect(f.calls[0]).toMatchObject({ codeDir: join(f.ports.dataDir, "platform/store/hash"), dataDir: join(f.ports.dataDir, "platform/data", f.module.id), entry: "index.ts", network: true, timeoutMs: RUN_LIMITS.jobTimeoutMs, maxOutputBytes: RUN_LIMITS.jobOutputBytes,
    input: { trigger: { id: "find-mail", kind: "tool", firedAt: f.ports.now().toISOString(), args, caller: { kind: "provider", runId: expect.any(String) }, call: { id: expect.any(String), key: null, attempt: 1, chain: [] } }, now: f.ports.now().toISOString(), params: { limit: 3 } } });
  expect((await notices(f.db)).length).toBe(1);
  expect(await f.db.run.count({ where: { lane: "background" } })).toBe(0);
  expect(await f.db.moduleRun.findFirstOrThrow({ where: { moduleId: f.module.id } })).toMatchObject({ triggerId: "tool:find-mail", firedAt: f.ports.now(), exitCode: 0, error: null });
});
test("module failure returns truncated public stderr and shares the consecutive failure pause", async () => {
  const f = await fixture();
  f.fail("x".repeat(3000));
  for (let i = 0; i < 3; i++) await expect(f.call()).rejects.toMatchObject({ code: "failed", message: expect.stringContaining("x".repeat(1900)) });
  expect((await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).status).toBe("paused");
  expect(await f.db.moduleRun.count()).toBe(3);
  expect((await notices(f.db, { kind: "module-paused" })).length).toBe(1);
  await expect(f.call()).rejects.toMatchObject({ code: "not_found" });
  expect((await f.catalog()).some(tool => tool.name.startsWith("m_mail_sort_"))).toBe(false);
});
test.each(["paused", "migrating", "no-hash"])("catalog and call re-resolve module state: %s", async status => {
  const f = await fixture(), before = await f.catalog();
  await f.db.module.update({ where: { id: f.module.id }, data: status === "no-hash" ? { activeHash: null } : { status } });
  await expect(f.call()).rejects.toMatchObject({ code: "not_found" });
  expect((await f.catalog()).length).toBe(before.length - 1);
});
test("ambiguous concatenated names expose and call only the first tool; overlong names are hidden", async () => {
  const f = await fixture();
  const module = await f.db.module.create({ data: { workspaceId: f.workspaceId, name: "mail-sort-find", activeHash: "later" } });
  await f.db.moduleVersion.create({ data: { moduleId: module.id, hash: "later", manifest: { ...f.manifest, name: module.name, tools: [{ ...f.tool, name: "mail", description: "Hidden collision" }] }, intent: {}, source: "user", report: {}, status: "approved" } });
  const catalog = await f.catalog();
  expect(catalog.filter(tool => tool.name === "m_mail_sort_find_mail")).toHaveLength(1);
  expect(catalog.at(-1)?.inputSchema.description).toBe("[module mail-sort] Find matching mail");
  await f.call(); expect(await f.db.moduleRun.findFirstOrThrow({ where: { moduleId: f.module.id } })).toMatchObject({ moduleId: f.module.id });
  await f.db.module.update({ where: { id: module.id }, data: { name: "a".repeat(64) } });
  expect((await f.catalog()).length).toBe(catalog.length);
});
test("call uses the current version rather than a previously catalogued schema", async () => {
  const f = await fixture(); await f.catalog();
  await f.db.moduleVersion.updateMany({ where: { moduleId: f.module.id }, data: { manifest: { ...f.manifest, tools: [{ ...f.tool, parameters: { type: "object", properties: { changed: { type: "boolean" } }, required: ["changed"] } }] } } });
  await expect(f.call()).rejects.toMatchObject({ code: "invalid", message: expect.stringContaining("changed") });
});

test.each(["building", "testing", "pending_review", "rejected", "active", "missing", "malformed"])("catalog and calls refuse an active pointer without an approved valid version: %s", async status => {
  const f = await fixture();
  expect((await f.catalog()).some(tool => tool.name === "m_mail_sort_find_mail")).toBe(true);
  if (status === "missing") await f.db.moduleVersion.deleteMany({ where: { moduleId: f.module.id } });
  else await f.db.moduleVersion.updateMany({ where: { moduleId: f.module.id }, data: status === "malformed" ? { manifest: { name: "invalid" } } : { status } });
  for (const tools of [await f.catalog(), (await f.api.tools()).tools]) {
    expect(tools.some(tool => tool.name === "m_mail_sort_find_mail")).toBe(false);
  }
  await expect(f.call()).rejects.toMatchObject({ code: "not_found" });
  await expect(f.api.callTool("m_mail_sort_find_mail", { query: "hi" })).rejects.toMatchObject({ code: "not_found" });
  expect(f.calls).toEqual([]);
  expect(await f.db.moduleRun.count()).toBe(0);
  expect(await f.db.audit.count({ where: { kind: "module_tool_call" } })).toBe(0);
});
