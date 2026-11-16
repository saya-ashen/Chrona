import { afterEach, expect, spyOn, test } from "bun:test";
import "./module-effects";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { readModuleFiles } from "./module-preview";
import { moduleManifestSchema, type ModuleEvent } from "@chrona/contracts/steward";
import { createModuleSupervisor, moduleSupervisor } from "./module-supervisor";
import { registerSystemModules } from "../system-modules";
import { callsSettled, callSync, kernelOrigin } from "./module-calls";
import { installNotifyTarget } from "../test-notify-target";
import { testModuleProcess } from "./module-test-process";
import { testDb } from "../test-db";
import type { StewardPorts } from "../ports";
import { notices } from "../test-notices";
import { moduleIncidents } from "./module-diagnostics";
import { moduleContext } from "./module-context";
import { recordModuleActivation, moduleEvolutionOutcomes, updateModuleEvolution } from "./module-evolution";
import { moduleFailurePolicy, recordModuleExecution } from "./module-failure-policy";
import { seedTestModuleRelease } from "./module-release-test-fixture";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const event: ModuleEvent = { trigger: { id: "daily", kind: "tool", args: {}, caller: { kind: "owner", via: null }, firedAt: "2026-10-21T00:00:00Z" }, now: "2026-10-21T00:00:00Z", params: {} };
async function until(condition: () => boolean | Promise<boolean>) { for (let i = 0; i < 200; i++) { if (await condition()) return; await Bun.sleep(5); } throw new Error("Condition not reached"); }
function clock() {
  let time = 0;
  const tasks = new Map<number, { at: number; fn: () => void }>(); let id = 0;
  return { timers: { setTimeout: ((fn: () => void, ms: number) => { tasks.set(++id, { at: time + ms, fn }); return id; }) as unknown as typeof setTimeout, clearTimeout: ((id: number) => { tasks.delete(id); }) as unknown as typeof clearTimeout },
    pending: () => [...tasks.values()].map(task => task.at - time),
    advance(ms: number) { time += ms; for (const [id, task] of [...tasks]) if (task.at <= time) { tasks.delete(id); task.fn(); } } };
}
async function fixture({ shared = false, keepAlive = false, idleMs, listen, uses = ["notify.send", "provider.wake"], handler = async () => ({}) }: { shared?: boolean; keepAlive?: boolean; idleMs?: number; listen?: string; uses?: string[]; handler?: Parameters<typeof testModuleProcess>[0] } = {}) {
  const db = testDb({ injectedAgent: false }), dataDir = await mkdtemp("/tmp/cms-test-");
  const workspace = await db.workspace.create({ data: { name: "supervisor" } });
  const module = await db.module.create({ data: { workspaceId: workspace.id, name: "example", activeHash: "v1" } });
  const manifest = moduleManifestSchema.parse({ name: "example", entry: "index.ts", tests: ["test.ts"], keepAlive, listen, effects: [], uses, tools: [{ name: "daily", description: "Ordinary application operation", visibility: ["owner"], parameters: { type: "object", properties: {} },
      output: {}
}] });
  await db.moduleVersion.create({ data: { moduleId: module.id, hash: "v1", manifest, source: "user", intent: {}, report: {}, status: "approved" } });
  const peer = testModuleProcess(handler), fakeClock = clock();
  let now = 0;
  const ports: StewardPorts = { db, dataDir, now: () => new Date(Date.UTC(2026, 9, 21) + now++), publicUrl: null, sandbox: { available: true, isolated: true, startModule: peer.startModule } };
  const activation = await db.$transaction(tx => recordModuleActivation(moduleContext(ports, workspace.id), tx, { moduleId: module.id, previousHash: null, hash: "v1", generationId: "fixture" }));
  const supervisor = shared ? moduleSupervisor(ports) : createModuleSupervisor(ports, { timers: fakeClock.timers, idleMs });
  let stopErrors: Error[] | undefined;
  cleanups.push(async () => {
    try {
      await callsSettled(ports);
      if (!shared) await moduleSupervisor(ports).stop();
      if (stopErrors) await expect(supervisor.stop()).rejects.toMatchObject({ name: "AggregateError", errors: stopErrors });
      else await supervisor.stop();
    } finally {
      await db.$disconnect();
      await rm(dataDir, { recursive: true, force: true });
    }
  });
  return { db, module, manifest, ports, supervisor, activation, ...peer, ...fakeClock,
    expectStopErrors: (...errors: Error[]) => { stopErrors = errors; }, deliver: () => supervisor.deliver(module.id, "v1", event) };
}
test("supervisor starts keep-alive processes without producing health events", async () => {
  const seen: ModuleEvent[] = [];
  const f = await fixture({ keepAlive: true, handler: async event => { seen.push(event); return {}; } });
  await f.supervisor.reconcile();
  f.advance(120000);
  await f.supervisor.reconcile();
  expect(f.processes).toHaveLength(1);
  expect(seen).toEqual([]);
  for (const retired of ["readiness", "reportHealth", "refreshHealth"]) expect(f.supervisor).not.toHaveProperty(retired);
  expect(await f.db.moduleRun.count()).toBe(0);
  expect((await moduleEvolutionOutcomes(f.db, f.module.workspaceId, f.module.id))[0]).toMatchObject({ status: "awaiting-verification", observedCapabilities: [] });
});

test("one module with unknown stop does not block other keep-alive modules", async () => {
  const f = await fixture({ keepAlive: true });
  const unknown = new Error("synthetic descendant stop unknown");
  f.expectStopErrors(unknown);
  await f.supervisor.start();
  f.processes[0]!.rejectExit(unknown);
  await until(() => f.supervisor.status(f.module.id, "v1", true).state === "unknown");
  const other = await f.db.module.create({ data: { workspaceId: f.module.workspaceId, name: "other", activeHash: "v1" } });
  await f.db.moduleVersion.create({ data: { moduleId: other.id, hash: "v1", manifest: { ...f.manifest, name: "other" },
    source: "user", intent: {}, report: {}, status: "approved" } });
  await expect(f.supervisor.reconcile()).resolves.toBeUndefined();
  expect(f.supervisor.status(f.module.id, "v1", true)).toMatchObject({ state: "unknown" });
  expect(f.supervisor.status(other.id, "v1", true)).toMatchObject({ state: "running" });
});

test.each([false, true])("cold HTTP waits for authenticated readiness (reconciled=%s)", async reconciled => {
  const f = await fixture({ keepAlive: true, listen: "/api/example" });
  if (reconciled) await f.supervisor.reconcile();
  let resolved = false;
  const listener = f.supervisor.listener("/api/example").then(endpoint => { resolved = true; return endpoint; });
  await until(() => f.pending().includes(60_000));
  expect(resolved).toBe(false);
  expect(f.processes).toHaveLength(1);
  f.processes[0]!.httpReady("http://127.0.0.1:43210");
  const endpoint = { endpoint: "http://127.0.0.1:43210", token: f.processes[0]!.input.ipcToken };
  expect(await listener).toEqual(endpoint);
  expect(await f.supervisor.listener("/api/example")).toEqual(endpoint);
  expect(await f.db.moduleRun.count()).toBe(0);
  expect((await moduleEvolutionOutcomes(f.db, f.module.workspaceId, f.module.id))[0]).toMatchObject({ status: "awaiting-verification", observedCapabilities: [] });
});

