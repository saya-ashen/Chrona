import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema, type ModuleEvent } from "@chrona/contracts/steward";
import { createModuleSupervisor } from "./module-supervisor";
import { testModuleProcess } from "./module-test-process";
import { testDb } from "./test-db";
import type { StewardPorts } from "./ports";
import { notices } from "./test-notices";
import { moduleIncidents } from "./module-diagnostics";

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
async function fixture({ keepAlive = false, effects = ["notify_user", "wake_provider"], handler = async () => ({}) }: { keepAlive?: boolean; effects?: string[]; handler?: Parameters<typeof testModuleProcess>[0] } = {}) {
  const db = testDb(), dataDir = await mkdtemp("/tmp/cms-test-");
  const workspace = await db.workspace.create({ data: { name: "supervisor" } });
  const module = await db.module.create({ data: { workspaceId: workspace.id, name: "example", activeHash: "v1" } });
  const manifest = moduleManifestSchema.parse({ name: "example", entry: "index.ts", tests: ["test.ts"], keepAlive, effects, triggers: [{ id: "daily", schedule: { kind: "daily", time: "09:00" } }] });
  await db.moduleVersion.create({ data: { moduleId: module.id, hash: "v1", manifest, source: "user", intent: {}, report: {}, status: "approved" } });
  const peer = testModuleProcess(handler), fakeClock = clock();
  let now = 0;
  const ports: StewardPorts = { db, dataDir, now: () => new Date(Date.UTC(2026, 9, 21) + now++), publicUrl: null, sandbox: { available: true, isolated: true, startModule: peer.startModule } };
  const supervisor = createModuleSupervisor(ports, { timers: fakeClock.timers });
  cleanups.push(async () => { await supervisor.stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  return { db, module, manifest, ports, supervisor, ...peer, ...fakeClock, deliver: () => supervisor.deliver(module.id, "v1", event) };
}
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
test("events are serial and calls carry event-scoped dedupe; undeclared calls recorded", async () => {
  let active = 0, maximum = 0;
  const f = await fixture({ effects: [], handler: async (_event, call) => {
    maximum = Math.max(maximum, ++active);
    const reply = await call("call", { target: "notify.send", args: { key: "key", level: "now", title: "Title", body: "Body" }, mode: "async", key: "key" } as never);
    await Bun.sleep(5); active--; return { result: reply };
  } });
  const replies = await Promise.all([f.deliver(), f.deliver()]);
  expect(maximum).toBe(1); expect(f.processes).toHaveLength(1);
  expect(replies[0]).toMatchObject({ result: { result: { error: { code: "undeclared" } } } });
  expect(await f.db.moduleCall.findMany()).toHaveLength(2);
  expect(await f.db.moduleCall.findFirstOrThrow()).toMatchObject({ method: "call", status: "rejected", error: "undeclared", moduleRunId: expect.any(String) });
});
test("duplicate keys return duplicate and a different event does not swallow the next notification", async () => {
  // The deprecated notify_user effect stands for notify.send (grantedUses), so this older manifest still may call it.
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
