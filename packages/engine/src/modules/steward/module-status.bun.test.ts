import { afterEach, expect, test } from "bun:test";
import { testDb } from "./test-db";
import { moduleContext } from "./module-context";
import { pauseFailedModule } from "./module-effects";
import { requestStatus, setStatusIn } from "./module-status";
import { recordModuleFailure } from "./module-diagnostics";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
async function fixture() {
  const db = testDb(); cleanups.push(() => db.$disconnect());
  const workspace = await db.workspace.create({ data: { name: "pause", settings: { notifications: { timezone: "UTC", dailyCap: 5, quietHours: { start: "23:00", end: "08:00" }, digestAt: "09:00" } } } });
  const module = await db.module.create({ data: { workspaceId: workspace.id, name: "example", activeHash: "v1" } });
  let now = new Date("2026-11-04T12:00:00Z");
  const ports = { db, dataDir: "/not-used-for-pause", publicUrl: null, now: () => now };
  const context = moduleContext(ports, workspace.id);
  const schedule = (status = "active", rule = { kind: "every", minutes: 60 } as Record<string, string | number>) => db.schedule.create({ data: {
    workspaceId: workspace.id, moduleId: module.id, mode: "module", triggerId: "daily", text: "timer", createdBy: "chrona", rule, status,
    nextAt: status === "active" ? now : null,
  } });
  const status = (value: "active" | "paused", source = "owner", reason = source) => db.$transaction(tx => setStatusIn(context, tx, module.id, value, { source, reason }));
  const failure = async (hash = "v1") => {
    const run = await db.moduleRun.create({ data: { moduleId: module.id, hash, triggerId: "daily", firedAt: now, error: "disconnected", exitCode: -1 } });
    await db.$transaction(async tx => {
      await recordModuleFailure(tx, { workspaceId: workspace.id, moduleId: module.id, hash, now, retry: false, evidence: {
        phase: "event", reason: "disconnected", triggerId: "daily", runId: run.id, delivery: "lost", pid: null, exitCode: -1, signal: null, stderr: "", virtualMemoryMb: null,
      } });
      await pauseFailedModule(tx, ports, { workspaceId: workspace.id, moduleId: module.id, hash, triggerId: "daily", firedAt: now }, run.id);
    });
  };
  const audit = (kind: string) => db.audit.findFirstOrThrow({ where: { workspaceId: workspace.id, subjectId: module.id, kind }, orderBy: { createdAt: "desc" } });
  return { db, workspace, module, ports, context, schedule, status, failure, audit, advance: () => { now = new Date(now.getTime() + 86400_000); } };
}

test("three failures share the manual pause record, including incident and exact schedule IDs; resume restores only those", async () => {
  const f = await fixture(), timer = await f.schedule(), userPaused = await f.schedule("paused");
  await f.failure(); await f.failure();
  expect((await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).status).toBe("active");
  expect(await f.db.audit.count({ where: { kind: "module_disabled" } })).toBe(0);
  await f.failure();
  expect((await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).status).toBe("paused");
  const incident = await f.audit("module_runtime_incident");
  expect((await f.audit("module_disabled")).details).toEqual({ source: "automatic", reason: "连续三次失败", schedules: [timer.id], incidentId: (incident.details as { id: string }).id });
  expect(await f.db.schedule.findUniqueOrThrow({ where: { id: timer.id } })).toMatchObject({ status: "paused", nextAt: null });
  expect(await f.db.moduleInvocation.count({ where: { target: "notify", tool: "send" } })).toBe(1);
  await f.status("active");
  expect(await f.db.schedule.findUniqueOrThrow({ where: { id: timer.id } })).toMatchObject({ status: "active", nextAt: new Date("2026-11-04T13:00:00Z") });
  expect(await f.db.schedule.findUniqueOrThrow({ where: { id: userPaused.id } })).toMatchObject({ status: "paused", nextAt: null });
  expect((await f.audit("module_enabled")).details).toEqual({ source: "owner", schedules: [timer.id] });
});

