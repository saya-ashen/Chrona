import { afterEach, expect, test } from "bun:test";
import "./module-effects";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:net";
import { moduleManifestSchema, RUN_LIMITS, type ModuleEvent } from "@chrona/contracts/steward";
import { PAUSED_MODULE_NAMES } from "./module-availability";
import { createModuleSupervisor } from "./module-supervisor";
import { testModuleProcess } from "./module-test-process";
import { testDb } from "./test-db";
import type { StewardPorts } from "./ports";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const now = new Date("2026-11-08T12:00:00Z"), firedAt = now.toISOString();
const event: ModuleEvent = { trigger: { kind: "tool", id: "go", firedAt, args: {} }, now: firedAt, params: { limit: 999 } };
const modelCaps = { maxCallsPerEvent: 2, maxOutputTokens: 20, dailyCalls: 10, eventTimeoutMs: 5000 };
function clock() {
  let id = 0;
  const tasks = new Map<number, () => void>(), delays: number[] = [];
  const timers = {
    setTimeout: ((fn: () => void, ms: number) => { delays.push(ms); tasks.set(++id, fn); return id; }) as unknown as typeof setTimeout,
    clearTimeout: ((timer: number) => { tasks.delete(timer); }) as unknown as typeof clearTimeout,
  };
  return { timers, delays };
}
async function until(condition: () => Promise<boolean>) {
  for (let i = 0; i < 200; i++) { if (await condition()) return; await Bun.sleep(5); }
  throw new Error("Condition not reached");
}
async function fixture(handler: Parameters<typeof testModuleProcess>[0] = async () => ({})) {
  const db = testDb({ injectedAgent: false }), dataDir = await mkdtemp("/tmp/chrona-supervisor-boundary-");
  const peer = testModuleProcess(handler), fakeClock = clock();
  const ports: StewardPorts = { db, dataDir, now: () => now, publicUrl: null, sandbox: { available: true, isolated: true, startModule: peer.startModule } };
  const supervisor = createModuleSupervisor(ports, { timers: fakeClock.timers });
  cleanups.push(async () => { await supervisor.stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  // Start observation before installing fixtures, without registering built-ins or loading application resources.
  await supervisor.start();
  const workspace = await db.workspace.create({ data: { name: "supervisor boundary", settings: { moduleModel: modelCaps, limit: 888 } } });
  async function app(name = "ordinary", extra: Record<string, unknown> = {}) {
    const hash = `${name}-v1`;
    const manifest = moduleManifestSchema.parse({ name, entry: "index.ts", tests: ["test.ts"], effects: [], tools: [{ name: "go", description: "Go", parameters: { type: "object", properties: {}, required: [] } }], ...extra });
    const row = await db.module.create({ data: { workspaceId: workspace.id, name, activeHash: hash } });
    await db.moduleVersion.create({ data: { moduleId: row.id, hash, manifest, source: "user", status: "approved", intent: {}, report: {} } });
    return { row, hash, manifest, deliver: (input = event, options = {}) => supervisor.deliver(row.id, hash, input, options) };
  }
  return { db, dataDir, workspace, supervisor, peer, app, ...fakeClock };
}

test.each([...PAUSED_MODULE_NAMES])("installed active %s cannot launch through events, HTTP, reconciliation or activation announcements", async name => {
  const seen: ModuleEvent[] = [];
  const f = await fixture(async input => { seen.push(input); return {}; });
  const paused = await f.app(name, { keepAlive: true, activated: true, listen: `/api/${name}` });
  const ordinary = await f.app("ordinary", { keepAlive: true, activated: true, listen: "/api/ordinary" });
  await expect(paused.deliver()).rejects.toMatchObject({ code: "unavailable", reason: "module_paused", stage: "unavailable" });
  expect(await f.supervisor.listener(`/api/${name}`)).toBeNull();
  await f.supervisor.reconcile();
  await until(async () => {
    const record = await readFile(join(f.dataDir, "platform/activated.json"), "utf8").then(JSON.parse).catch(() => ({}));
    return ordinary.row.id in record;
  });
  await f.supervisor.reconcile();
  const server = createServer(client => { client.destroy(); });
  cleanups.push(() => new Promise<void>(resolve => server.close(() => resolve())));
  await new Promise<void>(resolve => server.listen(join(f.peer.processes[0]!.input.httpDir!, "s"), resolve));
  expect(await f.supervisor.listener("/api/ordinary")).toEndWith("/http/s");
  expect(f.peer.processes).toHaveLength(1);
  expect(seen.map(input => input.trigger.kind)).toEqual(["activated"]);
  expect(await f.db.moduleRun.count({ where: { moduleId: paused.row.id } })).toBe(0);
  expect(await f.db.module.findUniqueOrThrow({ where: { id: paused.row.id } })).toMatchObject({ status: "active", activeHash: paused.hash });
  expect(f.supervisor.status(paused.row.id, paused.hash, true)).toEqual({ state: "unavailable", pid: null });
  expect(f.supervisor.status(ordinary.row.id, ordinary.hash, true)).toEqual({ state: "running", pid: 1 });
});

test.each(["health", "calendar", "undeclared-tool", "undeclared-activation", "static-schedule", "foreign-timer"])("rejects %s before execution without a process fault", async kind => {
  const f = await fixture(), app = await f.app();
  let trigger: unknown = { kind, id: kind, firedAt };
  if (kind === "undeclared-tool") trigger = { kind: "tool", id: "absent", firedAt, args: {} };
  if (kind === "undeclared-activation") trigger = { kind: "activated", id: "activated", firedAt };
  if (kind === "static-schedule") trigger = { kind: "schedule", id: "daily", firedAt };
  if (kind === "foreign-timer") {
    const foreign = await f.app("foreign");
    const timer = await f.db.schedule.create({ data: { workspaceId: f.workspace.id, moduleId: foreign.row.id, mode: "module", status: "done", text: "once", rule: {}, payload: {}, lastAt: now, createdBy: "module" } });
    trigger = { kind: "schedule", id: "timer", firedAt, scheduleId: timer.id, payload: {} };
  }
  await expect(app.deliver({ ...event, trigger } as ModuleEvent)).rejects.toMatchObject({ stage: "unavailable" });
  expect(f.peer.processes).toHaveLength(0);
  expect(await f.db.moduleRun.count()).toBe(0);
  expect(await f.db.audit.count()).toBe(0);
  expect(await f.db.module.findUniqueOrThrow({ where: { id: app.row.id } })).toMatchObject({ status: "active" });
});

test("ordinary manual tool delivery, declared activation, owned timers and runtime call results still execute", async () => {
  const seen: ModuleEvent[] = [];
  const f = await fixture(async input => { seen.push(input); return { result: input.trigger.kind }; });
  const app = await f.app("ordinary", { activated: true });
  const timer = await f.db.schedule.create({ data: { workspaceId: f.workspace.id, moduleId: app.row.id, mode: "module", status: "done", text: "once", rule: {}, payload: { value: 1 }, lastAt: now, createdBy: "module" } });
  const inputs: ModuleEvent[] = [event,
    { ...event, trigger: { kind: "activated", id: "activated", firedAt } },
    { ...event, trigger: { kind: "schedule", id: "timer", firedAt, scheduleId: timer.id, payload: { value: 1 } } },
    { ...event, trigger: { kind: "call_result", id: "call", firedAt, callId: "call-1", target: "other.go", key: "request-1", status: "succeeded", output: {} } },
  ];
  for (const input of inputs) expect(await app.deliver(input)).toMatchObject({ result: { result: input.trigger.kind } });
  expect(seen.map(input => input.trigger)).toEqual(inputs.map(input => input.trigger));
  expect(f.peer.processes).toHaveLength(1);
  expect(await f.db.moduleRun.count({ where: { exitCode: 0 } })).toBe(4);
  expect(f.supervisor.status(app.row.id, app.hash, false)).toEqual({ state: "running", pid: 1 });
  await f.supervisor.stop();
  expect(f.peer.processes[0]!.socket.destroyed).toBe(true);
  expect(f.supervisor.status(app.row.id, app.hash, false)).toEqual({ state: "unobserved", pid: null });
});

for (const model of [false, true]) test(`literal params ignore caller/workspace preferences; timeout caps survive (model=${model})`, async () => {
  const seen: ModuleEvent[] = [];
  const f = await fixture(async input => { seen.push(input); return {}; });
  const app = await f.app("ordinary", { params: { limit: { type: "number", value: 7 }, enabled: { type: "boolean", value: false }, label: { type: "string", value: "literal" } }, ...(model ? { uses: ["agent.complete"], model: { tier: "normal", maxCalls: 2, maxOutputTokens: 20 } } : {}) });
  // Warm the fake process so recorded timers below cover event delivery only.
  await app.deliver();
  const ceiling = model ? modelCaps.eventTimeoutMs : RUN_LIMITS.jobTimeoutMs;
  for (const requested of [undefined, 2500, 100_000]) {
    f.delays.length = 0;
    await app.deliver(event, { timeoutMs: requested });
    expect(f.delays[0]).toBe(Math.min(requested ?? ceiling, ceiling));
    expect(seen.at(-1)!.params).toEqual({ limit: 7, enabled: false, label: "literal" });
  }
  await f.db.workspace.update({ where: { id: f.workspace.id }, data: { settings: { moduleModel: null, limit: 123 } } });
  f.delays.length = 0;
  await app.deliver();
  expect(f.delays[0]).toBe(RUN_LIMITS.jobTimeoutMs);
  expect(seen.at(-1)!.params.limit).toBe(7);
});

test("the supervisor exports process observation without the removed health API", async () => {
  const f = await fixture();
  for (const removed of ["readiness", "reportHealth", "refreshHealth"]) expect(removed in f.supervisor).toBe(false);
});
