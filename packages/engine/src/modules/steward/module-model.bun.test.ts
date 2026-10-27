import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { type CallScope } from "./module-effects";
import { completeForModule } from "./module-model";
import { createSettings } from "./settings";
import { buildPending } from "./module-build";
import { moduleContext } from "./module-context";
import { createModuleSupervisor } from "./module-supervisor";
import { createScriptSandbox } from "../../../../integrations/src/steward/script-sandbox";
import { testDb } from "./test-db";
import type { ProviderAdapter } from "@chrona/contracts/steward";

const fakeProvider: ProviderAdapter = { name: "fake", async health() { return { available: true, sandboxed: true, error: null }; }, start() { throw new Error("No runs in model tests"); } };
import type { StewardPorts } from "./ports";
import { notices } from "./test-notices";
import { registerSystemModules } from "./system-modules";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const limits = { models: { fast: "fake/fast", strong: "fake/exact" }, maxCallsPerEvent: 2, maxOutputTokens: 20, dailyCalls: 10, timeoutMs: 5000 };
const prompt = "PRIVATE_PROMPT", text = "PRIVATE_COMPLETION";
async function fixture() {
  const db = testDb(), dataDir = await mkdtemp("/tmp/chrona-model-engine-");
  cleanups.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const workspace = await db.workspace.create({ data: { name: "model", settings: { moduleModel: limits } } });
  const module = await db.module.create({ data: { workspaceId: workspace.id, name: "model-test", activeHash: "v1" } });
  const manifest = moduleManifestSchema.parse({ name: "model-test", entry: "index.ts", tests: ["test.ts"], effects: ["model", "notify_user"], model: { tier: "strong", maxCalls: 2, maxOutputTokens: 20 }, triggers: [{ id: "daily", schedule: { kind: "daily", time: "09:00" } }] });
  const now = new Date("2026-10-21T04:00:00Z");
  const run = await db.moduleRun.create({ data: { moduleId: module.id, hash: "v1", triggerId: "daily", firedAt: now, createdAt: now, exitCode: 0 } });
  let calls = 0;
  const ports: StewardPorts = { db, dataDir, now: () => now, publicUrl: null, provider: { ...fakeProvider, async complete() { calls++; return { text, inputTokens: 3, outputTokens: 4 }; } } };
  const scope: CallScope = { workspaceId: workspace.id, moduleId: module.id, hash: "v1", manifest, moduleRunId: run.id, eventKey: "event" };
  // What provider.complete runs for the calling module; a refusal's message starts with its reason.
  const call = async (maxOutputTokens = 20) => {
    try { return { result: await completeForModule(ports, scope, { prompt, maxOutputTokens }) }; }
    catch (error) { return { error: { code: /^(\w+):/.exec((error as Error).message)?.[1] } }; }
  };
  return { db, dataDir, workspace, module, manifest, ports, scope, call, calls: () => calls };
}

