import { afterEach, expect, test } from "bun:test";
import "./module-effects";
import { mkdtemp, rm } from "node:fs/promises";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { testDb } from "./test-db";
import { registerSystemModules } from "./system-modules";
import { callSync, kernelOrigin } from "./module-calls";
import { testModuleProcess } from "./module-test-process";
import { moduleSupervisor } from "./module-supervisor";
import { drainTimers } from "./timers";
import type { StewardPorts } from "./ports";
import type { Prisma } from "@chrona/db";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture(handler?: Parameters<typeof testModuleProcess>[0]) {
  registerSystemModules();
  const db = testDb(), dataDir = await mkdtemp("/tmp/chrona-api-");
  const workspace = await db.workspace.create({ data: { name: "public API" } });
  let time = Date.parse("2026-11-10T12:00:00Z");
  const received: unknown[] = [];
  const peer = testModuleProcess(async (event, call, input) => { received.push(event.trigger); return handler ? handler(event, call, input) : { result: { ok: true } }; });
  const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => new Date(time), sandbox: { available: true, isolated: true, startModule: peer.startModule } };
  cleanup.push(async () => { await moduleSupervisor(ports).stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  async function app(name: string, authority?: "owner") {
    const row = await db.module.create({ data: { workspaceId: workspace.id, name, activeHash: `${name}-v1` } });
    const manifest = moduleManifestSchema.parse({ name, authority, uses: ["*"], keepAlive: true, entry: "index.ts", tests: ["test.ts"], effects: [], tools: [{ name: "observe", description: "Observe", visibility: ["modules", "owner"], parameters: { type: "object", properties: {} }, output: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] } }] });
    await db.moduleVersion.create({ data: { moduleId: row.id, hash: row.activeHash!, manifest, source: "user", status: "approved", intent: {}, report: {} } });
    const origin = { ...kernelOrigin(workspace.id), caller: { kind: "module" as const, module: name, moduleId: row.id, hash: row.activeHash! } };
    return { row, origin, manifest };
  }
  return { db, ports, workspace, app, received, advance: (ms: number) => { time += ms; }, owner: { ...kernelOrigin(workspace.id), caller: { kind: "owner" as const, via: null } } };
}

test("cancel confirmed before process connects prevents the unsent timer", async () => {
  const f = await fixture(), app = await f.app("cancel-before-send");
  const start = f.ports.sandbox!.startModule!;
  let cancelledBeforeSend = false;
  f.ports.sandbox!.startModule = input => {
    let child: ReturnType<typeof start> | undefined;
    const exited = (async () => {
      expect(f.received).toHaveLength(0);
      await callSync(f.ports, app.origin, "timers.cancel", { id: "check" }, { key: "cancel" });
      cancelledBeforeSend = true;
      child = start(input);
      return child.exited;
    })();
    return { pid: 1, exited, stderr: () => "", kill: () => child?.kill() };
  };
  await callSync(f.ports, app.origin, "timers.set", { id: "check", schedule: { kind: "every", milliseconds: 60_000 } }, { key: "set" });
  f.advance(60_000); await drainTimers(f.ports, f.workspace.id);
  expect(cancelledBeforeSend).toBe(true);
  expect(f.received).toHaveLength(0);
  expect((await f.db.schedule.findFirstOrThrow()).status).toBe("cancelled");
});

test("slow handlers cannot backdate another application wake admission", async () => {
  const actualTimes: string[] = [];
  const f = await fixture(async (_event, _call, input) => {
    if (input.codeDir.endsWith("first-clock-v1")) f.advance(60_000);
    else actualTimes.push(f.ports.now().toISOString());
    return { result: { ok: true } };
  }), first = await f.app("first-clock"), second = await f.app("second-clock");
  await callSync(f.ports, first.origin, "timers.set", { id: "first", schedule: { kind: "at", at: new Date(f.ports.now().getTime() + 59_000).toISOString() } }, { key: "set" });
  await callSync(f.ports, second.origin, "timers.set", { id: "second", schedule: { kind: "every", milliseconds: 60_000 } }, { key: "set" });
  f.advance(60_000); await drainTimers(f.ports, f.workspace.id); await drainTimers(f.ports, f.workspace.id);
  expect(actualTimes).toEqual(["2026-11-10T12:02:00.000Z"]);
  const ledger = await f.db.moduleInvocation.findMany({ where: { mode: "timer", targetModuleId: second.row.id } });
  expect(ledger).toHaveLength(1);
  expect(ledger[0]!.createdAt.toISOString()).toBe(actualTimes[0]!);
  f.advance(60_000); await drainTimers(f.ports, f.workspace.id);
  expect(actualTimes).toEqual(["2026-11-10T12:02:00.000Z", "2026-11-10T12:03:00.000Z"]);
});