test.each(["stop", "exit", "timeout", "disable"])("HTTP readiness wait settles safely on %s", async action => {
  const f = await fixture({ keepAlive: true, listen: "/api/example" });
  await f.supervisor.reconcile();
  const listener = f.supervisor.listener("/api/example");
  await until(() => f.pending().includes(60_000));
  if (action === "stop") await f.supervisor.stop();
  if (action === "exit") f.processes[0]!.kill();
  if (action === "timeout") f.advance(60_000);
  if (action === "disable") {
    await f.db.module.update({ where: { id: f.module.id }, data: { status: "disabled" } });
    f.processes[0]!.httpReady("http://127.0.0.1:43210");
  }
  expect(await listener).toBeNull();
});

test("ordinary tool delivery records observed behavior without readiness claims", async () => {
  const seen: ModuleEvent[] = [];
  const f = await fixture({ handler: async event => { seen.push(event); return { result: { applied: true } }; } });
  await f.deliver();
  expect(seen.map(event => event.trigger.kind)).toEqual(["tool"]);
  expect(await f.db.moduleRun.findFirstOrThrow({ where: { moduleId: f.module.id } })).toMatchObject({ triggerId: "tool:daily", exitCode: 0 });
  expect(await moduleIncidents(f.db, f.module.workspaceId, f.module.id)).toEqual([]);
  expect((await moduleEvolutionOutcomes(f.db, f.module.workspaceId, f.module.id))[0]).toMatchObject({ observedCapabilities: ["tool:daily"] });
});

test.each([false, true] as const)("start failure rolls back once before delivery; rollback target failure does not bounce (oldFails=%s)", async oldFails => {
  const db = testDb({ injectedAgent: false }), dataDir = await mkdtemp("/tmp/cms-auto-rollback-");
  const workspace = await db.workspace.create({ data: { name: "auto rollback" } });
  const module = await db.module.create({ data: { workspaceId: workspace.id, name: "example", activeHash: "v2", dataSchema: 1 } });
  const manifest = moduleManifestSchema.parse({ name: "example", entry: "index.ts", keepAlive: true, tests: ["test.ts"], listen: "/api/example", effects: ["network"] });
  for (const hash of ["v1", "v2"]) await db.moduleVersion.create({ data: { moduleId: module.id, hash, manifest, source: "user", status: "approved", intent: { changes: [hash] }, report: { tests: [], continuity: { status: "passed", fromSchema: 1, toSchema: 1, migrated: false } } } });
  const ports: StewardPorts = { db, dataDir, now: () => new Date("2026-10-30T12:00:00Z"), publicUrl: null,
    sandbox: { available: true, isolated: true, startModule: (() => {
      const peer = testModuleProcess(async () => ({}));
      return input => input.codeDir.endsWith("/v2") || oldFails ? (() => { throw new Error("synthetic start failure"); })() : peer.startModule(input);
    })() } };
  const outcome = await db.$transaction(tx => recordModuleActivation(moduleContext(ports, workspace.id), tx, { moduleId: module.id, previousHash: "v1", hash: "v2", generationId: "g-v2" }));
  const supervisor = createModuleSupervisor(ports);
  cleanups.push(async () => { await supervisor.stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  await supervisor.reconcile();
  expect(await db.module.findUniqueOrThrow({ where: { id: module.id } })).toMatchObject({ activeHash: "v1", status: "active" });
  expect((await moduleEvolutionOutcomes(db, workspace.id, module.id)).find(item => item.activationId === outcome.activationId)).toMatchObject({ status: "rolled-back", rollback: { attempted: true, result: "succeeded" } });
  const current = (await moduleEvolutionOutcomes(db, workspace.id, module.id))[0]!;
  expect(current).toMatchObject({ candidateHash: "v1", rollback: oldFails ? { result: "blocked", reason: expect.stringContaining("恢复目标不会自动继续回滚") } : { result: "blocked" } });
  expect(await db.moduleRun.count()).toBe(oldFails ? 2 : 1);
});

test.each(["handler", "lost"] as const)("post-delivery %s failures never trigger automatic code rollback", async stage => {
  const db = testDb({ injectedAgent: false }), dataDir = await mkdtemp("/tmp/cms-post-delivery-");
  const workspace = await db.workspace.create({ data: { name: "post-delivery" } });
  const module = await db.module.create({ data: { workspaceId: workspace.id, name: "example", activeHash: "v2", dataSchema: 1 } });
  const manifest = moduleManifestSchema.parse({ name: "example", entry: "index.ts", keepAlive: true, tests: ["test.ts"], tools: [{ name: "daily", description: "Ordinary application operation", visibility: ["owner"], parameters: { type: "object", properties: {} },
      output: {}
}], effects: [] });
  for (const hash of ["v1", "v2"]) await db.moduleVersion.create({ data: { moduleId: module.id, hash, manifest, source: "user", status: "approved", intent: {}, report: { continuity: { status: "passed", fromSchema: 1, toSchema: 1, migrated: false } } } });
  const ports: StewardPorts = { db, dataDir, now: () => new Date("2026-10-30T12:00:00Z"), publicUrl: null,
    sandbox: { available: true, isolated: true, startModule: (() => {
      const peer = testModuleProcess(async () => {
        if (stage === "handler") throw new Error("handler failed");
        peer.processes[0]!.kill(); return {};
      });
      return peer.startModule;
    })() } };
  const outcome = await db.$transaction(tx => recordModuleActivation(moduleContext(ports, workspace.id), tx, { moduleId: module.id, previousHash: "v1", hash: "v2", generationId: "g-v2" }));
  const supervisor = createModuleSupervisor(ports);
  cleanups.push(async () => { await supervisor.stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  await expect(supervisor.deliver(module.id, "v2", event)).rejects.toMatchObject({ stage });
  expect(await db.module.findUniqueOrThrow({ where: { id: module.id } })).toMatchObject({ activeHash: "v2", status: "active" });
  expect((await moduleEvolutionOutcomes(db, workspace.id, module.id)).find(item => item.activationId === outcome.activationId)).toMatchObject({ status: "failed", rollback: { attempted: false, result: "not-attempted" } });
});

test("failed recovery diagnostics persistence does not convert a successful delivery into transport failure", async () => {
  let finish!: () => void; const gate = new Promise<void>(resolve => { finish = resolve; });
  const f = await fixture({ handler: async () => { await gate; return {}; } });
  const context = moduleContext(f.ports, f.module.workspaceId);
  await f.db.$transaction(tx => recordModuleActivation(context, tx, { moduleId: f.module.id, previousHash: null, hash: "v1", generationId: "audit-failure-test" }));
  const delivery = f.deliver(); await until(() => f.processes.length === 1);
  const rawDb = f.db as unknown as { $transaction: (...args: unknown[]) => unknown };
  const original = rawDb.$transaction;
  rawDb.$transaction = () => Promise.reject(new Error("synthetic diagnostic storage failure"));
  try {
    finish();
    await expect(delivery).resolves.toBeTruthy();
    expect(await f.db.moduleRun.findFirstOrThrow({ where: { moduleId: f.module.id } })).toMatchObject({ exitCode: 0 });
  } finally { rawDb.$transaction = original; }
});

test("a successful stale callback after same-hash reactivation cannot verify the newer epoch", async () => {
  let finish!: () => void; const gate = new Promise<void>(resolve => { finish = resolve; });
  const f = await fixture({ handler: async () => { await gate; return {}; } });
  const context = moduleContext(f.ports, f.module.workspaceId);
  const first = await f.db.$transaction(tx => recordModuleActivation(context, tx, { moduleId: f.module.id, previousHash: null, hash: "v1", generationId: "epoch-1" }));
  await updateModuleEvolution(f.db, { workspaceId: f.module.workspaceId, moduleId: f.module.id, activationId: first.activationId, hash: "v1", status: "failed", now: f.ports.now() });
  const delivery = f.deliver(); await until(() => f.processes.length === 1);
  const second = await f.db.$transaction(tx => recordModuleActivation(context, tx, { moduleId: f.module.id, previousHash: "v1", hash: "v1", generationId: "epoch-2" }));
  finish(); await delivery;
  const outcomes = await moduleEvolutionOutcomes(f.db, f.module.workspaceId, f.module.id);
  expect(outcomes.find(item => item.activationId === first.activationId)).toMatchObject({ status: "failed", observedCapabilities: [] });
  expect(outcomes.find(item => item.activationId === second.activationId)).toMatchObject({ status: "awaiting-verification", observedCapabilities: [] });
});

test("lazy start uses per-instance loopback credentials, idle stop and restart", async () => {
  const f = await fixture();
  await f.supervisor.start(); expect(f.processes).toHaveLength(0);
  await f.deliver(); expect(f.processes).toHaveLength(1);
  const { ipcEndpoint, ipcToken } = f.processes[0]!.input;
  expect(ipcEndpoint).toMatch(/^tcp:\/\/127\.0\.0\.1:\d+$/);
  expect(ipcToken).toMatch(/^[a-f0-9]{64}$/);
  f.advance(600_000);
  await until(() => f.supervisor.status(f.module.id, "v1", false).state === "idle");
  await f.deliver(); expect(f.processes).toHaveLength(2);
});
test("lifecycle barriers drain tools and cannot leave an idle timer closing later work", async () => {
  const gates: (() => void)[] = [], entered: string[] = [];
  const f = await fixture({ idleMs: 1000, handler: async event => {
    entered.push(event.trigger.kind);
    await new Promise<void>(resolve => { gates.push(resolve); }); return {};
  } });
  const version = await f.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: f.module.id, hash: "v1" } } });
  await f.db.moduleVersion.update({ where: { id: version.id }, data: { manifest: { ...f.manifest, activated: true } } });
  const first = f.deliver();
  await until(() => gates.length === 1);
  const lifecycle = f.supervisor.deliver(f.module.id, "v1", {
    ...event, trigger: { kind: "activated", id: "activated", firedAt: event.now },
  });
  gates[0]!(); await first;
  await until(() => gates.length === 2);
  expect(entered).toEqual(["tool", "activated"]);
  f.advance(500);
  gates[1]!(); await lifecycle;
  f.advance(100);
  const third = f.deliver();
  await until(() => gates.length === 3);
  f.advance(1000);
  expect(f.processes[0]!.socket.destroyed).toBe(false);
  gates[2]!(); await third;
  f.advance(1000);
  await until(() => f.processes[0]!.socket.destroyed);
});