test.each(["owner", "cli", "chrona"])("%s pause/resume remains idempotent and uses only the latest pause's schedules", async source => {
  const f = await fixture(), timer = await f.schedule(), userPaused = await f.schedule("paused");
  const pause = () => source === "chrona" ? requestStatus(f.context, f.module.id, "paused", "maintenance") : f.status("paused", source, "maintenance");
  await pause(); await pause();
  expect(await f.db.audit.count({ where: { kind: "module_disabled" } })).toBe(1);
  expect((await f.audit("module_disabled")).details).toEqual({ source, reason: "maintenance", schedules: [timer.id] });
  await f.status("active", source);
  await f.db.schedule.update({ where: { id: timer.id }, data: { status: "paused", nextAt: null } });
  await f.db.schedule.update({ where: { id: userPaused.id }, data: { status: "active", nextAt: f.ports.now() } });
  await pause();
  // A fixed clock exercises same-millisecond transition ordering as well.
  expect((await f.audit("module_disabled")).details).toEqual({ source, reason: "maintenance", schedules: [userPaused.id] });
  await f.status("active", source); await f.status("active", source);
  expect(await f.db.audit.count({ where: { kind: "module_enabled" } })).toBe(2);
  expect(await f.db.schedule.findUniqueOrThrow({ where: { id: timer.id } })).toMatchObject({ status: "paused", nextAt: null });
  expect(await f.db.schedule.findUniqueOrThrow({ where: { id: userPaused.id } })).toMatchObject({ status: "active", nextAt: new Date("2026-11-04T13:00:00Z") });
});

test("three failures from a stale version cannot pause the current module or schedules", async () => {
  const f = await fixture(), timer = await f.schedule();
  await f.db.module.update({ where: { id: f.module.id }, data: { activeHash: "v2" } });
  await f.failure("v1"); await f.failure("v1"); await f.failure("v1");
  expect(await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).toMatchObject({ activeHash: "v2", status: "active" });
  expect(await f.db.schedule.findUniqueOrThrow({ where: { id: timer.id } })).toMatchObject({ status: "active" });
  expect(await f.db.audit.count({ where: { kind: "module_disabled" } })).toBe(0);
  expect(await f.db.moduleInvocation.count()).toBe(0);
});

test.each(["no audit", "audit without IDs", "after manual resume"])("legacy auto-pause (%s) keeps schedules paused and explicitly records missing provenance", async history => {
  const f = await fixture(), timer = await f.schedule();
  if (history === "after manual resume") { await f.status("paused"); await f.status("active"); }
  if (history === "audit without IDs") await f.db.audit.create({ data: { workspaceId: f.workspace.id, subjectId: f.module.id, actorKey: "chrona", kind: "module_disabled", details: { source: "automatic", reason: "legacy failures" } } });
  await f.db.module.update({ where: { id: f.module.id }, data: { status: "paused" } });
  await f.db.schedule.update({ where: { id: timer.id }, data: { status: "paused" } });
  await f.status("active");
  expect((await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).status).toBe("active");
  expect((await f.db.schedule.findUniqueOrThrow({ where: { id: timer.id } })).status).toBe("paused");
  expect((await f.audit("module_enabled")).details).toEqual({ source: "owner", schedules: [], unrestoredLegacyPause: true });
});

test("resume fires a missed one-off late, ends expired timers, continues recurring work without catching up", async () => {
  const f = await fixture(), recurring = await f.schedule(), oneOff = await f.schedule("active", { kind: "at", at: "2026-11-04T13:00:00Z" });
  const expired = await f.schedule();
  await f.db.schedule.update({ where: { id: expired.id }, data: { until: new Date("2026-11-04T13:00:00Z") } });
  await f.db.schedule.update({ where: { id: recurring.id }, data: { lastAt: f.ports.now(), lastResult: "delivery unknown", failures: 1 } });
  await f.failure(); await f.failure(); await f.failure();
  const runs = await f.db.moduleRun.findMany(), calls = await f.db.moduleInvocation.findMany();
  f.advance();
  await f.status("active");
  expect(await f.db.schedule.findUniqueOrThrow({ where: { id: recurring.id } })).toMatchObject({ status: "active", nextAt: new Date("2026-11-05T13:00:00Z"), lastAt: recurring.nextAt, lastResult: "delivery unknown", failures: 1 });
  // The one-off never ran while paused: it fires late, once. The expired timer ends; nothing else is replayed.
  expect(await f.db.schedule.findUniqueOrThrow({ where: { id: oneOff.id } })).toMatchObject({ status: "active", nextAt: f.ports.now() });
  expect(await f.db.schedule.findUniqueOrThrow({ where: { id: expired.id } })).toMatchObject({ status: "done", nextAt: null });
  expect(await f.db.moduleRun.findMany()).toEqual(runs);
  expect(await f.db.moduleInvocation.findMany()).toEqual(calls);
  expect(await f.db.run.count()).toBe(0);
});
