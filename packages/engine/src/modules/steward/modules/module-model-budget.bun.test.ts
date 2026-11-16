import { afterEach, expect, test } from "bun:test";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import type { StewardPorts } from "../ports";
import type { CallScope } from "./module-supervisor";
import { finishCompletion, reserveCompletion } from "./module-model-budget";
import { createSettings, modelUsage } from "../settings";
import { testDb } from "../test-db";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const limits = { maxCallsPerEvent: 2, maxOutputTokens: 20, dailyCalls: 10, eventTimeoutMs: 5000 };
const params = { prompt: "PRIVATE_PROMPT", maxOutputTokens: 20 };
async function fixture(overrides = {}) {
  const db = testDb({ injectedAgent: false });
  cleanups.push(() => db.$disconnect());
  const now = new Date("2026-10-21T00:00:00Z");
  const workspace = await db.workspace.create({ data: { name: "budget", settings: { timezone: "UTC", moduleModel: { ...limits, ...overrides } } } });
  const module = await db.module.create({ data: { workspaceId: workspace.id, name: "budget-test", activeHash: "v1" } });
  const manifest = moduleManifestSchema.parse({ name: module.name, entry: "index.ts", tests: ["test.ts"], keepAlive: true, effects: [], uses: ["agent.run"], model: { tier: "arbitrary-tier", maxCalls: 2, maxOutputTokens: 20 } });
  const run = await db.moduleRun.create({ data: { moduleId: module.id, hash: "v1", triggerId: "tool", firedAt: now, createdAt: now, exitCode: 0 } });
  const scope: CallScope = { workspaceId: workspace.id, moduleId: module.id, hash: "v1", manifest, moduleRunId: run.id, eventKey: "event" };
  const ports: StewardPorts = { db, dataDir: "/unused", now: () => now, publicUrl: null };
  const reserve = (maxOutputTokens = 20) => reserveCompletion(ports, scope, { ...params, maxOutputTokens }, now);
  const seed = (status: string, createdAt = now, method = "model") => db.moduleCall.create({ data: { moduleId: module.id, hash: "v1", moduleRunId: run.id, method, key: crypto.randomUUID(), status, createdAt } });
  return { db, now, workspace, module, manifest, run, scope, ports, reserve, seed };
}

test("reservation exposes only declared tier and minimum kernel/manifest limits without a provider", async () => {
  const f = await fixture({ maxCallsPerEvent: 1, maxOutputTokens: 10 });
  expect(await f.reserve(10)).toEqual({ id: expect.any(String), declaredTier: "arbitrary-tier", effectiveHardLimits: { maxCallsPerEvent: 1, maxOutputTokens: 10, eventTimeoutMs: 5000 }, error: null });
  expect((await f.reserve(10)).error).toBe("budget_exceeded");
  expect(JSON.stringify(await f.db.audit.findMany())).not.toContain(params.prompt);
});

for (const reason of ["undeclared", "unconfigured", "no-event", "manifest-tokens", "kernel-tokens"] as const) test(`reservation rejects ${reason}`, async () => {
  const f = await fixture(reason === "kernel-tokens" ? { maxOutputTokens: 10 } : {});
  if (reason === "undeclared") delete f.scope.manifest.model;
  if (reason === "unconfigured") await f.db.workspace.update({ where: { id: f.workspace.id }, data: { settings: { moduleModel: null } } });
  if (reason === "no-event") delete f.scope.moduleRunId;
  const reservation = await f.reserve(reason === "manifest-tokens" ? 21 : 20);
  expect(reservation.error).toBe(reason === "undeclared" || reason === "unconfigured" ? reason : "budget_exceeded");
  if (reason === "undeclared") expect(reservation.declaredTier).toBeNull();
  if (["undeclared", "unconfigured"].includes(reason)) expect(reservation.effectiveHardLimits).toBeNull();
  expect(await f.db.moduleCall.findUnique({ where: { id: reservation.id } })).toMatchObject({ status: "rejected" });
});