test("reconciliation polls every thirty seconds", async () => {
  const f = await fixture();
  let polls = 0;
  const findMany = f.db.module.findMany.bind(f.db.module);
  f.db.module.findMany = ((...args: Parameters<typeof findMany>) => { polls++; return findMany(...args); }) as typeof findMany;
  await f.supervisor.start(); expect(polls).toBe(1);
  f.advance(29_999); expect(polls).toBe(1);
  f.advance(1); await until(() => polls === 2);
});
test("shutdown immediately after spawning settles startup without leaking or restarting", async () => {
  const f = await fixture({ keepAlive: true });
  const sandbox = f.ports.sandbox!, startModule = sandbox.startModule!;
  let stopping: Promise<void> | undefined;
  sandbox.startModule = input => {
    const process = startModule(input);
    queueMicrotask(() => { stopping = f.supervisor.stop(); });
    return process;
  };
  await f.supervisor.start();
  expect(stopping).toBeDefined();
  await stopping;
  expect(f.processes).toHaveLength(1);
  expect(f.processes[0]!.socket.destroyed).toBe(true);
  expect(await f.db.moduleRun.count()).toBeLessThanOrEqual(1);
  expect(await moduleIncidents(f.db, f.module.workspaceId, f.module.id)).toHaveLength(1);
  f.advance(60_000);
  await f.supervisor.reconcile();
  expect(f.processes).toHaveLength(1);
});
test("keepAlive starts at runtime start, restarts with backoff and pauses after three crashes", async () => {
  const f = await fixture({ keepAlive: true });
  await f.supervisor.start(); expect(f.processes).toHaveLength(1);
  for (let i = 0; i < 3; i++) {
    f.processes[i]!.kill();
    await until(async () => await f.db.moduleRun.count() === i + 1);
    // Let cleanup and restart scheduling finish.
    await Bun.sleep(20);
    f.advance(2 ** i * 1000 - 1); await Bun.sleep(10); expect(f.processes).toHaveLength(i + 1);
    f.advance(1);
    if (i < 2) await until(() => f.processes.length === i + 2);
  }
  await until(async () => (await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).status === "paused");
  expect((await notices(f.db, { title: "模块连续失败，已暂停" })).length).toBe(1);
  expect(await moduleIncidents(f.db, f.module.workspaceId, f.module.id)).toMatchObject([{ status: "unresolved", failures: 3, evidence: { phase: "process", exitCode: 1 } }]);
  f.advance(60_000); await Bun.sleep(20); expect(f.processes).toHaveLength(3);
});
test("event errors pause after three failures and retain one ModuleRun per event", async () => {
  const f = await fixture({ handler: async () => { throw new Error("bad event"); } });
  for (let i = 0; i < 3; i++) await expect(f.deliver()).rejects.toThrow("bad event");
  expect(await f.db.moduleRun.count()).toBe(3);
  expect((await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).status).toBe("paused");
});
test("same-hash reactivation starts a fresh failure streak and incident", async () => {
  const f = await fixture({ handler: async () => { throw new Error("bad event"); } });
  await expect(f.deliver()).rejects.toThrow("bad event");
  await expect(f.deliver()).rejects.toThrow("bad event");
  const [old] = await moduleIncidents(f.db, f.module.workspaceId, f.module.id);
  const next = await f.db.$transaction(tx => recordModuleActivation(moduleContext(f.ports, f.module.workspaceId), tx, { moduleId: f.module.id, previousHash: "v1", hash: "v1", generationId: "reactivation" }));
  await expect(f.deliver()).rejects.toThrow("bad event");
  expect(await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).toMatchObject({ status: "active" });
  const incidents = await moduleIncidents(f.db, f.module.workspaceId, f.module.id);
  expect(incidents).toMatchObject([{ activationId: next.activationId, failures: 1, revision: 1 }, { id: old!.id, activationId: f.activation.activationId, failures: 2, revision: old!.revision }]);
  expect(incidents[0]!.id).not.toBe(old!.id);
  expect(await moduleFailurePolicy(f.db, { workspaceId: f.module.workspaceId, moduleId: f.module.id, hash: "v1", activationId: next.activationId })).toMatchObject({ consecutiveFailures: 1, shouldPause: false });
});

