import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { handleModuleCall, type CallScope } from "./module-effects";
import { createSettings } from "./settings";
import { buildPending } from "./module-build";
import { moduleContext } from "./module-context";
import { createModuleSupervisor } from "./module-supervisor";
import { createScriptSandbox } from "../../../../integrations/src/steward/script-sandbox";
import { testDb } from "./test-db";
import type { StewardPorts } from "./ports";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const limits = { model: "fake/exact", maxCallsPerEvent: 2, maxOutputTokens: 20, dailyCalls: 10, timeoutMs: 5000 };
const prompt = "PRIVATE_PROMPT", text = "PRIVATE_COMPLETION";
async function fixture() {
  const db = testDb(), dataDir = await mkdtemp("/tmp/chrona-model-engine-");
  cleanups.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const workspace = await db.workspace.create({ data: { name: "model", settings: { moduleModel: limits } } });
  const module = await db.module.create({ data: { workspaceId: workspace.id, name: "model-test", activeHash: "v1" } });
  const manifest = moduleManifestSchema.parse({ name: "model-test", entry: "index.ts", tests: ["test.ts"], effects: ["model", "notify_user"], model: { maxCalls: 2, maxOutputTokens: 20 }, triggers: [{ id: "daily", schedule: { kind: "daily", time: "09:00" } }] });
  const now = new Date("2026-10-21T04:00:00Z");
  const run = await db.moduleRun.create({ data: { moduleId: module.id, hash: "v1", triggerId: "daily", firedAt: now, createdAt: now, exitCode: 0 } });
  let calls = 0;
  const ports: StewardPorts = { db, dataDir, now: () => now, publicUrl: null, deliveries: [], chat: null, modelGateway: { async complete() { calls++; return { text, inputTokens: 3, outputTokens: 4 }; } } };
  const scope: CallScope = { workspaceId: workspace.id, moduleId: module.id, hash: "v1", manifest, moduleRunId: run.id, eventKey: "event" };
  const call = (maxOutputTokens = 20) => handleModuleCall(ports, scope, { id: "model-call", method: "model", params: { prompt, maxOutputTokens } });
  return { db, dataDir, workspace, module, manifest, ports, scope, call, calls: () => calls };
}