for (const cap of ["event", "daily"] as const) test(`concurrent reservations atomically enforce ${cap} cap and exclude rejected calls`, async () => {
  const f = await fixture(cap === "daily" ? { dailyCalls: 1 } : { maxCallsPerEvent: 1 });
  await f.seed("rejected");
  const results = await Promise.all(Array.from({ length: 8 }, () => f.reserve()));
  expect(results.filter(row => row.error === null)).toHaveLength(1);
  expect(results.filter(row => row.error === "budget_exceeded")).toHaveLength(7);
  expect(await f.db.moduleCall.count({ where: { status: "pending" } })).toBe(1);
});

for (const status of ["pending", "failed", "executed", "unknown"]) for (const cap of ["event", "daily"] as const) test(`${status} holds ${cap} capacity`, async () => {
  const f = await fixture(cap === "daily" ? { dailyCalls: 1 } : { maxCallsPerEvent: 1 });
  await f.seed(status);
  expect((await f.reserve()).error).toBe("budget_exceeded");
  expect((await modelUsage(f.db, f.workspace.id, (await f.db.workspace.findUniqueOrThrow({ where: { id: f.workspace.id } })).settings, f.ports.now()))).toMatchObject([{ module: f.module.name, calls: 1 }]);
});

test("other methods and other workspace calls do not consume model capacity", async () => {
  const f = await fixture({ dailyCalls: 1 });
  await f.seed("pending", f.now, "tool");
  const workspace = await f.db.workspace.create({ data: { name: "foreign" } });
  const module = await f.db.module.create({ data: { workspaceId: workspace.id, name: "foreign" } });
  await f.db.moduleCall.create({ data: { moduleId: module.id, hash: "v1", method: "model", key: "foreign", status: "unknown", createdAt: f.now } });
  expect((await f.reserve()).error).toBeNull();
});

test("module daily cap stops only that module and permits an explicit zero", async () => {
  const f = await fixture({ moduleDailyCalls: { "budget-test": 1 } });
  expect((await f.reserve()).error).toBeNull();
  expect((await f.reserve()).error).toBe("budget_exceeded");
  const module = await f.db.module.create({ data: { workspaceId: f.workspace.id, name: "other" } });
  const run = await f.db.moduleRun.create({ data: { moduleId: module.id, hash: "v1", triggerId: "tool", firedAt: f.now, exitCode: 0 } });
  const other = { ...f.scope, moduleId: module.id, moduleRunId: run.id, manifest: { ...f.manifest, name: module.name } };
  expect((await reserveCompletion(f.ports, other, params, f.now)).error).toBeNull();
  await createSettings({ ...f.ports, workspaceId: f.workspace.id }).update({ moduleModel: { ...limits, moduleDailyCalls: { other: 0 } } });
  expect((await reserveCompletion(f.ports, other, params, f.now)).error).toBe("budget_exceeded");
});

for (const timezone of ["UTC", "America/Los_Angeles"]) test(`daily boundary uses kernel timezone ${timezone}`, async () => {
  const f = await fixture({ dailyCalls: 1 });
  await f.db.workspace.update({ where: { id: f.workspace.id }, data: { settings: { timezone, notifications: { timezone: "Asia/Shanghai" }, moduleModel: { ...limits, dailyCalls: 1 } } } });
  // One second before UTC midnight belongs to the same Los Angeles day, but yesterday in UTC.
  await f.seed("unknown", new Date("2026-10-20T23:59:59Z"));
  const reservation = await f.reserve();
  expect(reservation.error).toBe(timezone === "UTC" ? null : "budget_exceeded");
});

test("simultaneous settlement emits one audit and cannot overwrite the first outcome", async () => {
  const f = await fixture(), reservation = await f.reserve();
  const owner = { moduleId: f.module.id, hash: "v1" };
  await Promise.all(Array.from({ length: 6 }, () => finishCompletion(f.ports, f.workspace.id, { id: reservation.id, result: { inputTokens: 3, outputTokens: 4 }, error: null, model: "chosen-by-agent" }, owner)));
  await finishCompletion(f.ports, f.workspace.id, { id: reservation.id, error: "provider_error" }, owner);
  expect(await f.db.moduleCall.findUnique({ where: { id: reservation.id } })).toMatchObject({ status: "executed", error: null });
  const audits = await f.db.audit.findMany({ where: { kind: "module_model_call" } });
  expect(audits).toHaveLength(1);
  expect(audits[0]?.details).toEqual({ callId: reservation.id, model: "chosen-by-agent", inputTokens: 3, outputTokens: 4, error: null });
});

