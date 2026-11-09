import { afterEach, expect, test } from "bun:test";
import "./module-effects";
import { mkdtemp, rm } from "node:fs/promises";
import { testDb } from "./test-db";
import { testModuleProcess } from "./module-test-process";
import { moduleSupervisor } from "./module-supervisor";
import { drainSchedules } from "./schedule-delivery";
import { moduleContext } from "./module-context";
import { recordModuleActivation } from "./module-evolution";
import { setStatusIn } from "./module-status";
import type { StewardPorts } from "./ports";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function fixture(handler: Parameters<typeof testModuleProcess>[0] = async () => ({})) {
  const db = testDb(), dataDir = await mkdtemp("/tmp/chrona-delivery-");
  const workspace = await db.workspace.create({ data: { name: "delivery" } });
  const peer = testModuleProcess(handler);
  let now = new Date("2026-11-04T12:00:00Z");
  const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => now, sandbox: { available: true, isolated: false, startModule: peer.startModule } };
  const context = moduleContext(ports, workspace.id);
  // Seed an already-admitted occurrence, without any calendar API or rule calculation.
  async function module(name: string) {
    const row = await db.module.create({ data: { workspaceId: workspace.id, name, activeHash: name } });
    await db.moduleVersion.create({ data: { moduleId: row.id, hash: name, status: "approved", source: "user", intent: {}, report: {}, manifest: { name, entry: "index.ts", tests: ["test.ts"], effects: [], keepAlive: true } } });
    const { activationId } = await db.$transaction(tx => recordModuleActivation(context, tx, { moduleId: row.id, previousHash: null, hash: name, generationId: "fixture" }));
    const schedule = await db.schedule.create({ data: { workspaceId: workspace.id, moduleId: row.id, mode: "module", status: "done", text: "once", rule: {}, payload: { text: "remind" }, lastAt: now, createdBy: "module" } });
    const invocation = await db.moduleInvocation.create({ data: { workspaceId: workspace.id, caller: "system:schedules", target: name, tool: "schedule", key: `${schedule.id}:${now.toISOString()}`, mode: "schedule", nextAttemptAt: now, createdAt: now,
      args: { scheduleId: schedule.id, moduleId: row.id, hash: name, activationId, triggerId: null, firedAt: now.toISOString(), claimedAt: now.toISOString(), payload: schedule.payload } } });
    return { row, schedule, invocation, activationId };
  }
  cleanup.push(async () => { await moduleSupervisor(ports).stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  return { db, ports, peer, workspace, context, module, drain: () => drainSchedules(ports, workspace.id), advance: () => { now = new Date(now.getTime() + 700_000); } };
}

test("a recorded occurrence retries only a definitely unavailable target", async () => {
  let delivered = 0;
  const f = await fixture(async () => { delivered++; return {}; });
  const { row } = await f.module("reminder");
  await f.db.module.update({ where: { id: row.id }, data: { status: "paused" } });
  await f.drain();
  expect(await f.db.moduleInvocation.findFirstOrThrow()).toMatchObject({ status: "queued", attempts: 1 });
  await f.db.module.update({ where: { id: row.id }, data: { status: "active" } });
  f.advance(); await drainSchedules({ ...f.ports }, f.workspace.id);
  expect(delivered).toBe(1);
  expect(await f.db.moduleInvocation.findFirstOrThrow()).toMatchObject({ status: "succeeded", attempts: 2 });
});

test("a slow module does not block another recorded delivery", async () => {
  let release!: () => void, entered!: () => void, fast!: () => void;
  const gate = new Promise<void>(r => { release = r; }), started = new Promise<void>(r => { entered = r; }), completed = new Promise<void>(r => { fast = r; });
  const f = await fixture(async (_event, _call, input) => { if (input.codeDir.endsWith("slow")) { entered(); await gate; } else fast(); return {}; });
  await f.module("slow"); await f.module("fast");
  const draining = f.drain();
  try { await started; await completed; } finally { release(); await draining; }
  expect(await f.db.moduleInvocation.count({ where: { status: "succeeded" } })).toBe(2);
});

test("a later drain admits another module while an earlier module is still running", async () => {
  let release!: () => void, entered!: () => void, fast!: () => void;
  const gate = new Promise<void>(r => { release = r; }), started = new Promise<void>(r => { entered = r; }), completed = new Promise<void>(r => { fast = r; });
  const f = await fixture(async (_event, _call, input) => { if (input.codeDir.endsWith("slow")) { entered(); await gate; } else fast(); return {}; });
  await f.module("slow");
  const first = f.drain();
  await started;
  await f.module("fast");
  const second = f.drain();
  try { await completed; } finally { release(); await Promise.all([first, second]); }
});

test("pausing cancels an undelivered occurrence of an already completed one-shot", async () => {
  let effects = 0;
  const f = await fixture(async () => { effects++; return {}; });
  const { row } = await f.module("reminder");
  await f.db.$transaction(tx => setStatusIn(f.context, tx, row.id, "paused", "owner"));
  await f.drain();
  expect(await f.db.moduleInvocation.findFirstOrThrow()).toMatchObject({ status: "cancelled", attempts: 0 });
  expect(effects).toBe(0);
});

test.each(["cancelled schedule", "changed hash", "changed activation"])("%s blocks a recorded occurrence without effects", async change => {
  let effects = 0;
  const f = await fixture(async () => { effects++; return {}; });
  const { row, schedule } = await f.module("reminder");
  if (change === "cancelled schedule") await f.db.schedule.update({ where: { id: schedule.id }, data: { status: "cancelled" } });
  if (change === "changed hash") await f.db.module.update({ where: { id: row.id }, data: { activeHash: "replacement" } });
  if (change === "changed activation") await f.db.$transaction(tx => recordModuleActivation(f.context, tx, { moduleId: row.id, previousHash: row.activeHash, hash: row.activeHash!, generationId: "replacement" }));
  await f.drain();
  expect(await f.db.moduleInvocation.findFirstOrThrow()).toMatchObject({ status: "cancelled", attempts: 1 });
  expect(effects).toBe(0);
});

test("delivery lost after an external effect is recorded unknown and never replayed", async () => {
  let effects = 0;
  const f = await fixture(async (_event, _call, input) => { effects++; f.peer.processes.find(p => p.input === input)!.kill(); await new Promise(() => {}); });
  await f.module("reminder");
  await f.drain();
  expect(await f.db.moduleInvocation.findFirstOrThrow()).toMatchObject({ status: "unknown", attempts: 1 });
  f.advance(); await f.drain();
  expect(effects).toBe(1);
});

test("an interrupted in-flight occurrence becomes unknown instead of being replayed", async () => {
  let effects = 0;
  const f = await fixture(async () => { effects++; return {}; });
  await f.module("reminder");
  await f.db.moduleInvocation.updateMany({ data: { status: "running", leaseToken: "previous-process", leaseUntil: f.ports.now(), attempts: 1 } });
  await f.drain();
  expect(await f.db.moduleInvocation.findFirstOrThrow()).toMatchObject({ status: "unknown" });
  expect(effects).toBe(0);
});
