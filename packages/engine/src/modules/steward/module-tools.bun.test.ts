import { afterEach, expect, test } from "bun:test";
import "./module-effects";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHRONA_TOOLS, RUN_LIMITS, type ModuleManifest } from "@chrona/contracts/steward";
import { createStewardService } from "./service";
import type { StewardPorts } from "./ports";
import { testDb } from "./test-db";
import { testModuleSandbox } from "./module-test-process";
import { moduleSupervisor } from "./module-supervisor";
import { moduleContext } from "./module-context";
import { recordModuleActivation } from "./module-evolution";
// Provider-visible system module tools, including diagnostics and development references.
const MODULES_TOOLS = 14;
import { notice, notices } from "./test-notices";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture() {
  const db = testDb(), dataDir = await mkdtemp(join(tmpdir(), "chrona-module-tools-"));
  cleanups.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const now = new Date("2026-10-21T04:00:00Z"), calls: unknown[] = [];
  let error: string | null = null;
  const ports: StewardPorts = { db, dataDir, now: () => now, publicUrl: null,
    sandbox: testModuleSandbox(async input => {
      calls.push(input);
      return { status: error ? "failed" : "succeeded", exitCode: error ? 1 : 0, error,
        output: JSON.stringify({ result: { found: 3 }, effects: [{ type: "notify_user", key: "found", level: "now", title: "Found", body: "Three" }, { type: "wake_provider", key: "wake", prompt: "Review" }] }) };
    }),
  };
  cleanups.push(() => moduleSupervisor(ports).stop());
  const workspaceId = (await db.workspace.create({ data: { name: "tools" } })).id;
  const service = createStewardService(ports), api = service.forWorkspace(workspaceId);
  const session = await db.session.create({ data: { workspaceId, source: "web", key: "web:test", focus: ["mail-sort"] } });
  const module = await db.module.create({ data: { workspaceId, name: "mail-sort", activeHash: "hash" } });
  const tool: ModuleManifest["tools"][number] = { name: "find-mail", description: "Find matching mail", visibility: ["provider", "owner"], idempotent: false, parameters: { type: "object", properties: { query: { type: "string" }, count: { type: "number" }, unread: { type: "boolean" }, folder: { type: "string", enum: ["inbox", "sent"] } }, required: ["query"] } };
  const manifest = { name: module.name, entry: "index.ts", tests: ["test.ts"], effects: ["network"], uses: ["notify.send", "provider.wake"], params: { limit: { type: "number", value: 3 } }, triggers: [{ id: "daily", schedule: { kind: "daily", time: "09:00" } }], tools: [tool] };
  await db.moduleVersion.create({ data: { moduleId: module.id, hash: "hash", manifest, intent: {}, source: "user", report: {}, status: "approved" } });
  await db.$transaction(tx => recordModuleActivation(moduleContext(ports, workspaceId), tx, { moduleId: module.id, previousHash: null, hash: "hash", generationId: "fixture" }));
  await api.runs.enqueue({ sessionId: session.id, lane: "foreground", trigger: "message", prompt: "Find mail" });
  const run = (await api.runs.claimNext("foreground"))!;
  return { db, ports, service, module, manifest, tool, session, run, calls, workspaceId,
    call: (args: unknown = { query: "hello" }, name = "m_mail_sort_find_mail") => service.tools.call(run.token, name, args),
    fail: (message = "public stderr") => { error = message; } };
}
test("catalog appends focused module tools with schema, meaningful description and their toolset", async () => {
  const f = await fixture(), catalog = await f.service.tools.catalog(f.run.token);
  expect(catalog.slice(0, CHRONA_TOOLS.length).map(tool => tool.name)).toEqual([...CHRONA_TOOLS]);
  expect(catalog.at(-1)).toEqual({ name: "m_mail_sort_find_mail", exposure: "direct", namespace: { name: "module_mail_sort", description: "Find matching mail" }, description: "Find matching mail",
    inputSchema: { ...f.tool.parameters, additionalProperties: false, description: "[module mail-sort] Find matching mail" }, outputSchema: null, examples: null, sideEffects: null, errors: null,
    idempotent: false, retry: "Unknown async outcomes are not redelivered automatically." });
});
test("unfocused sessions find deferred module tools", async () => {
  const f = await fixture();
  await f.db.moduleVersion.updateMany({ data: { manifest: { ...f.manifest, description: "Sort and search work mail" } } });
  await f.db.session.update({ where: { id: f.session.id }, data: { focus: [] } });
  expect((await f.service.tools.catalog(f.run.token)).at(-1)).toMatchObject({ name: "m_mail_sort_find_mail", exposure: "deferred", namespace: { name: "module_mail_sort", description: "Sort and search work mail" } });
  expect(await f.call()).toMatchObject({ result: { found: 3 } });
  expect(await notice(f.db)).toMatchObject({ moduleId: f.module.id });
  expect(await f.db.audit.findFirstOrThrow({ where: { kind: "module_tool_call" } })).toMatchObject({ actorKey: "chrona", subjectId: f.module.id, details: { tool: "m_mail_sort_find_mail", callerRunId: f.run.id, callerSessionId: f.session.id } });
});
test("module names are unique within the workspace", async () => {
  const f = await fixture();
  await expect((async () => { await f.db.module.create({ data: { workspaceId: f.workspaceId, name: "mail-sort" } }); })()).rejects.toThrow();
});
test("owner tools list every toolset and call as the user", async () => {
  const f = await fixture(), api = f.service.forWorkspace(f.workspaceId);
  const { tools, toolsets } = await api.modules.tools();
  // Chrona's own tools open to the user (v2-13) come first.
  expect(tools.map(tool => tool.name)).toEqual(["m_modules_diagnostics", "m_modules_health", "m_modules_system", "m_modules_overview", "m_modules_settings_set", "m_modules_permissions", "m_modules_check", "m_modules_rollback", "m_modules_disable", "m_modules_enable", "m_modules_remove", "m_modules_build_owner", "m_modules_stop_build", "m_modules_revise_build", "m_activity_list", "m_content_read", "m_memory_recall", "m_memory_retain", "m_memory_forget", "m_memory_status", "m_mail_sort_find_mail"]);
  expect(toolsets).toEqual([{ name: "module_mail_sort", description: "Find matching mail", tools: ["m_mail_sort_find_mail"] }]);
  expect(await api.modules.callTool("m_mail_sort_find_mail", { query: "hi" })).toMatchObject({ result: { found: 3 } });
  expect(await f.db.audit.findFirstOrThrow({ where: { kind: "module_tool_call" } })).toMatchObject({ actorKey: "user", details: { callerRunId: null, callerSessionId: null } });
  await expect(api.modules.callTool("m_mail_sort_find_mail", {})).rejects.toMatchObject({ code: "invalid" });
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
  await f.db.moduleVersion.updateMany({ data: { manifest: { ...f.manifest, tools: [tool] } } });
  const schema = (await f.service.tools.catalog(f.run.token)).at(-1)?.inputSchema;
  expect(schema).toMatchObject({ properties: { filters: { type: "array", items: { type: "object", additionalProperties: false, required: ["query"] } } } });
  const args = { filters: [{ query: "open", tags: ["priority", "today"], count: 2 }, { query: "closed" }], empty: {} };
  expect(await f.call(args)).toMatchObject({ result: { found: 3 } });
  expect(f.calls[0]).toMatchObject({ input: { trigger: { args } } });
  expect(await f.service.forWorkspace(f.workspaceId).modules.callTool("m_mail_sort_find_mail", args)).toMatchObject({ result: { found: 3 } });
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
  expect((await f.db.moduleCall.findMany()).map(call => call.status)).toEqual(["executed", "executed", "duplicate", "duplicate"]);
  expect(f.calls[0]).toEqual({ codeDir: join(f.ports.dataDir, "platform/store/hash"), dataDir: join(f.ports.dataDir, "platform/data", f.module.id), entry: "index.ts", network: true, timeoutMs: RUN_LIMITS.jobTimeoutMs, maxOutputBytes: RUN_LIMITS.jobOutputBytes,
    input: { trigger: { id: "find-mail", kind: "tool", firedAt: f.ports.now().toISOString(), args, caller: { kind: "provider", runId: expect.any(String) }, call: { id: expect.any(String), key: null, attempt: 1, chain: [] } }, now: f.ports.now().toISOString(), params: { limit: 3 } } });
  expect((await notices(f.db)).length).toBe(1);
  expect(await f.db.run.count({ where: { lane: "background" } })).toBe(1);
  expect(await f.db.run.findFirstOrThrow({ where: { lane: "background" } })).toMatchObject({ prompt: expect.stringContaining("(untrusted data)") });
  expect(await f.db.moduleRun.findFirstOrThrow()).toMatchObject({ triggerId: "tool:find-mail", firedAt: f.ports.now(), exitCode: 0, error: null });
  expect((await f.db.run.findUniqueOrThrow({ where: { id: f.run.id } })).toolCalls).toMatchObject([{ tool: "m_mail_sort_find_mail", ok: true }, { tool: "m_mail_sort_find_mail", ok: true }]);
  expect(await f.db.audit.count({ where: { kind: "tool_finished", subjectId: f.run.id } })).toBe(2);
});
test("module failure returns truncated public stderr and shares the consecutive failure pause", async () => {
  const f = await fixture();
  f.fail("x".repeat(3000));
  const now = f.ports.now().toISOString();
  await expect(moduleSupervisor(f.ports).deliver(f.module.id, "hash", { trigger: { kind: "schedule", id: "daily", firedAt: now }, now, params: {} })).rejects.toThrow();
  for (let i = 0; i < 2; i++) await expect(f.call()).rejects.toMatchObject({ code: "failed", message: expect.stringContaining("x".repeat(1900)) });
  expect((await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).status).toBe("paused");
  expect(await f.db.moduleRun.count()).toBe(3);
  expect((await notices(f.db, { title: "模块连续失败，已暂停" })).length).toBe(1);
  await expect(f.call()).rejects.toMatchObject({ code: "not_found" });
  expect((await f.service.tools.catalog(f.run.token)).some(tool => tool.name.startsWith("m_mail_sort_"))).toBe(false);
  expect((await f.db.run.findUniqueOrThrow({ where: { id: f.run.id } })).toolCalls).toMatchObject([{ ok: false }, { ok: false }, { ok: false }]);
  expect(await f.db.audit.count({ where: { kind: "tool_finished", subjectId: f.run.id } })).toBe(3);
});
test.each(["paused", "migrating", "no-hash"])("catalog and call re-resolve module state: %s", async status => {
  const f = await fixture(); await f.service.tools.catalog(f.run.token);
  await f.db.module.update({ where: { id: f.module.id }, data: status === "no-hash" ? { activeHash: null } : { status } });
  await expect(f.call()).rejects.toMatchObject({ code: "not_found" });
  expect((await f.service.tools.catalog(f.run.token)).length).toBe(CHRONA_TOOLS.length + MODULES_TOOLS);
});
test("ambiguous concatenated names expose and call only the first tool; overlong names are hidden", async () => {
  const f = await fixture();
  const module = await f.db.module.create({ data: { workspaceId: f.workspaceId, name: "mail-sort-find", activeHash: "later" } });
  await f.db.moduleVersion.create({ data: { moduleId: module.id, hash: "later", manifest: { ...f.manifest, name: module.name, tools: [{ ...f.tool, name: "mail", description: "Hidden collision" }] }, intent: {}, source: "user", report: {}, status: "approved" } });
  const catalog = await f.service.tools.catalog(f.run.token);
  expect(catalog.filter(tool => tool.name === "m_mail_sort_find_mail")).toHaveLength(1);
  expect(catalog.at(-1)?.inputSchema.description).toBe("[module mail-sort] Find matching mail");
  await f.call(); expect(await f.db.moduleRun.findFirstOrThrow()).toMatchObject({ moduleId: f.module.id });
  await f.db.module.update({ where: { id: module.id }, data: { name: "a".repeat(64) } });
  expect((await f.service.tools.catalog(f.run.token)).length).toBe(CHRONA_TOOLS.length + MODULES_TOOLS + 1);
});
test("call uses the current version rather than a previously catalogued schema", async () => {
  const f = await fixture(); await f.service.tools.catalog(f.run.token);
  await f.db.moduleVersion.updateMany({ data: { manifest: { ...f.manifest, tools: [{ ...f.tool, parameters: { type: "object", properties: { changed: { type: "boolean" } }, required: ["changed"] } }] } } });
  await expect(f.call()).rejects.toMatchObject({ code: "invalid", message: expect.stringContaining("changed") });
});