test("supervisor restarts retain the activation's real crash streak and pause on the third exit", async () => {
  const f = await fixture({ keepAlive: true });
  let supervisor = f.supervisor;
  for (let i = 0; i < 3; i++) {
    await supervisor.start();
    expect(f.processes).toHaveLength(i + 1);
    f.processes[i]!.kill();
    if (i < 2) {
      await until(() => supervisor.status(f.module.id, "v1", true).state === "backoff");
      await supervisor.stop();
      supervisor = createModuleSupervisor(f.ports, { timers: f.timers });
      const current = supervisor; cleanups.push(() => current.stop());
    } else await until(async () => (await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).status === "paused");
  }
  expect(await f.db.moduleRun.count()).toBe(3);
  expect(await moduleIncidents(f.db, f.module.workspaceId, f.module.id)).toMatchObject([{ failures: 3, activationId: f.activation.activationId, status: "unresolved" }]);
  await supervisor.reconcile();
  expect(f.processes).toHaveLength(3);
});

test.each(["before", "between"] as const)("output mismatches %s execution failures never count toward the pause", async placement => {
  let fails = false;
  const f = await fixture({ handler: async () => { if (fails) throw new Error("bad event"); return { result: "wrong type" }; } });
  const mismatch = () => f.supervisor.deliver(f.module.id, "v1", event, { validateResult: () => "module_output_mismatch" });
  if (placement === "before") { await mismatch(); await mismatch(); }
  fails = true; await expect(f.deliver()).rejects.toThrow("bad event");
  if (placement === "between") { fails = false; await mismatch(); await mismatch(); fails = true; }
  await expect(f.deliver()).rejects.toThrow("bad event");
  expect(await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).toMatchObject({ status: "active" });
  expect(await moduleFailurePolicy(f.db, { workspaceId: f.module.workspaceId, moduleId: f.module.id, hash: "v1", activationId: f.activation.activationId })).toMatchObject({ consecutiveFailures: 2 });
  await expect(f.deliver()).rejects.toThrow("bad event");
  expect(await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).toMatchObject({ status: "paused" });
});

test("one real exit seen by both the socket and process observers counts once", async () => {
  const f = await fixture({ keepAlive: true });
  await f.supervisor.start();
  f.processes[0]!.kill();
  await until(() => f.supervisor.status(f.module.id, "v1", true).state === "backoff");
  await Bun.sleep(60);
  expect(await f.db.moduleRun.count()).toBe(1);
  expect(await f.db.audit.count({ where: { kind: "module_execution_result" } })).toBe(1);
  expect(await moduleIncidents(f.db, f.module.workspaceId, f.module.id)).toMatchObject([{ failures: 1, revision: 1 }]);
  expect(await moduleFailurePolicy(f.db, { workspaceId: f.module.workspaceId, moduleId: f.module.id, hash: "v1", activationId: f.activation.activationId })).toMatchObject({ consecutiveFailures: 1 });
});

test("version switch blocks new events until the old event drains and its process stops", async () => {
  let finish!: () => void, entered = false, settled = false;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const f = await fixture({ handler: async (_event, _call, input) => { if (input.codeDir.endsWith("v1")) { entered = true; await gate; } return { result: input.codeDir }; } });
  // Observe rejection immediately, then assert the outcome after releasing the gate.
  const old = f.deliver().then(reply => { settled = true; return { reply }; }, error => { settled = true; return { error }; });
  try {
    await until(() => entered);
    await f.db.moduleVersion.create({ data: { moduleId: f.module.id, hash: "v2", manifest: f.manifest, source: "user", intent: {}, report: {}, status: "approved" } });
    await f.db.module.update({ where: { id: f.module.id }, data: { activeHash: "v2" } });
    await expect(f.supervisor.deliver(f.module.id, "v2", event)).rejects.toMatchObject({ stage: "unavailable", message: expect.stringContaining("not confirmed descendant stop") });
    expect(settled).toBe(false);
    expect(f.processes).toHaveLength(1);
    expect(f.processes[0]!.socket.destroyed).toBe(false);
  } finally {
    finish();
    expect(await old).toMatchObject({ reply: { result: { result: expect.stringContaining("v1") } } });
  }
  await until(() => f.processes[0]!.socket.destroyed);
  const reply = await f.supervisor.deliver(f.module.id, "v2", event);
  expect(reply).toMatchObject({ result: { result: expect.stringContaining("v2") } });
  expect(f.processes).toHaveLength(2);
  expect(f.processes[1]!.input.dataDir).toBe(f.processes[0]!.input.dataDir);
  await f.supervisor.stop(); expect(f.processes.every(process => process.socket.destroyed)).toBe(true);
});
test.each(["same activation", "new hash", "new activation"])("rejected exit retains ownership and blocks %s without automatic restart", async replacement => {
  const f = await fixture({ keepAlive: true });
  const unknown = new Error("synthetic descendant stop unknown");
  f.expectStopErrors(unknown);
  await f.supervisor.start();
  f.processes[0]!.rejectExit(unknown);
  await until(async () => (await moduleIncidents(f.db, f.module.workspaceId, f.module.id)).length === 1);
  expect(f.supervisor.status(f.module.id, "v1", true)).toMatchObject({ state: "unknown", pid: 1, error: expect.stringContaining(unknown.message) });
  expect(await moduleIncidents(f.db, f.module.workspaceId, f.module.id)).toMatchObject([{ status: "unresolved", failures: 1, evidence: { phase: "process", exitCode: null } }]);
  // No restart timer survives an unknown exit; the polling loop is still present.
  expect(f.pending()).toEqual([30_000]);
  f.advance(1000);
  const errors = spyOn(console, "error");
  await f.supervisor.reconcile();
  expect(errors.mock.calls.some(([line]) => String(line).includes('"event":"reconcile.module_failed"') && String(line).includes(unknown.message))).toBe(true);
  errors.mockRestore();
  expect(f.processes).toHaveLength(1);
  const hash = replacement === "new hash" ? "v2" : "v1";
  if (replacement === "new hash") {
    await f.db.moduleVersion.create({ data: { moduleId: f.module.id, hash, manifest: f.manifest, source: "user", intent: {}, report: {}, status: "approved" } });
    await f.db.module.update({ where: { id: f.module.id }, data: { activeHash: hash } });
  }
  if (replacement !== "same activation") await f.db.$transaction(tx => recordModuleActivation(moduleContext(f.ports, f.module.workspaceId), tx, { moduleId: f.module.id, previousHash: "v1", hash, generationId: replacement }));
  await expect(f.supervisor.deliver(f.module.id, hash, event)).rejects.toMatchObject({ stage: "unavailable", message: unknown.message });
  await expect(f.supervisor.settleModule(f.module.id)).rejects.toBe(unknown);
  await expect(f.supervisor.stop()).rejects.toMatchObject({ name: "AggregateError", errors: [unknown] });
  expect(f.supervisor.status(f.module.id, hash, true)).toMatchObject({ state: "unknown", pid: 1 });
  expect(f.processes).toHaveLength(1);
  expect(await f.db.moduleRun.count()).toBe(1);
  expect(f.pending()).toEqual([]);
});

