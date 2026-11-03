import { afterEach, expect, test } from "bun:test";
import "./module-effects";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema, type ModuleEvent } from "@chrona/contracts/steward";
import { createModuleSupervisor } from "./module-supervisor";
import { testModuleProcess } from "./module-test-process";
import { testDb } from "./test-db";
import type { StewardPorts } from "./ports";
import { notices } from "./test-notices";
import { moduleIncidents } from "./module-diagnostics";
import { moduleContext } from "./module-context";
import { recordModuleActivation, moduleEvolutionOutcomes, updateModuleEvolution } from "./module-evolution";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const event: ModuleEvent = { trigger: { id: "daily", kind: "schedule", firedAt: "2026-10-21T00:00:00Z" }, now: "2026-10-21T00:00:00Z", params: {} };
async function until(condition: () => boolean | Promise<boolean>) { for (let i = 0; i < 200; i++) { if (await condition()) return; await Bun.sleep(5); } throw new Error("Condition not reached"); }
function clock() {
  let time = 0;
  const tasks = new Map<number, { at: number; fn: () => void }>(); let id = 0;
  return { timers: { setTimeout: ((fn: () => void, ms: number) => { tasks.set(++id, { at: time + ms, fn }); return id; }) as unknown as typeof setTimeout, clearTimeout: ((id: number) => { tasks.delete(id); }) as unknown as typeof clearTimeout },
    advance(ms: number) { time += ms; for (const [id, task] of [...tasks]) if (task.at <= time) { tasks.delete(id); task.fn(); } } };
}
async function fixture({ keepAlive = false, uses = ["notify.send", "provider.wake"], handler = async () => ({}) }: { keepAlive?: boolean; uses?: string[]; handler?: Parameters<typeof testModuleProcess>[0] } = {}) {
  const db = testDb(), dataDir = await mkdtemp("/tmp/cms-test-");
  const workspace = await db.workspace.create({ data: { name: "supervisor" } });
  const module = await db.module.create({ data: { workspaceId: workspace.id, name: "example", activeHash: "v1" } });
  const manifest = moduleManifestSchema.parse({ name: "example", entry: "index.ts", tests: ["test.ts"], keepAlive, effects: [], uses, triggers: [{ id: "daily", schedule: { kind: "daily", time: "09:00" } }] });
  await db.moduleVersion.create({ data: { moduleId: module.id, hash: "v1", manifest, source: "user", intent: {}, report: {}, status: "approved" } });
  const peer = testModuleProcess(handler), fakeClock = clock();
  let now = 0;
  const ports: StewardPorts = { db, dataDir, now: () => new Date(Date.UTC(2026, 9, 21) + now++), publicUrl: null, sandbox: { available: true, isolated: true, startModule: peer.startModule } };
  const supervisor = createModuleSupervisor(ports, { timers: fakeClock.timers });
  cleanups.push(async () => { await supervisor.stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  return { db, module, manifest, ports, supervisor, ...peer, ...fakeClock, deliver: () => supervisor.deliver(module.id, "v1", event) };
}
test.each([false, true] as const)("start failure rolls back once before delivery; rollback target failure does not bounce (oldFails=%s)", async oldFails => {
  const db = testDb(), dataDir = await mkdtemp("/tmp/cms-auto-rollback-");
  const workspace = await db.workspace.create({ data: { name: "auto rollback" } });
  const module = await db.module.create({ data: { workspaceId: workspace.id, name: "example", activeHash: "v2", dataSchema: 1 } });
  const manifest = moduleManifestSchema.parse({ name: "example", entry: "index.ts", keepAlive: true, tests: ["test.ts"], triggers: [], listen: "/api/example", effects: ["network"] });
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
  const db = testDb(), dataDir = await mkdtemp("/tmp/cms-post-delivery-");
  const workspace = await db.workspace.create({ data: { name: "post-delivery" } });
  const module = await db.module.create({ data: { workspaceId: workspace.id, name: "example", activeHash: "v2", dataSchema: 1 } });
  const manifest = moduleManifestSchema.parse({ name: "example", entry: "index.ts", keepAlive: true, tests: ["test.ts"], triggers: [{ id: "daily", schedule: { kind: "daily", time: "09:00" } }], effects: [] });
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

test("lazy start, private short socket directory, idle stop and restart", async () => {
  const f = await fixture();
  await f.supervisor.start(); expect(f.processes).toHaveLength(0);
  await f.deliver(); expect(f.processes).toHaveLength(1);
  const path = f.processes[0]!.input.socketPath;
  expect(path.length).toBeLessThan(108);
  expect((await stat(join(path, ".."))).mode & 0o777).toBe(0o700);
  f.advance(600_000);
  await until(() => f.processes[0]!.socket.destroyed);
  await until(async () => !(await stat(path).catch(() => null)));
  await f.deliver(); expect(f.processes).toHaveLength(2);
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
  expect(await stat(f.processes[0]!.input.socketPath).catch(() => null)).toBeNull();
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
test("version switch drains old event while new events use the new process; stop kills all", async () => {
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const f = await fixture({ handler: async (_event, _call, input) => { if (input.codeDir.endsWith("v1")) await gate; return { result: input.codeDir }; } });
  const old = f.deliver(); await until(() => f.processes.length === 1);
  await f.db.moduleVersion.create({ data: { moduleId: f.module.id, hash: "v2", manifest: f.manifest, source: "user", intent: {}, report: {}, status: "approved" } });
  await f.db.module.update({ where: { id: f.module.id }, data: { activeHash: "v2" } });
  const reply = await f.supervisor.deliver(f.module.id, "v2", event);
  expect(reply).toMatchObject({ result: { result: expect.stringContaining("v2") } });
  expect(f.processes[0]!.socket.destroyed).toBe(false);
  finish(); await old;
  await until(() => f.processes[0]!.socket.destroyed);
  await f.supervisor.stop(); expect(f.processes.every(process => process.socket.destroyed)).toBe(true);
});
test("events are serial and calls without uses are executed and recorded", async () => {
  let active = 0, maximum = 0;
  const f = await fixture({ uses: [], handler: async (_event, call) => {
    maximum = Math.max(maximum, ++active);
    const reply = await call("call", { target: "notify.send", args: { key: "key", level: "now", title: "Title", body: "Body" }, mode: "async", key: "key" } as never);
    await Bun.sleep(5); active--; return { result: reply };
  } });
  const replies = await Promise.all([f.deliver(), f.deliver()]);
  expect(maximum).toBe(1); expect(f.processes).toHaveLength(1);
  expect(replies[0]).toMatchObject({ result: { result: { result: { status: "queued", duplicate: false } } } });
  expect(await f.db.moduleCall.findMany()).toHaveLength(2);
  expect(await f.db.moduleCall.findFirstOrThrow()).toMatchObject({ method: "call", status: "executed", error: null, moduleRunId: expect.any(String) });
});
test("duplicate keys return duplicate and a different event does not swallow the next notification", async () => {
  // Keys scoped to the event, as the SDK shorthands send them.
  const f = await fixture({ handler: async (event, call) => ({ result: await call("call", { target: "notify.send", args: { key: `${event.trigger.firedAt}:key`, level: "now", title: "Title", body: "Body" }, mode: "async", key: `${event.trigger.firedAt}:key` } as never) }) });
  expect(await f.deliver()).toMatchObject({ result: { result: { result: { status: "queued", duplicate: false } } } });
  expect(await f.deliver()).toMatchObject({ result: { result: { result: { status: "queued", duplicate: true } } } });
  await f.supervisor.deliver(f.module.id, "v1", { ...event, trigger: { ...event.trigger, firedAt: "2026-10-22T00:00:00Z" } });
  expect((await notices(f.db)).length).toBe(2);
  expect(await f.db.moduleCall.count()).toBe(3);
});

test("crash evidence is attributed, backoff cannot be bypassed, and reconnect remains unverified until a real call succeeds", async () => {
  const f = await fixture({ keepAlive: true });
  const start = f.ports.sandbox!.startModule!;
  f.ports.sandbox!.startModule = input => ({ ...start(input), stderr: () => "panic: Failed to start HTTP Client thread; password=example-private", limits: { virtualMemoryMb: 512 } });
  await f.supervisor.start();
  f.processes[0]!.kill();
  await until(async () => (await moduleIncidents(f.db, f.module.workspaceId, f.module.id)).length === 1);
  await until(() => f.supervisor.status(f.module.id, "v1", true).state === "backoff");
  await expect(f.deliver()).rejects.toMatchObject({ stage: "unavailable" });
  expect(await f.db.moduleRun.count()).toBe(1);
  const [failure] = await moduleIncidents(f.db, f.module.workspaceId, f.module.id);
  expect(failure).toMatchObject({ status: "retrying", evidence: { pid: 1, exitCode: 1, virtualMemoryMb: 512 } });
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
  expect(failure).toMatchObject({ status: "retrying", deliveryUnknown: true, evidence: { phase: "event", delivery: "lost", exitCode: 1, triggerId: "daily" } });
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
  f.ports.sandbox!.startModule = () => ({ pid: 999, exited: Promise.resolve({ code: null, signal: "SIGABRT" }), stderr: () => "panic: runtime initialization", limits: { virtualMemoryMb: 512 }, kill() {} });
  await f.supervisor.start();
  expect((await moduleIncidents(f.db, f.module.workspaceId, f.module.id))[0]).toMatchObject({ evidence: { phase: "start", pid: 999, signal: "SIGABRT", stderr: "panic: runtime initialization", virtualMemoryMb: 512 } });
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
  const db = testDb(), dataDir = await mkdtemp("/tmp/cms-activated-");
  const workspace = await db.workspace.create({ data: { name: "activated" } });
  const create = async (name: string, hash: string, extra: Record<string, unknown>) => {
    const module = await db.module.create({ data: { workspaceId: workspace.id, name, activeHash: hash } });
    await db.moduleVersion.create({ data: { moduleId: module.id, hash, manifest: moduleManifestSchema.parse({ name, entry: "index.ts", tests: ["test.ts"], triggers: [], effects: [], tools: [{ name: "go", description: "go", parameters: { type: "object", properties: {}, required: [] } }], ...extra }), source: "user", intent: {}, report: {}, status: "approved" } });
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