test("settings moduleModel defaults null, persists owner updates and disabling", async () => {
  const f = await fixture();
  const settings = createSettings({ ...f.ports, workspaceId: f.workspace.id }, { status: async () => null, forward: async () => null });
  expect((await settings.get()).moduleModel).toEqual(limits);
  expect((await settings.update({ moduleModel: null })).moduleModel).toBeNull();
  expect((await settings.update({ moduleModel: limits })).moduleModel).toEqual(limits);
  await f.db.workspace.update({ where: { id: f.workspace.id }, data: { settings: {} } });
  expect((await settings.get()).moduleModel).toBeNull();
});
for (const kind of ["undeclared", "unconfigured", "tier", "event", "daily", "tokens", "setting-tokens", "setting-calls", "no-event"] as const) test(`handler enforces ${kind}`, async () => {
  const f = await fixture();
  let cap = 20;
  if (kind === "undeclared") f.scope.manifest = moduleManifestSchema.parse({ ...f.manifest, effects: ["notify_user"], model: undefined });
  if (kind === "unconfigured") await f.db.workspace.update({ where: { id: f.workspace.id }, data: { settings: {} } });
  if (kind === "tier") await f.db.workspace.update({ where: { id: f.workspace.id }, data: { settings: { moduleModel: { ...limits, models: { fast: "fake/fast" } } } } });
  if (kind === "event") { await f.call(); await f.call(); }
  if (kind === "daily") { await f.db.workspace.update({ where: { id: f.workspace.id }, data: { settings: { moduleModel: { ...limits, dailyCalls: 1 } } } }); await f.call(); }
  if (kind === "tokens") cap = 21;
  if (kind === "setting-tokens") await f.db.workspace.update({ where: { id: f.workspace.id }, data: { settings: { moduleModel: { ...limits, maxOutputTokens: 10 } } } });
  if (kind === "setting-calls") { await f.db.workspace.update({ where: { id: f.workspace.id }, data: { settings: { moduleModel: { ...limits, maxCallsPerEvent: 1 } } } }); await f.call(); }
  if (kind === "no-event") delete f.scope.moduleRunId;
  const before = f.calls();
  expect(await f.call(cap)).toMatchObject({ error: { code: kind === "tier" ? "unconfigured" : ["undeclared", "unconfigured"].includes(kind) ? kind : "budget_exceeded" } });
  expect(f.calls()).toBe(before);
  expect(await f.db.moduleCall.count({ where: { status: "rejected", method: "model" } })).toBe(1);
});
test("daily budget uses workspace timezone midnight and includes failed calls", async () => {
  const f = await fixture();
  await f.db.workspace.update({ where: { id: f.workspace.id }, data: { settings: { notifications: { dailyCap: 5, quietHours: null, timezone: "Asia/Shanghai", digestAt: "09:00" }, moduleModel: { ...limits, dailyCalls: 1 } } } });
  await f.db.moduleCall.create({ data: { moduleId: f.module.id, hash: "v1", method: "model", key: "yesterday", status: "failed", error: "provider_error", createdAt: new Date("2026-10-20T15:59:59Z") } });
  expect(await f.call()).toHaveProperty("result");
  expect(await f.call()).toMatchObject({ error: { code: "budget_exceeded" } });
});
for (const code of ["timeout", "provider_error"]) test(`records ${code} without prompt or completion`, async () => {
  const f = await fixture();
  f.ports.provider = { ...fakeProvider, async complete() { throw Object.assign(new Error(prompt + text), { code }); } };
  expect(await f.call()).toMatchObject({ error: { code } });
  expect(await f.db.moduleCall.findFirst()).toMatchObject({ method: "model", status: "failed", error: code });
  const logs = JSON.stringify(await f.db.audit.findMany());
  expect(logs).not.toContain(prompt); expect(logs).not.toContain(text);
  expect(logs).toContain("module_model_call");
});
test("success caps output and audits only model and token counts", async () => {
  const f = await fixture();
  expect(await f.call(1)).toMatchObject({ result: { text: text.slice(0, 4), inputTokens: 3, outputTokens: 4 } });
  const audits = await f.db.audit.findMany();
  expect(audits[0]?.details).toMatchObject({ model: limits.models.strong, inputTokens: 3, outputTokens: 4, error: null });
  expect(JSON.stringify(audits)).not.toContain(prompt); expect(JSON.stringify(audits)).not.toContain(text);
});
for (const setting of [null, { ...limits, models: { fast: "fake/fast" } }, { ...limits, maxCallsPerEvent: 1 }, { ...limits, maxOutputTokens: 10 }]) test(`build rejects unavailable or excessive model limits ${JSON.stringify(setting)}`, async () => {
  const f = await fixture();
  await f.db.workspace.update({ where: { id: f.workspace.id }, data: { settings: { moduleModel: setting } } });
  const version = await f.db.moduleVersion.create({ data: { moduleId: f.module.id, hash: "build", manifest: f.manifest, intent: { changes: ["model"] }, source: "user", report: {}, status: "building" } });
  const staging = join(f.dataDir, "platform/staging", version.id); await mkdir(staging, { recursive: true }); await writeFile(join(staging, "index.ts"), "");
  await buildPending(moduleContext(f.ports, f.workspace.id));
  const row = await f.db.moduleVersion.findUniqueOrThrow({ where: { id: version.id } });
  expect(row.status).toBe("rejected"); expect(JSON.stringify(row.report)).toContain(!setting ? "configure moduleModel" : "strong" in setting.models ? "limits exceed" : 'tier \\"strong\\" is not configured'); expect(f.calls()).toBe(0);
});
test("build refuses listen outside entry modules: apps offer tools, the web module shows them (v2-8)", async () => {
  const f = await fixture();
  for (const [hash, extra] of [["page", {}], ["entry", { uses: ["chat.send"] }]] as const) {
    const manifest = moduleManifestSchema.parse({ name: "model-test", entry: "index.ts", tests: ["test.ts"], triggers: [], keepAlive: true, effects: [], listen: "/api/page", ...extra });
    const version = await f.db.moduleVersion.create({ data: { moduleId: f.module.id, hash, manifest, intent: { changes: ["page"] }, source: "user", report: {}, status: "building" } });
    const staging = join(f.dataDir, "platform/staging", version.id); await mkdir(staging, { recursive: true }); await writeFile(join(staging, "index.ts"), "");
    await buildPending(moduleContext(f.ports, f.workspace.id));
    const report = JSON.stringify((await f.db.moduleVersion.findUniqueOrThrow({ where: { id: version.id } })).report);
    expect(report.includes("listen is only for entry modules")).toBe(hash === "page");
  }
});
const sandbox = createScriptSandbox({ bwrapPath: Bun.which("bwrap") ?? undefined });
(sandbox.health.available ? test : test.skip)("sandbox schedule calls SDK model then notify; model audit excludes content", async () => {
  registerSystemModules();
  const f = await fixture(), code = join(f.dataDir, "platform/store/v1");
  await mkdir(code, { recursive: true });
  await writeFile(join(code, "index.ts"), `import { on, chrona } from 'chrona'; on('schedule', async ev => { const reply = await chrona.model({ prompt: '${prompt}', maxOutputTokens: 20 }); await chrona.notify({ key: ev.firedAt, level: 'now', title: 'Summary', body: reply.text }); });`);
  await f.db.moduleVersion.create({ data: { moduleId: f.module.id, hash: "v1", manifest: f.manifest, intent: {}, source: "user", report: {}, status: "approved" } });
  const runtime = createScriptSandbox({ bwrapPath: Bun.which("bwrap") ?? undefined, dataDir: f.dataDir });
  f.ports.sandbox = { ...runtime.health, startModule: runtime.startModule };
  const supervisor = createModuleSupervisor(f.ports); cleanups.push(() => supervisor.stop());
  await supervisor.deliver(f.module.id, "v1", { trigger: { kind: "schedule", id: "daily", firedAt: f.ports.now().toISOString() }, now: f.ports.now().toISOString(), params: {} });
  expect((await notices(f.db))[0]).toMatchObject({ body: text });
  const calls = await f.db.moduleCall.findMany({ orderBy: { createdAt: "asc" } });
  // The completion record (budgets) plus the two routed calls the SDK made: provider.complete and notify.send.
  expect(calls).toHaveLength(3);
  expect(calls).toEqual(expect.arrayContaining([
    expect.objectContaining({ moduleId: f.module.id, hash: "v1", method: "model", status: "executed", error: null }),
    expect.objectContaining({ moduleId: f.module.id, hash: "v1", method: "call", status: "executed" }),
  ]));
  expect((await f.db.moduleInvocation.findMany()).map(row => `${row.target}.${row.tool}`).sort()).toEqual(["notify.send", "provider.complete"]);
  // provider.complete is unrecorded: neither the prompt nor the completion is stored with the call.
  const invocations = JSON.stringify(await f.db.moduleInvocation.findMany({ where: { target: "ai" } }));
  expect(invocations).not.toContain(prompt); expect(invocations).not.toContain(text);
  expect(calls.every(call => call.moduleRunId && call.eventKey)).toBe(true);
  expect(f.calls()).toBe(1);
  expect(await f.db.run.count()).toBe(0);
  const audits = await f.db.audit.findMany();
  expect(audits.find(audit => audit.kind === "module_model_call")?.details).toMatchObject({ callId: calls.find(call => call.method === "model")!.id, model: limits.models.strong, inputTokens: 3, outputTokens: 4, error: null });
  const logs = JSON.stringify(audits);
  expect(logs).not.toContain(prompt); expect(logs).not.toContain(text);
});