test("settings moduleModel defaults null, persists owner updates and disabling", async () => {
  const f = await fixture();
  const settings = createSettings({ ...f.ports, workspaceId: f.workspace.id }, null);
  expect((await settings.get()).moduleModel).toEqual(limits);
  expect((await settings.update({ moduleModel: null })).moduleModel).toBeNull();
  expect((await settings.update({ moduleModel: limits })).moduleModel).toEqual(limits);
  await f.db.workspace.update({ where: { id: f.workspace.id }, data: { settings: {} } });
  expect((await settings.get()).moduleModel).toBeNull();
});
for (const kind of ["undeclared", "unconfigured", "event", "daily", "tokens", "setting-tokens", "setting-calls", "no-event"] as const) test(`handler enforces ${kind}`, async () => {
  const f = await fixture();
  let cap = 20;
  if (kind === "undeclared") f.scope.manifest = moduleManifestSchema.parse({ ...f.manifest, effects: ["notify_user"], model: undefined });
  if (kind === "unconfigured") await f.db.workspace.update({ where: { id: f.workspace.id }, data: { settings: {} } });
  if (kind === "event") { await f.call(); await f.call(); }
  if (kind === "daily") { await f.db.workspace.update({ where: { id: f.workspace.id }, data: { settings: { moduleModel: { ...limits, dailyCalls: 1 } } } }); await f.call(); }
  if (kind === "tokens") cap = 21;
  if (kind === "setting-tokens") await f.db.workspace.update({ where: { id: f.workspace.id }, data: { settings: { moduleModel: { ...limits, maxOutputTokens: 10 } } } });
  if (kind === "setting-calls") { await f.db.workspace.update({ where: { id: f.workspace.id }, data: { settings: { moduleModel: { ...limits, maxCallsPerEvent: 1 } } } }); await f.call(); }
  if (kind === "no-event") delete f.scope.moduleRunId;
  const before = f.calls();
  expect(await f.call(cap)).toMatchObject({ error: { code: ["undeclared", "unconfigured"].includes(kind) ? kind : "budget_exceeded" } });
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
  f.ports.modelGateway = { async complete() { throw Object.assign(new Error(prompt + text), { code }); } };
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
  expect(audits[0]?.details).toMatchObject({ model: limits.model, inputTokens: 3, outputTokens: 4, error: null });
  expect(JSON.stringify(audits)).not.toContain(prompt); expect(JSON.stringify(audits)).not.toContain(text);
});
for (const setting of [null, { ...limits, maxCallsPerEvent: 1 }, { ...limits, maxOutputTokens: 10 }]) test(`build rejects unavailable or excessive model limits ${JSON.stringify(setting)}`, async () => {
  const f = await fixture();
  await f.db.workspace.update({ where: { id: f.workspace.id }, data: { settings: { moduleModel: setting } } });
  const version = await f.db.moduleVersion.create({ data: { moduleId: f.module.id, hash: "build", manifest: f.manifest, intent: { changes: ["model"] }, source: "user", report: {}, status: "building" } });
  const staging = join(f.dataDir, "platform/staging", version.id); await mkdir(staging, { recursive: true }); await writeFile(join(staging, "index.ts"), "");
  await buildPending(moduleContext(f.ports, f.workspace.id));
  const row = await f.db.moduleVersion.findUniqueOrThrow({ where: { id: version.id } });
  expect(row.status).toBe("rejected"); expect(JSON.stringify(row.report)).toContain(setting ? "limits exceed" : "configure moduleModel"); expect(f.calls()).toBe(0);
});
const sandbox = createScriptSandbox({ bwrapPath: Bun.which("bwrap") ?? undefined });
(sandbox.health.available ? test : test.skip)("sandbox schedule calls SDK model then notify; model audit excludes content", async () => {
  const f = await fixture(), code = join(f.dataDir, "platform/store/v1");
  await mkdir(code, { recursive: true });
  await writeFile(join(code, "index.ts"), `import { on, chrona } from 'chrona'; on('schedule', async ev => { const reply = await chrona.model({ prompt: '${prompt}', maxOutputTokens: 20 }); await chrona.notify({ key: ev.firedAt, level: 'now', title: 'Summary', body: reply.text }); });`);
  await f.db.moduleVersion.create({ data: { moduleId: f.module.id, hash: "v1", manifest: f.manifest, intent: {}, source: "user", report: {}, status: "approved" } });
  f.ports.sandbox = { available: true, isolated: true, startModule: sandbox.startModule };
  const supervisor = createModuleSupervisor(f.ports); cleanups.push(() => supervisor.stop());
  await supervisor.deliver(f.module.id, "v1", { trigger: { kind: "schedule", id: "daily", firedAt: f.ports.now().toISOString() }, now: f.ports.now().toISOString(), params: {} });
  expect(await f.db.notification.findFirst()).toMatchObject({ body: text });
  const calls = await f.db.moduleCall.findMany({ orderBy: { createdAt: "asc" } });
  expect(calls).toHaveLength(2);
  expect(calls).toEqual(expect.arrayContaining([
    expect.objectContaining({ moduleId: f.module.id, hash: "v1", method: "model", status: "executed", error: null }),
    expect.objectContaining({ moduleId: f.module.id, hash: "v1", method: "notify", status: "executed" }),
  ]));
  expect(calls.every(call => call.moduleRunId && call.eventKey)).toBe(true);
  expect(f.calls()).toBe(1);
  expect(await f.db.run.count()).toBe(0);
  const audits = await f.db.audit.findMany();
  expect(audits.find(audit => audit.kind === "module_model_call")?.details).toMatchObject({ callId: calls.find(call => call.method === "model")!.id, model: limits.model, inputTokens: 3, outputTokens: 4, error: null });
  const logs = JSON.stringify(audits);
  expect(logs).not.toContain(prompt); expect(logs).not.toContain(text);
});
