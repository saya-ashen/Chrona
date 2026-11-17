import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PrismaClient } from "@chrona/db/generated/prisma/client";
import { ensureSqliteDatabase } from "@chrona/db/sqlite-migrations";
import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import { AwaitUser, CallError, callStatus, callSync, enqueueCall, kernelOrigin, registerSystemModule, runDueCalls, settleWaiting, type SystemModule } from "./modules/module-calls";
import { StewardError } from "./errors";
import { settings } from "./system/settings";
import { systemModules } from "./modules/module-registry";
import type { StewardPorts } from "./ports";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function fixture(inject: (original: SystemModule["handle"]) => SystemModule["handle"]) {
  const dataDir = await mkdtemp(join(tmpdir(), "chrona-api-errors-"));
  cleanup.push(() => rm(dataDir, { recursive: true, force: true }));
  const databaseUrl = `file:${join(dataDir, "test.db")}`;
  ensureSqliteDatabase({ databaseUrl, migrationsDir: resolve(import.meta.dirname, "../../../packages/db/prisma/migrations") });
  const db = new PrismaClient({ adapter: new PrismaBunSqlite({ url: databaseUrl }) });
  cleanup.push(() => db.$disconnect());
  const workspace = await db.workspace.create({ data: { name: "error classification" } });
  const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => new Date("2026-11-11T00:00:00Z") };
  const owner = { ...kernelOrigin(workspace.id), caller: { kind: "owner" as const, via: null } };
  const previous = systemModules.get(settings.name);
  registerSystemModule({ ...settings, handle: inject(settings.handle) });
  cleanup.push(async () => { if (previous) registerSystemModule(previous); else systemModules.delete(settings.name); });
  return { db, ports, workspace, owner };
}

for (const mode of ["sync", "async"] as const) {
  test(`${mode}: committed settings write with invalid output stays unknown and is never replayed`, async () => {
    let executions = 0;
    const f = await fixture(original => async (...args) => {
      executions++;
      await original(...args);
      return { unexpected: true };
    });
    const target = "settings.update", key = "committed-invalid-output", raw = { timezone: "Asia/Tokyo" };
    let callId: string;
    if (mode === "sync") {
      await expect(callSync(f.ports, f.owner, target, raw, { key })).rejects.toMatchObject({ code: "unknown" });
      callId = (await callStatus(f.ports, f.owner, { target, key })).callId;
      await expect(callSync(f.ports, f.owner, target, raw, { key })).rejects.toMatchObject({ code: "unknown" });
    } else {
      const input = { tx: f.db, ports: f.ports, origin: f.owner, target, raw };
      const queued = await enqueueCall(input, { key });
      callId = queued.callId;
      expect(await runDueCalls(f.ports, f.workspace.id)).toBe(1);
      expect(await enqueueCall(input, { key })).toMatchObject({ callId, status: "unknown", duplicate: true });
      expect(await runDueCalls(f.ports, f.workspace.id)).toBe(0);
    }
    expect((await f.db.workspace.findUniqueOrThrow({ where: { id: f.workspace.id } })).settings).toMatchObject({ timezone: "Asia/Tokyo" });
    expect(await callStatus(f.ports, f.owner, callId)).toMatchObject({ status: "unknown", error: expect.stringContaining("output does not match") });
    expect(await callStatus(f.ports, f.owner, { target, key })).toEqual(await callStatus(f.ports, f.owner, callId));
    expect(await f.db.moduleInvocation.findUniqueOrThrow({ where: { id: callId } })).toMatchObject({
      status: "unknown", errorCode: "unknown", errorReason: null, attempts: 1,
      leaseToken: null, leaseUntil: null, finishedAt: f.ports.now(), output: null,
    });
    expect(executions).toBe(1);
  });
}

const failures = [
  { name: "explicit unknown with reason", error: new CallError("unknown", "reply lost", "timeout"), status: "unknown", code: "unknown", reason: "timeout" },
  { name: "unclassified exception", error: new Error("unexpected handler interruption"), status: "unknown", code: "unknown", reason: null },
  { name: "definitive refusal with reason", error: new CallError("conflict", "budget exhausted", "budget_exceeded"), status: "failed", code: "conflict", reason: "budget_exceeded" },
  { name: "business validation refusal", error: new StewardError("invalid", "invalid settings"), status: "failed", code: "invalid", reason: null },
];
for (const failure of failures) {
  test(`async and sync preserve the same structured classification: ${failure.name}`, async () => {
    const f = await fixture(() => async () => { throw failure.error; });
    const target = "settings.update", raw = { timezone: "UTC" };
    await expect(callSync(f.ports, f.owner, target, raw, { key: "sync" })).rejects.toMatchObject({ code: failure.code });
    const queued = await enqueueCall({ tx: f.db, ports: f.ports, origin: f.owner, target, raw }, { key: "async" });
    await runDueCalls(f.ports, f.workspace.id);
    for (const key of ["sync", "async"]) {
      const state = await callStatus(f.ports, f.owner, { target, key });
      expect(state).toMatchObject({ status: failure.status });
      expect(await f.db.moduleInvocation.findUniqueOrThrow({ where: { id: state.callId } })).toMatchObject({
        status: failure.status, errorCode: failure.code, errorReason: failure.reason, finishedAt: f.ports.now(),
      });
    }
    expect((await callStatus(f.ports, f.owner, queued.callId)).error).toBe((await callStatus(f.ports, f.owner, { target, key: "sync" })).error);
    expect(await runDueCalls(f.ports, f.workspace.id)).toBe(0);
  });
}

test("async AwaitUser remains waiting until explicitly settled", async () => {
  const f = await fixture(() => async () => { throw new AwaitUser({ approvalId: "pending" }); });
  const queued = await enqueueCall({ tx: f.db, ports: f.ports, origin: f.owner, target: "settings.update", raw: { timezone: "UTC" } }, { key: "waiting" });
  await runDueCalls(f.ports, f.workspace.id);
  expect(await f.db.moduleInvocation.findUniqueOrThrow({ where: { id: queued.callId } })).toMatchObject({
    status: "waiting", errorCode: null, errorReason: null, finishedAt: null, leaseToken: null, leaseUntil: null,
  });
  expect(await runDueCalls(f.ports, f.workspace.id)).toBe(0);
  expect((await settleWaiting(f.db, queued.callId, { approved: true }, f.ports.now())).count).toBe(1);
  expect(await callStatus(f.ports, f.owner, queued.callId)).toMatchObject({ status: "succeeded", output: { approved: true } });
});