test("v2-17: a tier names a model and thinking level; a module's own daily cap stops only it; usage is per module", async () => {
  const f = await fixture();
  const seen: unknown[] = [];
  f.ports.provider = { ...fakeProvider, async complete(input) { seen.push({ model: input.model, thinking: input.thinking }); return { text, inputTokens: 3, outputTokens: 4 }; } };
  const settings = createSettings({ ...f.ports, workspaceId: f.workspace.id }, { status: async () => null, forward: async () => null });
  await settings.update({ moduleModel: { ...limits, models: { strong: { model: "fake/exact", thinking: "max" }, fast: "fake/fast:low" }, moduleDailyCalls: { "model-test": 1 } } });
  expect((await f.call()).result).toMatchObject({ text });
  expect(seen).toEqual([{ model: "fake/exact", thinking: "max" }]);
  // Same event allows two calls, but the module's own cap is one a day.
  expect((await f.call()).error).toEqual({ code: "budget_exceeded" });
  expect((await settings.get()).modelUsage).toEqual([{ module: "model-test", calls: 1, inputTokens: 3, outputTokens: 4 }]);
  // Pi's model:level shorthand from before v2-17 is split: Pi reports the bare model id.
  f.scope.manifest = moduleManifestSchema.parse({ ...f.manifest, model: { tier: "fast", maxCalls: 2, maxOutputTokens: 20 } });
  await settings.update({ moduleModel: { ...limits, models: { fast: "fake/fast:low" } } });
  f.scope.moduleRunId = (await f.db.moduleRun.create({ data: { moduleId: f.module.id, hash: "v1", triggerId: "daily", firedAt: f.ports.now(), createdAt: f.ports.now(), exitCode: 0 } })).id;
  expect((await f.call()).result).toMatchObject({ text });
  expect(seen.at(-1)).toEqual({ model: "fake/fast", thinking: "low" });
});