test("exit rejection before authentication retains startup ownership and blocks retry", async () => {
  const f = await fixture();
  const unknown = new Error("synthetic startup stop unknown");
  f.expectStopErrors(unknown);
  const start = f.ports.sandbox!.startModule!;
  f.ports.sandbox!.startModule = input => {
    const process = start(input);
    f.processes[0]!.rejectExit(unknown);
    return process;
  };
  await expect(f.deliver()).rejects.toMatchObject({ stage: "unavailable", message: unknown.message });
  expect(f.supervisor.status(f.module.id, "v1", false)).toMatchObject({ state: "unknown", pid: 1 });
  await expect(f.deliver()).rejects.toMatchObject({ stage: "unavailable", message: unknown.message });
  expect(f.processes).toHaveLength(1);
  expect(await f.db.moduleRun.count()).toBe(1);
  expect(await moduleIncidents(f.db, f.module.workspaceId, f.module.id)).toMatchObject([{ status: "unresolved", evidence: { phase: "start", exitCode: null } }]);
  expect(f.pending()).toEqual([]);
});

test("in-flight exit rejection reports lost delivery and retains ownership without replay", async () => {
  const unknown = new Error("synthetic in-flight stop unknown");
  let deliveries = 0;
  const f = await fixture({ keepAlive: true, handler: async () => { deliveries++; f.processes[0]!.rejectExit(unknown); return {}; } });
  f.expectStopErrors(unknown);
  await expect(f.deliver()).rejects.toMatchObject({ stage: "lost", message: unknown.message });
  await expect(f.deliver()).rejects.toMatchObject({ stage: "unavailable", message: unknown.message, cause: unknown });
  expect(f.supervisor.status(f.module.id, "v1", true)).toMatchObject({ state: "unknown", pid: 1 });
  expect(await moduleIncidents(f.db, f.module.workspaceId, f.module.id)).toMatchObject([{ status: "unresolved", failures: 1, deliveryUnknown: true, evidence: { phase: "event", delivery: "lost", exitCode: null } }]);
  f.advance(60_000);
  expect(f.pending()).toEqual([]);
  expect(f.processes).toHaveLength(1);
  expect(deliveries).toBe(1);
  expect(await f.db.moduleRun.count()).toBe(1);
});

test("stop aggregates every unknown owner while still stopping healthy modules", async () => {
  const f = await fixture({ keepAlive: true });
  const others: { id: string }[] = [];
  for (const name of ["second", "healthy"]) {
    const module = await f.db.module.create({ data: { workspaceId: f.module.workspaceId, name, activeHash: "v1" } });
    await f.db.moduleVersion.create({ data: { moduleId: module.id, hash: "v1", manifest: { ...f.manifest, name }, source: "user", intent: {}, report: {}, status: "approved" } });
    others.push(module);
  }
  const unknowns = [new Error("synthetic first stop unknown"), new Error("synthetic second stop unknown")];
  f.expectStopErrors(...unknowns);
  await f.supervisor.reconcile();
  expect(f.processes).toHaveLength(3);
  const first = f.processes.find(process => process.input.dataDir.endsWith(f.module.id))!;
  const second = f.processes.find(process => process.input.dataDir.endsWith(others[0]!.id))!;
  const healthy = f.processes.find(process => process.input.dataDir.endsWith(others[1]!.id))!;
  first.rejectExit(unknowns[0]!);
  second.rejectExit(unknowns[1]!);
  await until(async () => (await moduleIncidents(f.db, f.module.workspaceId, f.module.id)).length === 1 && (await moduleIncidents(f.db, f.module.workspaceId, others[0]!.id)).length === 1);
  expect(healthy.socket.destroyed).toBe(false);
  const logs: string[] = [];
  const logging = spyOn(console, "error").mockImplementation(line => { logs.push(String(line)); });
  try { await expect(f.supervisor.stop()).rejects.toBeInstanceOf(AggregateError); }
  finally { logging.mockRestore(); }
  expect(logs.map(line => JSON.parse(line))).toEqual([
    { component: "module-supervisor", event: "module.shutdown.failed", module: "example", moduleId: f.module.id, hash: "v1", pid: f.processes.indexOf(first) + 1, error: String(unknowns[0]) },
    { component: "module-supervisor", event: "module.shutdown.failed", module: "second", moduleId: others[0]!.id, hash: "v1", pid: f.processes.indexOf(second) + 1, error: String(unknowns[1]) },
  ]);
  expect(healthy.socket.destroyed).toBe(true);
  for (const moduleId of [f.module.id, others[0]!.id]) expect(f.supervisor.status(moduleId, "v1", true)).toMatchObject({ state: "unknown" });
  expect(f.pending()).toEqual([]);
});

test("tool events overlap and calls without uses retain their delivery receipts", async () => {
  let active = 0, maximum = 0;
  const f = await fixture({ uses: [], handler: async (_event, call) => {
    maximum = Math.max(maximum, ++active);
    const reply = await call("call", { target: "notify.send", args: { key: "key", level: "now", title: "Title", body: "Body" }, mode: "async", key: "key" } as never);
    await Bun.sleep(5); active--; return { result: reply };
  } });
  await installNotifyTarget(f.ports, f.module.workspaceId, true);
  const replies = await Promise.all([f.deliver(), f.deliver()]);
  expect(maximum).toBe(2); expect(f.processes).toHaveLength(1);
  expect(replies[0]).toMatchObject({ result: { result: { result: { status: "queued", duplicate: false } } } });
  expect(await f.db.moduleCall.count({ where: { method: "call", status: { not: "rejected" } } })).toBe(0);
});
test("duplicate keys return duplicate and a different event does not swallow the next notification", async () => {
  // Keys scoped to the event, as the SDK shorthands send them.
  const f = await fixture({ handler: async (event, call) => ({ result: await call("call", { target: "notify.send", args: { key: `${event.trigger.firedAt}:key`, level: "now", title: "Title", body: "Body" }, mode: "async", key: `${event.trigger.firedAt}:key` } as never) }) });
  await installNotifyTarget(f.ports, f.module.workspaceId, true);
  expect(await f.deliver()).toMatchObject({ result: { result: { result: { status: "queued", duplicate: false } } } });
  await callsSettled(f.ports);
  const first = await f.db.moduleInvocation.findFirstOrThrow({ where: { target: "notify", tool: "send" } });
  expect(first).toMatchObject({ status: "succeeded", attempts: 1 });
  expect(await f.deliver()).toMatchObject({ result: { result: { result: { callId: first.id, status: "succeeded", duplicate: true } } } });
  expect(await f.db.moduleInvocation.count({ where: { target: "notify", tool: "send" } })).toBe(1);
  await f.supervisor.deliver(f.module.id, "v1", { ...event, trigger: { ...event.trigger, firedAt: "2026-10-22T00:00:00Z" } });
  await callsSettled(f.ports);
  expect((await notices(f.db)).length).toBe(2);
  expect(await f.db.moduleInvocation.count({ where: { target: "notify", tool: "send", status: "succeeded", attempts: 1 } })).toBe(2);
  expect(await f.db.moduleCall.count({ where: { method: "call", status: { not: "rejected" } } })).toBe(0);
});

