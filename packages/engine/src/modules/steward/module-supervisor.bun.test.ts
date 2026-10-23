import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema, type ModuleEvent } from "@chrona/contracts/steward";
import { createModuleSupervisor } from "./module-supervisor";
import { testModuleProcess } from "./module-test-process";
import { testDb } from "./test-db";
import type { StewardPorts } from "./ports";

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
  const affair = await db.affair.create({ data: { workspaceId: workspace.id, title: "Module", dirName: "module" } });
  const module = await db.module.create({ data: { workspaceId: workspace.id, affairId: affair.id, name: "example", activeHash: "v1" } });
  const manifest = moduleManifestSchema.parse({ name: "example", entry: "index.ts", tests: ["test.ts"], keepAlive, effects, triggers: [{ id: "daily", schedule: { kind: "daily", time: "09:00" } }] });
  await db.moduleVersion.create({ data: { moduleId: module.id, hash: "v1", manifest, source: "user", intent: {}, report: {}, status: "approved" } });
  const peer = testModuleProcess(handler), fakeClock = clock();
  let now = 0;
  const ports: StewardPorts = { db, dataDir, now: () => new Date(Date.UTC(2026, 9, 21) + now++), publicUrl: null, deliveries: [], chat: null, sandbox: { available: true, startModule: peer.startModule } };
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
  expect(await f.db.notification.count({ where: { title: "模块连续失败，已暂停" } })).toBe(1);
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
    const reply = await call("notify", { key: "key", level: "now", title: "Title", body: "Body" });
    await Bun.sleep(5); active--; return { result: reply };
  } });
  const replies = await Promise.all([f.deliver(), f.deliver()]);
  expect(maximum).toBe(1); expect(f.processes).toHaveLength(1);
  expect(replies[0]).toMatchObject({ result: { result: { error: { code: "undeclared" } } } });
  expect(await f.db.moduleCall.findMany()).toHaveLength(2);
  expect(await f.db.moduleCall.findFirstOrThrow()).toMatchObject({ method: "notify", status: "rejected", error: "undeclared", moduleRunId: expect.any(String) });
});
test("duplicate keys return duplicate and a different event does not swallow the next notification", async () => {
  const f = await fixture({ handler: async (_event, call) => ({ result: await call("notify", { key: "key", level: "now", title: "Title", body: "Body" }) }) });
  expect(await f.deliver()).toMatchObject({ result: { result: { result: { status: "executed" } } } });
  expect(await f.deliver()).toMatchObject({ result: { result: { result: { status: "duplicate" } } } });
  await f.supervisor.deliver(f.module.id, "v1", { ...event, trigger: { ...event.trigger, firedAt: "2026-10-22T00:00:00Z" } });
  expect(await f.db.notification.count()).toBe(2);
  expect(await f.db.moduleCall.count()).toBe(3);
});
