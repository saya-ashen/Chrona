import { afterEach, expect, test } from "bun:test";
import "./module-effects";
import { mkdtemp, rm } from "node:fs/promises";
import { testDb } from "./test-db";
import { testModuleProcess } from "./module-test-process";
import { moduleSupervisor } from "./module-supervisor";
import { createSchedules } from "./schedules";
import { drainSchedules } from "./schedule-delivery";
import type { StewardPorts } from "./ports";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function fixture(handler: Parameters<typeof testModuleProcess>[0] = async () => ({})) {
  const db = testDb(), dataDir = await mkdtemp("/tmp/chrona-delivery-");
  const workspace = await db.workspace.create({ data: { name: "delivery" } });
  const peer = testModuleProcess(handler);
  let now = new Date("2026-11-04T12:00:00Z");
  const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => now, sandbox: { available: true, isolated: false, startModule: peer.startModule } };
  async function module(name: string) {
    const row = await db.module.create({ data: { workspaceId: workspace.id, name, activeHash: name } });
    await db.moduleVersion.create({ data: { moduleId: row.id, hash: name, status: "approved", source: "user", intent: {}, report: {}, manifest: { name, entry: "index.ts", tests: ["test.ts"], effects: [], triggers: [], keepAlive: true } } });
    const schedule = await db.schedule.create({ data: { workspaceId: workspace.id, moduleId: row.id, mode: "module", text: "once", rule: { kind: "at", at: now.toISOString() }, payload: { text: "remind" }, nextAt: now, createdBy: "module" } });
    return { row, schedule };
  }
  cleanup.push(async () => { await moduleSupervisor(ports).stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  return { db, ports, peer, workspace, module, schedules: createSchedules(ports, workspace.id), advance: () => { now = new Date(now.getTime() + 700_000); } };
}
test("one-shot survives restart before delivery and retries a definitely unavailable target", async () => {
  let delivered = 0;
  const f = await fixture(async () => { delivered++; return {}; });
  const { row, schedule } = await f.module("reminder");
  await f.db.module.update({ where: { id: row.id }, data: { status: "paused" } });
  await f.schedules.fireDue(f.ports.now(), { waitForDelivery: false });
  expect(await f.db.schedule.findUniqueOrThrow({ where: { id: schedule.id } })).toMatchObject({ status: "done" });
  expect(await f.db.moduleInvocation.findFirstOrThrow()).toMatchObject({ status: "queued", attempts: 0 });
  await drainSchedules(f.ports, f.workspace.id);
  expect(await f.db.moduleInvocation.findFirstOrThrow()).toMatchObject({ status: "queued", attempts: 1 });
  await f.db.module.update({ where: { id: row.id }, data: { status: "active" } });
  f.advance();
  await createSchedules({ ...f.ports }, f.workspace.id).fireDue();
  expect(delivered).toBe(1);
  expect(await f.db.moduleInvocation.findFirstOrThrow()).toMatchObject({ status: "succeeded", attempts: 2 });
});
test("a slow module does not block another module or schedule admission", async () => {
  let release!: () => void, entered!: () => void, fast!: () => void;
  const gate = new Promise<void>(r => { release = r; }), started = new Promise<void>(r => { entered = r; }), completed = new Promise<void>(r => { fast = r; });
  const f = await fixture(async (_event, _call, input) => { if (input.codeDir.endsWith("slow")) { entered(); await gate; } else fast(); return {}; });
  await f.module("slow"); await f.module("fast");
  expect(await f.schedules.fireDue(f.ports.now(), { waitForDelivery: false })).toBe(2);
  const draining = drainSchedules(f.ports, f.workspace.id);
  try { await started; await completed; expect(await f.schedules.fireDue(f.ports.now(), { waitForDelivery: false })).toBe(0); }
  finally { release(); await draining; }
});
test("a later drain admits another module while an earlier module is still running", async () => {
  let release!: () => void, entered!: () => void, fast!: () => void;
  const gate = new Promise<void>(r => { release = r; }), started = new Promise<void>(r => { entered = r; }), completed = new Promise<void>(r => { fast = r; });
  const f = await fixture(async (_event, _call, input) => { if (input.codeDir.endsWith("slow")) { entered(); await gate; } else fast(); return {}; });
  await f.module("slow");
  await f.schedules.fireDue(f.ports.now(), { waitForDelivery: false });
  const first = drainSchedules(f.ports, f.workspace.id);
  await started;
  await f.module("fast");
  await f.schedules.fireDue(f.ports.now(), { waitForDelivery: false });
  const second = drainSchedules(f.ports, f.workspace.id);
  try { await completed; } finally { release(); await Promise.all([first, second]); }
});
test("cancelling an already due one-shot cancels its undelivered occurrence", async () => {
  let effects = 0;
  const f = await fixture(async () => { effects++; return {}; });
  const { row } = await f.module("reminder");
  await f.schedules.fireDue(f.ports.now(), { waitForDelivery: false });
  expect(await f.schedules.forModule(row.id, row.name).cancel("once")).toEqual({ cancelled: true });
  await drainSchedules(f.ports, f.workspace.id);
  expect(await f.db.moduleInvocation.findFirstOrThrow({ where: { mode: "schedule" } })).toMatchObject({ status: "cancelled", attempts: 0 });
  expect(effects).toBe(0);
});

test("delivery lost after an external effect is recorded unknown and never replayed", async () => {
  let effects = 0;
  const f = await fixture(async (_event, _call, input) => { effects++; f.peer.processes.find(p => p.input === input)!.kill(); await new Promise(() => {}); });
  await f.module("reminder");
  await f.schedules.fireDue();
  expect(await f.db.moduleInvocation.findFirstOrThrow()).toMatchObject({ status: "unknown", attempts: 1 });
  f.advance(); await f.schedules.fireDue();
  expect(effects).toBe(1);
});
test("an interrupted in-flight occurrence becomes unknown instead of being replayed", async () => {
  let effects = 0;
  const f = await fixture(async () => { effects++; return {}; });
  await f.module("reminder");
  await f.schedules.fireDue(f.ports.now(), { waitForDelivery: false });
  await f.db.moduleInvocation.updateMany({ data: { status: "running", leaseToken: "previous-process", leaseUntil: f.ports.now(), attempts: 1 } });
  await drainSchedules(f.ports, f.workspace.id);
  expect(await f.db.moduleInvocation.findFirstOrThrow()).toMatchObject({ status: "unknown" });
  expect(effects).toBe(0);
});