test("crash evidence is attributed, backoff cannot be bypassed, and reconnect remains unverified until a real call succeeds", async () => {
  const f = await fixture({ keepAlive: true });
  const start = f.ports.sandbox!.startModule!;
  f.ports.sandbox!.startModule = input => ({ ...start(input), stderr: () => "panic: Failed to start HTTP Client thread; password=example-private" });
  await f.supervisor.start();
  f.processes[0]!.kill();
  await until(async () => (await moduleIncidents(f.db, f.module.workspaceId, f.module.id)).length === 1);
  await until(() => f.supervisor.status(f.module.id, "v1", true).state === "backoff");
  await expect(f.deliver()).rejects.toMatchObject({ stage: "unavailable" });
  expect(await f.db.moduleRun.count()).toBe(1);
  const [failure] = await moduleIncidents(f.db, f.module.workspaceId, f.module.id);
  expect(failure).toMatchObject({ status: "retrying", evidence: { pid: 1, exitCode: 1 } });
  expect(failure!.evidence.stderr).toContain("HTTP Client thread");
  expect(failure!.evidence.stderr).not.toContain("example-private");
  f.advance(1000);
  await until(async () => (await moduleIncidents(f.db, f.module.workspaceId, f.module.id))[0]?.status === "verifying");
  await f.deliver();
  expect((await moduleIncidents(f.db, f.module.workspaceId, f.module.id))[0]).toMatchObject({ status: "recovered", failures: 1 });
  await f.supervisor.stop();
  expect(f.supervisor.status(f.module.id, "v1", true)).toEqual({ state: "unobserved", pid: null });
  expect((await moduleIncidents(f.db, f.module.workspaceId, f.module.id))[0]!.status).toBe("recovered");
});

test("lost in-flight delivery is never replayed and remains marked uncertain after functionality recovers", async () => {
  let calls = 0;
  const f = await fixture({ keepAlive: true, handler: async () => { calls++; if (calls === 1) f.processes[0]!.kill(); return {}; } });
  await expect(f.deliver()).rejects.toMatchObject({ stage: "lost" });
  expect(calls).toBe(1);
  const [failure] = await moduleIncidents(f.db, f.module.workspaceId, f.module.id);
  expect(failure).toMatchObject({ status: "retrying", deliveryUnknown: true, evidence: { phase: "event", delivery: "lost", exitCode: 1, triggerId: "tool:daily" } });
  expect(failure!.evidence.runId).toBe((await f.db.moduleRun.findFirstOrThrow()).id);
  f.advance(1000);
  await until(async () => (await moduleIncidents(f.db, f.module.workspaceId, f.module.id))[0]?.status === "verifying");
  expect(calls).toBe(1);
  await f.deliver();
  expect((await moduleIncidents(f.db, f.module.workspaceId, f.module.id))[0]).toMatchObject({ status: "recovered", deliveryUnknown: true });
});

test("startup failures capture evidence, retry only finitely and pause without a connected process", async () => {
  const f = await fixture({ keepAlive: true });
  let starts = 0;
  f.ports.sandbox!.startModule = () => { starts++; throw new Error("Runtime failed to launch"); };
  await f.supervisor.start();
  for (const delay of [1000, 2000]) {
    f.advance(delay);
    await until(() => starts === (delay === 1000 ? 2 : 3));
    await until(async () => await f.db.moduleRun.count() === starts);
    await Bun.sleep(20);
  }
  expect((await moduleIncidents(f.db, f.module.workspaceId, f.module.id))[0]).toMatchObject({ failures: 3, status: "unresolved", evidence: { phase: "start", pid: null } });
  f.advance(60_000); await f.supervisor.reconcile(); expect(starts).toBe(3);
});

test("an idle disconnected channel is detected even when the module process has not exited", async () => {
  const f = await fixture({ keepAlive: true });
  const start = f.ports.sandbox!.startModule!;
  f.ports.sandbox!.startModule = input => {
    const peer = start(input);
    let finish!: (exit: { code: number | null; signal: string | null }) => void;
    return { ...peer, exited: new Promise(resolve => { finish = resolve; }), kill() { peer.kill(); finish({ code: null, signal: "SIGKILL" }); } };
  };
  await f.supervisor.start();
  f.processes[0]!.kill();
  await until(async () => (await moduleIncidents(f.db, f.module.workspaceId, f.module.id)).length === 1);
  expect((await moduleIncidents(f.db, f.module.workspaceId, f.module.id))[0]).toMatchObject({ failures: 1, status: "retrying", evidence: { phase: "process", reason: "Module disconnected", signal: null } });
  await until(() => f.supervisor.status(f.module.id, "v1", true).state === "backoff");
  expect(await f.db.moduleRun.count()).toBe(1);
});

test("a module terminated with Chrona (SIGTERM) is restarted without an incident", async () => {
  const f = await fixture({ keepAlive: true });
  const start = f.ports.sandbox!.startModule!;
  let starts = 0;
  f.ports.sandbox!.startModule = input => {
    starts++;
    const peer = start(input);
    return { ...peer, exited: peer.exited.then(() => ({ code: null, signal: "SIGTERM" })) };
  };
  await f.supervisor.start();
  f.processes[0]!.kill();
  await until(() => f.supervisor.status(f.module.id, "v1", true).state === "backoff");
  expect(await moduleIncidents(f.db, f.module.workspaceId, f.module.id)).toHaveLength(0);
  expect(await f.db.moduleRun.count()).toBe(0);
  f.advance(60_000); await until(() => starts === 2);
});
test("exit before handshake retains the real signal and stderr rather than the cleanup kill", async () => {
  const f = await fixture({ keepAlive: true });
  f.ports.sandbox!.startModule = () => ({ pid: 999, exited: Promise.resolve({ code: null, signal: "SIGABRT" }), stderr: () => "panic: runtime initialization", kill() {} });
  await f.supervisor.start();
  expect((await moduleIncidents(f.db, f.module.workspaceId, f.module.id))[0]).toMatchObject({ evidence: { phase: "start", pid: 999, signal: "SIGABRT", stderr: "panic: runtime initialization" } });
});

