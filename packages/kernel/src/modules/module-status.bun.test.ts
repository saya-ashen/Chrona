import { afterEach, expect, test } from "bun:test";
import { testDb } from "../__testing__/test-db";
import { notices } from "../__testing__/test-notices";
import { moduleContext } from "./module-context";
import { pauseFailedModule } from "./module-effects";
import { requestStatus, setStatusIn } from "./module-status";
import { recordModuleFailure } from "./module-diagnostics";
import { recordModuleActivation } from "./module-evolution";
import { moduleManifestSchema } from "@chrona/contracts/steward";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
async function fixture() {
  const db = testDb(); cleanups.push(() => db.$disconnect());
  const workspace = await db.workspace.create({ data: { name: "pause" } });
  const module = await db.module.create({ data: { workspaceId: workspace.id, name: "example", activeHash: "v1" } });
  let now = new Date("2026-11-04T12:00:00Z");
  const ports = { db, dataDir: "/not-used-for-pause", publicUrl: null, now: () => now };
  const context = moduleContext(ports, workspace.id);
  await db.moduleVersion.create({ data: { moduleId: module.id, hash: "v1", manifest: moduleManifestSchema.parse({ name: "example", entry: "index.ts", keepAlive: true, tests: ["test.ts"], effects: [] }), source: "user", status: "approved", intent: {}, report: {} } });
  const { activationId } = await db.$transaction(tx => recordModuleActivation(context, tx, { moduleId: module.id, previousHash: null, hash: "v1", generationId: "fixture" }));
  // Deliberately opaque rule: lifecycle governance must never interpret calendar schemas.
  const schedule = (status = "active") => db.timer.create({ data: {
    workspaceId: workspace.id, moduleId: module.id, timerId: crypto.randomUUID(), rule: {}, status,
    nextAt: status === "active" ? now : null,
  } });
  const status = (value: "active" | "paused", source = "owner", reason = source) => db.$transaction(tx => setStatusIn(context, tx, module.id, value, { source, reason }));
  const failure = async (hash = "v1") => {
    const run = await db.moduleRun.create({ data: { moduleId: module.id, hash, triggerId: "daily", firedAt: now, error: "disconnected", exitCode: -1 } });
    await db.$transaction(async tx => {
      await recordModuleFailure(tx, { workspaceId: workspace.id, moduleId: module.id, activationId, hash, now, retry: false, evidence: {
        phase: "event", reason: "disconnected", triggerId: "daily", runId: run.id, delivery: "lost", pid: null, exitCode: -1, signal: null, stderr: "",
      } });
    });
    await pauseFailedModule(ports, { workspaceId: workspace.id, moduleId: module.id, hash, activationId, triggerId: "daily", firedAt: now }, run.id);
  };
  const audit = (kind: string) => db.audit.findFirstOrThrow({ where: { workspaceId: workspace.id, subjectId: module.id, kind }, orderBy: { createdAt: "desc" } });
  return { db, workspace, module, ports, context, schedule, status, failure, audit, advance: () => { now = new Date(now.getTime() + 86400_000); } };
}

test("three failures pause the module, preserving timers and incident evidence", async () => {
  const f = await fixture(), timer = await f.schedule(), paused = await f.schedule("paused");
  await f.failure(); await f.failure();
  expect((await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).status).toBe("active");
  expect(await f.db.audit.count({ where: { kind: "module_disabled" } })).toBe(0);
  await f.failure();
  expect((await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).status).toBe("paused");
  const incident = await f.audit("module_runtime_incident");
  const details = (await f.audit("module_disabled")).details as { source: string; reason: string; schedules: string[]; incidentId: string };
  expect(details).toMatchObject({ source: "automatic", reason: "连续三次失败", incidentId: (incident.details as { id: string }).id });
  expect(await f.db.timer.findMany()).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: timer.id, status: "active" }),
    expect.objectContaining({ id: paused.id, status: "paused", nextAt: null }),
  ]));
  expect(await notices(f.db, { kind: "module-paused" })).toHaveLength(1);
  await f.status("active");
  expect(await f.db.timer.count({ where: { status: "active" } } )).toBe(1);
  expect((await f.audit("module_enabled")).details).toEqual({ source: "owner" });
});

test.each(["owner", "cli", "chrona"])("%s pause/resume is idempotent and preserves timer state", async source => {
  const f = await fixture(), timer = await f.schedule();
  const pause = () => source === "chrona" ? requestStatus(f.context, f.module.id, "paused", "maintenance") : f.status("paused", source, "maintenance");
  await pause(); await pause();
  expect(await f.db.audit.count({ where: { kind: "module_disabled" } })).toBe(1);
  expect((await f.audit("module_disabled")).details).toEqual({ source, reason: "maintenance" });
  await f.status("active", source); await f.status("active", source);
  await pause(); await f.status("active", source);
  // A fixed clock exercises same-millisecond transition ordering.
  expect(await f.db.audit.count({ where: { kind: "module_enabled" } })).toBe(2);
  expect((await f.audit("module_disabled")).details).toEqual({ source, reason: "maintenance" });
  expect(await f.db.timer.findUniqueOrThrow({ where: { id: timer.id } })).toEqual(timer);
});

test("three failures from a stale version cannot pause the current module or cancel its work", async () => {
  const f = await fixture(), timer = await f.schedule();
  await f.db.module.update({ where: { id: f.module.id }, data: { activeHash: "v2" } });
  await f.failure("v1"); await f.failure("v1"); await f.failure("v1");
  expect(await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).toMatchObject({ activeHash: "v2", status: "active" });
  expect(await f.db.timer.findUniqueOrThrow({ where: { id: timer.id } })).toMatchObject({ status: "active" });
  expect(await f.db.audit.count({ where: { kind: "module_disabled" } })).toBe(0);
  expect(await f.db.moduleInvocation.count()).toBe(0);
});

test("resume does not interpret old pause audit or calculate missed calendar occurrences", async () => {
  const f = await fixture(), timer = await f.schedule("paused");
  await f.db.audit.create({ data: { workspaceId: f.workspace.id, subjectId: f.module.id, actorKey: "chrona", kind: "module_disabled", details: { source: "automatic", schedules: [timer.id] } } });
  await f.db.module.update({ where: { id: f.module.id }, data: { status: "paused" } });
  f.advance(); await f.status("active");
  expect((await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).status).toBe("active");
  expect(await f.db.timer.findUniqueOrThrow({ where: { id: timer.id } })).toEqual(timer);
  expect((await f.audit("module_enabled")).details).toEqual({ source: "owner" });
  expect(await f.db.moduleInvocation.count()).toBe(0);
});