for (const status of ["failed", "unknown", "rejected", "executed"]) test(`settlement preserves ${status} without another audit`, async () => {
  const f = await fixture(), row = await f.seed(status);
  await finishCompletion(f.ports, f.workspace.id, { id: row.id, error: null });
  expect((await f.db.moduleCall.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(status);
  expect(await f.db.audit.count()).toBe(0);
});

test("failed settlement records bounded tokens once", async () => {
  const f = await fixture(), row = await f.reserve();
  await finishCompletion(f.ports, f.workspace.id, { id: row.id, error: "timeout" });
  await finishCompletion(f.ports, f.workspace.id, { id: row.id, error: null });
  expect(await f.db.moduleCall.findUnique({ where: { id: row.id } })).toMatchObject({ status: "failed", error: "timeout" });
  expect((await f.db.audit.findFirst())?.details).toEqual({ callId: row.id, inputTokens: null, outputTokens: null, error: "timeout" });
});

test("settlement rejects foreign workspace, wrong owner/hash, missing and non-model ids", async () => {
  const f = await fixture(), row = await f.reserve();
  const foreign = await f.db.workspace.create({ data: { name: "foreign" } });
  await expect(finishCompletion(f.ports, foreign.id, { id: row.id, error: null })).rejects.toMatchObject({ code: "not_found" });
  for (const owner of [{ moduleId: f.module.id, hash: "wrong" }, { moduleId: "wrong", hash: "v1" }]) {
    await expect(finishCompletion(f.ports, f.workspace.id, { id: row.id, error: null }, owner)).rejects.toMatchObject({ code: "not_found" });
  }
  const tool = await f.seed("pending", f.now, "tool");
  for (const id of ["missing", tool.id]) await expect(finishCompletion(f.ports, f.workspace.id, { id, error: null })).rejects.toMatchObject({ code: "not_found" });
  expect((await f.db.moduleCall.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("pending");
  expect(await f.db.audit.count()).toBe(0);
});

test("reservation rejects a module or event from another durable owner", async () => {
  const f = await fixture();
  const foreign = await f.db.workspace.create({ data: { name: "foreign" } });
  await expect(reserveCompletion(f.ports, { ...f.scope, workspaceId: foreign.id }, params, f.now)).rejects.toMatchObject({ code: "not_found" });
  await expect(reserveCompletion(f.ports, { ...f.scope, hash: "wrong" }, params, f.now)).rejects.toMatchObject({ code: "not_found" });
  expect(await f.db.moduleCall.count()).toBe(0);
});

test("unreported usage remains explicit while only first settlement counts", async () => {
  const f = await fixture();
  const reservation = await f.reserve();
  expect(await modelUsage(f.db, f.workspace.id, f.workspace.settings, f.now)).toMatchObject([{ calls: 1, unreportedCalls: 1 }]);
  await finishCompletion(f.ports, f.workspace.id, { id: reservation.id, result: { inputTokens: 0, outputTokens: 0 }, error: null });
  await finishCompletion(f.ports, f.workspace.id, { id: reservation.id, result: { inputTokens: 100, outputTokens: 100 }, error: null });
  expect(await modelUsage(f.db, f.workspace.id, f.workspace.settings, f.now)).toMatchObject([{ calls: 1, inputTokens: 0, outputTokens: 0, unreportedCalls: 0 }]);
});

test("reported token usage survives audit retention", async () => {
  const f = await fixture();
  const reservation = await f.reserve();
  await finishCompletion(f.ports, f.workspace.id, { id: reservation.id, result: { inputTokens: 3, outputTokens: 4 }, error: null });
  await f.db.audit.deleteMany({ where: { workspaceId: f.workspace.id } });
  const workspace = await f.db.workspace.findUniqueOrThrow({ where: { id: f.workspace.id } });
  expect(await modelUsage(f.db, f.workspace.id, workspace.settings, f.ports.now())).toMatchObject([{ moduleId: f.module.id, calls: 1, inputTokens: 3, outputTokens: 4 }]);
});