test("old-version failures cannot pause the newly activated version", async () => {
  let fail!: () => void;
  const gate = new Promise<void>(resolve => { fail = resolve; });
  const f = await fixture({ handler: async () => { await gate; throw new Error("old version failed"); } });
  for (let i = 0; i < 2; i++) await f.db.moduleRun.create({ data: { moduleId: f.module.id, hash: "v1", triggerId: "daily", firedAt: f.ports.now(), exitCode: -1, error: "old failure" } });
  const request = f.deliver();
  await until(() => f.processes.length === 1);
  await f.db.moduleVersion.create({ data: { moduleId: f.module.id, hash: "v2", manifest: f.manifest, source: "user", intent: {}, report: {}, status: "approved" } });
  await f.db.module.update({ where: { id: f.module.id }, data: { activeHash: "v2" } });
  fail(); await expect(request).rejects.toThrow("old version failed");
  expect(await f.db.module.findUnique({ where: { id: f.module.id } })).toMatchObject({ status: "active", activeHash: "v2" });
  expect(await notices(f.db, { title: "模块连续失败，已暂停" })).toHaveLength(0);
});

test("normal lazy idle stop and administrative stop do not produce faults", async () => {
  const f = await fixture();
  await f.supervisor.start();
  expect(f.supervisor.status(f.module.id, "v1", false).state).toBe("idle");
  await f.deliver();
  f.advance(600_000);
  await until(() => f.processes[0]!.socket.destroyed);
  await f.supervisor.stop();
  expect(await moduleIncidents(f.db, f.module.workspaceId, f.module.id)).toEqual([]);
});
test("activated reaches opted-in modules once per version and again when a module they use changes version", async () => {
  const db = testDb({ injectedAgent: false }), dataDir = await mkdtemp("/tmp/cms-activated-");
  const workspace = await db.workspace.create({ data: { name: "activated" } });
  const create = async (name: string, hash: string, extra: Record<string, unknown>) => {
    const module = await db.module.create({ data: { workspaceId: workspace.id, name, activeHash: hash } });
    await db.moduleVersion.create({ data: { moduleId: module.id, hash, manifest: moduleManifestSchema.parse({ name, entry: "index.ts", tests: ["test.ts"], effects: [], tools: [{ name: "go", description: "go", parameters: { type: "object", properties: {}, required: [] },
        output: {}
    }], ...extra }), source: "user", intent: {}, report: {}, status: "approved" } });
    return module;
  };
  const web = await create("web", "w1", {}), app = await create("app", "a1", { activated: true, uses: ["web.page-set"] }), quiet = await create("quiet", "q1", { uses: ["web.page-set"] });
  const seen: string[] = [];
  const peer = testModuleProcess(async (event, _call, input) => { if (event.trigger.kind === "activated") seen.push(input.codeDir.split("/").at(-1)!); return {}; });
  const ports: StewardPorts = { db, dataDir, now: () => new Date("2026-11-02T12:00:00Z"), publicUrl: null, sandbox: { available: true, isolated: true, startModule: peer.startModule } };
  const supervisor = createModuleSupervisor(ports);
  cleanups.push(async () => { await supervisor.stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  await supervisor.reconcile(); await until(() => seen.length === 1);
  await supervisor.reconcile(); await Bun.sleep(50);
  expect(seen).toEqual(["a1"]);
  // web changes version: the app that uses it hears again; the module that did not opt in never does.
  await db.moduleVersion.create({ data: { moduleId: web.id, hash: "w2", manifest: (await db.moduleVersion.findFirstOrThrow({ where: { moduleId: web.id } })).manifest!, source: "user", intent: {}, report: {}, status: "approved" } });
  await db.module.update({ where: { id: web.id }, data: { activeHash: "w2" } });
  await supervisor.reconcile(); await until(() => seen.length === 2);
  expect(seen).toEqual(["a1", "a1"]);
  const recorded = async () => JSON.parse(await Bun.file(join(dataDir, "platform/activated.json")).text().catch(() => "{}"));
  await until(async () => (await recorded())[app.id] === "a1 web@w2");
  expect(await recorded()).toEqual({ [app.id]: "a1 web@w2" });
  expect(quiet.id).not.toBe(app.id);
});


test.each(["handler", "lost", "lost-without-diagnostics"] as const)("unconfirmed activation (%s) never records success or replays after restart", async failure => {
  const f = await fixture();
  const version = await f.db.moduleVersion.findFirstOrThrow({ where: { moduleId: f.module.id, hash: "v1" } });
  await f.db.moduleVersion.update({ where: { id: version.id }, data: { manifest: { ...f.manifest, activated: true } } });
  if (failure === "lost-without-diagnostics") {
    await f.db.$executeRawUnsafe("CREATE TRIGGER fail_activation_diagnostic BEFORE INSERT ON Audit BEGIN SELECT RAISE(ABORT, 'Synthetic diagnostic failure'); END");
  }
  let effects = 0;
  const peer = testModuleProcess(async event => {
    if (event.trigger.kind === "activated") {
      effects++;
      if (failure === "handler") throw new Error("registration password=fixture-value failed");
      peer.processes.at(-1)!.kill();
    }
    return {};
  });
  f.ports.sandbox = { available: true, isolated: true, startModule: peer.startModule };
  const logs = spyOn(console, "error").mockImplementation(() => {});
  try {
    await f.supervisor.reconcile();
    await until(() => logs.mock.calls.some(([line]) => String(line).includes('"event":"activation.failed"')));
    const file = Bun.file(join(f.ports.dataDir, "platform", "activated.json"));
    expect(JSON.parse(await file.text())[f.module.id]).toMatchObject({ signature: "v1", status: "unconfirmed" });
    const dependency = await f.db.module.create({ data: { workspaceId: f.module.workspaceId, name: "notify", activeHash: "n1" } });
    await f.db.moduleVersion.create({ data: { moduleId: dependency.id, hash: "n1", manifest: { name: "notify", entry: "index.ts", effects: [], tests: ["test.ts"] }, source: "user", status: "approved", intent: {}, report: {} } });
    for (let pass = 0; pass < 3; pass++) { await f.supervisor.reconcile(); await Bun.sleep(20); }
    await f.supervisor.stop();
    const restarted = createModuleSupervisor(f.ports, { timers: f.timers });
    try {
      for (let pass = 0; pass < 3; pass++) { await restarted.reconcile(); await Bun.sleep(20); }
      expect(effects).toBe(1);
    } finally { await restarted.stop(); }
    expect(JSON.stringify(logs.mock.calls)).not.toContain("fixture-value");
  } finally { logs.mockRestore(); }
});

test("activation failures proven unsent remain retryable without recording success", async () => {
  const f = await fixture();
  const version = await f.db.moduleVersion.findFirstOrThrow({ where: { moduleId: f.module.id, hash: "v1" } });
  await f.db.moduleVersion.update({ where: { id: version.id }, data: { manifest: { ...f.manifest, activated: true } } });
  f.ports.sandbox = { available: false, isolated: true };
  const logs = spyOn(console, "error").mockImplementation(() => {});
  const failures = () => logs.mock.calls.filter(([line]) => String(line).includes('"event":"activation.failed"')).length;
  try {
    for (let pass = 1; pass <= 3; pass++) {
      f.advance(120_000);
      await f.supervisor.reconcile(); await until(() => failures() >= pass); await Bun.sleep(20);
    }
    const file = Bun.file(join(f.ports.dataDir, "platform", "activated.json"));
    expect(await file.exists() ? JSON.parse(await file.text())[f.module.id] : undefined).toBeUndefined();
    expect(failures()).toBe(3);
  } finally { logs.mockRestore(); }
});


test.each(["trusted", "renamed", "fork", "unapproved", "drift", "manifest-drift", "missing-seed", "legacy-snapshot"] as const)("Provider host bindings require approved exact release identity (%s)", async kind => {
  const f = await fixture({ keepAlive: true });
  const root = join(f.ports.dataDir, "external"), codeDir = join(root, "pi");
  await mkdir(codeDir, { recursive: true });
  const manifest = moduleManifestSchema.parse({ ...f.manifest, name: "pi" });
  await writeFile(join(codeDir, "module.json"), JSON.stringify(manifest));
  await writeFile(join(codeDir, "index.ts"), "export {};");
  const release = await seedTestModuleRelease(root, "pi");
  const snapshot = createHash("sha256");
  for (const file of (await readModuleFiles(codeDir, "Host identity fixture")).sort((a, b) => a.path.localeCompare(b.path))) snapshot.update(file.path).update("\0").update(file.bytes).update("\0");
  const hash = kind === "fork" ? "b".repeat(40) : kind === "legacy-snapshot" ? snapshot.digest("hex") : release.commit;
  await f.db.module.update({ where: { id: f.module.id }, data: { name: kind === "renamed" ? "another-provider" : "pi", builtin: false, activeHash: hash } });
  await f.db.moduleVersion.create({ data: { moduleId: f.module.id, hash, manifest: kind === "manifest-drift" ? { ...manifest, description: "different" } : manifest, source: "user", status: kind === "unapproved" ? "pending_review" : "approved", intent: {}, report: {} } });
  await f.db.$transaction(tx => recordModuleActivation(moduleContext(f.ports, f.module.workspaceId), tx, { moduleId: f.module.id, hash, previousHash: "v1", generationId: "release" }));
  const privileged = testModuleProcess(async () => ({}));
  f.ports.moduleExternalResources = root;
  f.ports.providerModules = { pi: { env: { CHRONA_PROVIDER_CONFIGURATION: "trusted-host-fixture" }, startModule: privileged.startModule } };
  if (kind === "drift") await writeFile(join(codeDir, "index.ts"), "changed after approval");
  if (kind === "missing-seed") await rm(join(f.ports.dataDir, "module-git"), { recursive: true });
  await f.supervisor.reconcile();
  expect(privileged.processes).toHaveLength(kind === "trusted" ? 1 : 0);
  if (kind === "trusted") {
    expect(privileged.processes[0]!.input.env?.CHRONA_PROVIDER_CONFIGURATION).toBe("trusted-host-fixture");
    expect(privileged.processes[0]!.input.codeDir).toBe(join(f.ports.dataDir, "platform/store", hash));
  } else {
    expect(f.processes).toHaveLength(kind === "unapproved" || kind === "renamed" ? 0 : 1);
    for (const process of f.processes) expect(process.input.env).not.toHaveProperty("CHRONA_PROVIDER_CONFIGURATION");
  }
  expect(await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).toMatchObject({ activeHash: hash });
});


test("internal delivery fence rejects before execution and never sends an event", async () => {
  const f = await fixture();
  await expect(f.supervisor.deliver(f.module.id, "v1", event, { beforeDelivery: async () => { throw new Error("callback identity changed"); } })).rejects.toMatchObject({ stage: "unavailable", message: "callback identity changed" });
  expect(f.processes).toHaveLength(0);
  expect(await f.db.moduleRun.count()).toBe(0);
  expect(await f.db.audit.count({ where: { kind: "module_execution_result" } })).toBe(0);
  await f.deliver();
  expect(await f.db.moduleRun.count()).toBe(1);
});


test.each(["user", "build", "builtin"])("approved ordinary Pi from %s runs from store without a privileged host binding", async source => {
  const f = await fixture({ keepAlive: true }), hash = "a".repeat(40);
  const manifest = moduleManifestSchema.parse({ ...f.manifest, name: "pi" });
  await f.db.module.update({ where: { id: f.module.id }, data: { name: "pi", builtin: false, activeHash: hash } });
  await f.db.moduleVersion.create({ data: { moduleId: f.module.id, hash, manifest, source, status: "approved", intent: {}, report: {} } });
  await f.db.$transaction(tx => recordModuleActivation(moduleContext(f.ports, f.module.workspaceId), tx, { moduleId: f.module.id, hash, previousHash: "v1", generationId: "custom" }));
  f.ports.moduleBuiltinResources = join(f.ports.dataDir, "missing-release");
  await f.supervisor.reconcile();
  expect(f.processes.map(process => process.input.codeDir)).toEqual([join(f.ports.dataDir, "platform/store", hash)]);
  expect(await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).toMatchObject({ builtin: false, activeHash: hash, status: "active" });
});

test("audit retention cannot reset activation ownership, failure streak or receipt deduplication", async () => {
  const f = await fixture();
  const input = { workspaceId: f.module.workspaceId, moduleId: f.module.id, hash: "v1", activationId: f.activation.activationId, outcome: "failure" as const, now: f.ports.now() };
  await f.db.$transaction(tx => recordModuleExecution(tx, { ...input, resultId: "first" }));
  await f.db.audit.deleteMany();
  expect(await f.db.$transaction(tx => recordModuleExecution(tx, { ...input, resultId: "first" }))).toMatchObject({ consecutiveFailures: 1, duplicate: true });
  await f.db.$transaction(tx => recordModuleExecution(tx, { ...input, resultId: "second" }));
  expect(await f.db.$transaction(tx => recordModuleExecution(tx, { ...input, resultId: "third" }))).toMatchObject({ consecutiveFailures: 3, shouldPause: true });
  expect(await f.db.moduleExecutionResult.count()).toBe(3);
});


test("public health preserves stopping evidence while configured status is paused", async () => {
  registerSystemModules(); let release!: () => void, entered = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const f = await fixture({ shared: true, handler: async () => { entered = true; await gate; return {}; } });
  const delivery = f.deliver();
  try {
    await until(() => entered);
    await f.db.module.update({ where: { id: f.module.id }, data: { status: "paused" } });
    await f.supervisor.reconcile();
    const result = await callSync(f.ports, { ...kernelOrigin(f.module.workspaceId), caller: { kind: "owner", via: null } }, "modules.health", { moduleId: f.module.id });
    expect(result.output).toMatchObject({ items: [{ configuredStatus: "paused", runtime: { state: "stopping", pid: 1 } }] });
  } finally { release(); await delivery; }
});

test("public health retains unknown process ownership after the application is paused", async () => {
  registerSystemModules();
  const f = await fixture({ shared: true }), unknown = new Error("synthetic public stop unknown");
  f.expectStopErrors(unknown); await f.deliver();
  f.processes[0]!.rejectExit(unknown);
  await until(() => f.supervisor.status(f.module.id, "v1", false).state === "unknown");
  await f.db.module.update({ where: { id: f.module.id }, data: { status: "paused" } });
  const result = await callSync(f.ports, { ...kernelOrigin(f.module.workspaceId), caller: { kind: "owner", via: null } }, "modules.health", { moduleId: f.module.id });
  expect(result.output).toMatchObject({ items: [{ configuredStatus: "paused", runtime: { state: "unknown", pid: 1, error: expect.stringContaining(unknown.message) } }] });
});