test("restart reconciles exact successful completion without redelivery", async () => {
  const f = await fixture(), app = await f.app("recovery-clock");
  await callSync(f.ports, app.origin, "timers.set", { id: "check", schedule: { kind: "every", milliseconds: 60_000 } }, { key: "set" });
  let failSettlement = true;
  const dbWithCrash = new Proxy(f.db, { get(target, key) {
    if (key === "$transaction") return (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => target.$transaction(async tx => work(new Proxy(tx, { get(txTarget, txKey) {
      if (txKey !== "moduleInvocation") return Reflect.get(txTarget, txKey);
      return new Proxy(txTarget.moduleInvocation, { get(delegate, method) {
        if (method !== "update") return Reflect.get(delegate, method);
        return (arg: Prisma.ModuleInvocationUpdateArgs) => {
          if (failSettlement && arg.where.id?.startsWith("timer-event:") && arg.data.status === "succeeded") { failSettlement = false; throw new Error("simulated crash before timer settlement"); }
          return delegate.update(arg);
        };
      } });
    } })));
    return Reflect.get(target, key);
  } });
  const firstPorts = { ...f.ports, db: dbWithCrash };
  cleanup.push(() => moduleSupervisor(firstPorts).stop());
  f.advance(60_000);
  await expect(drainTimers(firstPorts, f.workspace.id)).rejects.toThrow("simulated crash");
  const evidence = await f.db.moduleRun.findFirstOrThrow({ where: { moduleId: app.row.id } });
  const before = await f.db.moduleInvocation.findFirstOrThrow({ where: { mode: "timer" } });
  expect(evidence.exitCode).toBe(0); expect(before.status).toBe("running");
  // Earlier attempts definitively rejected before send must not hide the later successful run.
  await f.db.moduleRun.create({ data: { moduleId: app.row.id, hash: app.row.activeHash!, triggerId: before.id, firedAt: f.ports.now(), exitCode: 1, output: { delivery: "not_sent" } } });
  // Retry the same runtime after its failed settlement, then verify restart is also harmless.
  await drainTimers(firstPorts, f.workspace.id);
  const restartedPorts = { ...f.ports, db: new Proxy(f.db, {}) };
  await drainTimers(restartedPorts, f.workspace.id);
  const after = await f.db.schedule.findFirstOrThrow({ where: { mode: "timer" } });
  expect(evidence.triggerId).toBe(before.id);
  expect(after.status).toBe("active"); expect(after.nextAt).not.toBeNull();
  expect((await f.db.moduleInvocation.findUniqueOrThrow({ where: { id: before.id } })).status).toBe("succeeded");
  expect(f.received).toHaveLength(1);
});


test("observed version drift remains stale after rollback until a fresh set", async () => {
  const f = await fixture(), app = await f.app("version-clock");
  const args = { id: "check", schedule: { kind: "every", milliseconds: 60_000 } };
  await callSync(f.ports, app.origin, "timers.set", args, { key: "set-v1" });
  await f.db.moduleVersion.create({ data: { moduleId: app.row.id, hash: "v2", manifest: app.manifest, source: "user", status: "approved", intent: {}, report: {} } });
  await f.db.module.update({ where: { id: app.row.id }, data: { activeHash: "v2" } });
  const v2Origin = { ...app.origin, caller: { ...app.origin.caller, hash: "v2" } };
  expect((await callSync(f.ports, v2Origin, "timers.list", {})).output).toMatchObject({ items: [{ status: "stale", nextAt: null }] });
  await f.db.module.update({ where: { id: app.row.id }, data: { activeHash: app.row.activeHash } });
  expect((await callSync(f.ports, app.origin, "timers.list", {})).output).toMatchObject({ items: [{ status: "stale", nextAt: null }] });
  f.advance(120_000); await drainTimers(f.ports, f.workspace.id);
  expect(f.received).toHaveLength(0);
  await callSync(f.ports, app.origin, "timers.set", args, { key: "set-again" });
  f.advance(60_000); await drainTimers(f.ports, f.workspace.id);
  expect(f.received).toHaveLength(1);
});


test("pause while connecting defers the unsent timer until the same version resumes", async () => {
  const f = await fixture(), app = await f.app("pause-clock");
  const start = f.ports.sandbox!.startModule!;
  f.ports.sandbox!.startModule = input => {
    let child: ReturnType<typeof start> | undefined;
    const exited = (async () => {
      await f.db.module.update({ where: { id: app.row.id }, data: { status: "paused" } });
      child = start(input); return child.exited;
    })();
    return { pid: 1, exited, stderr: () => "", kill: () => child?.kill() };
  };
  await callSync(f.ports, app.origin, "timers.set", { id: "check", schedule: { kind: "every", milliseconds: 60_000 } }, { key: "set" });
  f.advance(60_000); await drainTimers(f.ports, f.workspace.id);
  expect(f.received).toHaveLength(0);
  expect((await f.db.moduleRun.findFirstOrThrow()).output).toEqual({ delivery: "not_sent" });
  expect((await f.db.schedule.findFirstOrThrow()).status).toBe("active");
  await f.db.module.update({ where: { id: app.row.id }, data: { status: "active" } });
  f.ports.sandbox!.startModule = start;
  await drainTimers(f.ports, f.workspace.id);
  expect(f.received).toHaveLength(1);
});

test("connection delay records committed dispatch time before the event is sent", async () => {
  const f = await fixture(), app = await f.app("connect-clock");
  const start = f.ports.sandbox!.startModule!;
  f.ports.sandbox!.startModule = input => { f.advance(70_000); return start(input); };
  await callSync(f.ports, app.origin, "timers.set", { id: "check", schedule: { kind: "every", milliseconds: 60_000 } }, { key: "set" });
  f.advance(60_000); await drainTimers(f.ports, f.workspace.id);
  const invocation = await f.db.moduleInvocation.findFirstOrThrow({ where: { mode: "timer" } });
  expect(invocation.createdAt.toISOString()).toBe("2026-11-10T12:02:10.000Z");
  await drainTimers(f.ports, f.workspace.id);
  expect(f.received).toHaveLength(1);
});
