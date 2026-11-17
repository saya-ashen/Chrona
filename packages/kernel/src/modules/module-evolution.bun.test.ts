import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { storeTestModuleMaterial } from "../__testing__/module-release-test-fixture";
import { testDb } from "../__testing__/test-db";
import { moduleContext } from "./module-context";
import { moduleEvolutionOutcomes, recordModuleActivation, updateModuleEvolution } from "./module-evolution";
import { moduleIncidents, recordModuleFailure, recordModuleOutputMismatch, recordModuleRecovery } from "./module-diagnostics";
import { rollbackFailedStart } from "./module-generation";
import { moduleManifestSchema } from "@chrona/contracts/steward";

const closes: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of closes.splice(0).reverse()) await close(); });

async function rollbackFixture(options: { paused?: boolean; migrating?: boolean; migration?: boolean; migrated?: boolean; verified?: boolean; firstInstall?: boolean; dataSchema?: number; manifestSchema?: number; previousSchema?: number; entry?: boolean; secret?: boolean; effect?: "network"; recordedDelivery?: boolean; targetStatus?: "approved" | "pending_review" | "rejected" } = {}) {
  const db = testDb(), dataDir = await mkdtemp("/tmp/chrona-evolution-"); closes.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const workspace = await db.workspace.create({ data: { name: "auto rollback" } });
  const module = await db.module.create({ data: { workspaceId: workspace.id, name: "app", activeHash: "candidate", status: options.paused ? "paused" : options.migrating ? "migrating" : "active", dataSchema: options.dataSchema ?? 1 } });
  const manifest = moduleManifestSchema.parse({ name: "app", entry: "index.ts", keepAlive: true, tests: ["test.ts"],
    listen: options.entry ? "/api/app" : undefined, effects: options.effect ? [options.effect] : [], secrets: options.secret ? ["demo_credential"] : [], data: { schema: options.manifestSchema ?? 1 } });
  const previousHash = await storeTestModuleMaterial(join(dataDir, "platform"), { ...manifest, data: { schema: options.previousSchema ?? options.manifestSchema ?? 1 } }, "previous");
  if (!options.firstInstall) await db.moduleVersion.create({ data: { moduleId: module.id, hash: previousHash, manifest: { ...manifest, data: { schema: options.previousSchema ?? options.manifestSchema ?? 1 } }, source: "user", status: options.targetStatus ?? "approved", intent: {}, report: {} } });
  await db.moduleVersion.create({ data: { moduleId: module.id, hash: "candidate", manifest, source: "user", status: "approved", intent: { changes: ["safe fix"] }, report: { tests: [], continuity: { status: "passed", fromSchema: 1, toSchema: 1, migrated: options.migrated ?? false } } } });
  const ports = { db, dataDir, publicUrl: null, now: () => new Date("2026-10-30T12:00:00Z") };
  const context = moduleContext(ports, workspace.id);
  const activation = await db.$transaction(tx => recordModuleActivation(context, tx, { moduleId: module.id, previousHash: options.firstInstall ? null : previousHash, hash: "candidate" }));
  await updateModuleEvolution(db, { workspaceId: workspace.id, moduleId: module.id, activationId: activation.activationId, hash: "candidate", status: "failed", now: ports.now() });
  if (options.verified) await updateModuleEvolution(db, { workspaceId: workspace.id, moduleId: module.id, activationId: activation.activationId, hash: "candidate", capability: "tool:read", now: ports.now() });
  if (options.migration) await db.moduleMigration.create({ data: { moduleId: module.id, hash: "candidate", fromSchema: 1, toSchema: 1, previousStatus: "active", createdAt: ports.now() } });
  if (options.recordedDelivery) {
    const timer = await db.timer.create({ data: { workspaceId: workspace.id, moduleId: module.id, rule: {}, timerId: "Recorded delivery", status: "done" } });
    await db.moduleInvocation.create({ data: { workspaceId: workspace.id, caller: "system:timers", target: module.name, tool: "deliver", mode: "timer", key: `${timer.id}:recorded`, args: { timerId: timer.id }, status: "unknown", error: "Delivery interrupted; outcome unknown" } });
  }
  const attempt = () => rollbackFailedStart(context, module.id, "candidate", activation.activationId);
  return { db, workspace, module, context, manifest, activation, attempt, dataDir, previousHash };
}

test("activation outcome is tied to the active candidate and successful capability verification is idempotent", async () => {
  const db = testDb(); closes.push(() => db.$disconnect());
  const workspace = await db.workspace.create({ data: { name: "evolution" } });
  const module = await db.module.create({ data: { workspaceId: workspace.id, name: "example", activeHash: "candidate", dataSchema: 2 } });
  const manifest = { name: "example", entry: "index.ts", keepAlive: true, tests: ["test.ts"], effects: [], uses: [], data: { schema: 2 } };
  await db.moduleVersion.create({ data: { moduleId: module.id, hash: "old", manifest, source: "user", status: "approved", intent: {}, report: {} } });
  await db.moduleVersion.create({ data: { moduleId: module.id, hash: "candidate", manifest, source: "user", status: "approved", intent: { changes: ["repair search"], preserves: [] }, report: { tests: [], continuity: { status: "skipped" } } } });
  const context = moduleContext({ db, dataDir: "/tmp/not-used", publicUrl: null, now: () => new Date("2026-10-25T14:00:00Z") }, workspace.id);
  const outcome = await db.$transaction(tx => recordModuleActivation(context, tx, { moduleId: module.id, previousHash: "old", hash: "candidate" }));
  expect(outcome).toMatchObject({ previousHash: "old", candidateHash: "candidate", status: "awaiting-verification", changes: ["repair search"], observedCapabilities: [], dataHandling: expect.stringContaining("保留当前数据") });
  const now = new Date("2026-10-25T14:01:00Z");
  await recordModuleOutputMismatch(db, { workspaceId: workspace.id, moduleId: module.id, activationId: outcome.activationId, hash: "candidate", tool: "read", callId: "call-1", issues: ["$.value required"], now });
  expect((await moduleEvolutionOutcomes(db, workspace.id, module.id))[0]).toMatchObject({ status: "failed" });
  expect(await db.audit.count({ where: { kind: "module_runtime_incident" } })).toBe(0);
  await updateModuleEvolution(db, { workspaceId: workspace.id, moduleId: module.id, activationId: outcome.activationId, hash: "candidate", capability: "tool:read", now: new Date(now.getTime() + 1) });
  const afterFirstSuccess = await moduleEvolutionOutcomes(db, workspace.id, module.id);
  await updateModuleEvolution(db, { workspaceId: workspace.id, moduleId: module.id, activationId: outcome.activationId, hash: "candidate", capability: "tool:read", now: new Date(now.getTime() + 2) });
  expect(await moduleEvolutionOutcomes(db, workspace.id, module.id)).toEqual(afterFirstSuccess);
  expect(await db.audit.count({ where: { kind: "module_evolution_outcome" } })).toBe(0);
  expect((await moduleEvolutionOutcomes(db, workspace.id, module.id))[0]).toMatchObject({ status: "verified", observedCapabilities: ["tool:read"], nextAction: expect.stringContaining("其他工具尚未") });
  expect(await db.module.findUniqueOrThrow({ where: { id: module.id } })).toMatchObject({ activeHash: "candidate", dataSchema: 2 });
});

test("stale failure and recovery callbacks cannot change same-hash activation diagnostics", async () => {
  const f = await rollbackFixture();
  const current = await f.db.$transaction(tx => recordModuleActivation(f.context, tx, { moduleId: f.module.id, previousHash: "candidate", hash: "candidate" }));
  const evidence = { phase: "event" as const, reason: "late failure", runId: null, triggerId: "tool:read", delivery: "handler" as const, pid: 1, exitCode: 1, signal: null, stderr: "" };
  expect(await recordModuleFailure(f.db, { workspaceId: f.workspace.id, moduleId: f.module.id, activationId: f.activation.activationId, hash: "candidate", now: f.context.ports.now(), retry: false, evidence })).toBeNull();
  await recordModuleRecovery(f.context.ports, { workspaceId: f.workspace.id, moduleId: f.module.id, hash: "candidate", activationId: f.activation.activationId, triggerId: "tool:read" });
  expect(await moduleIncidents(f.db, f.workspace.id, f.module.id)).toEqual([]);
  expect((await moduleEvolutionOutcomes(f.db, f.workspace.id, f.module.id))[0]).toMatchObject({ activationId: current.activationId, status: "awaiting-verification", observedCapabilities: [] });
});

test("a same-hash activation cannot interleave between mismatch epoch check and audit append", async () => {
  const f = await rollbackFixture();
  let queryReached!: () => void, continueQuery!: () => void;
  const reached = new Promise<void>(resolve => { queryReached = resolve; });
  const continuation = new Promise<void>(resolve => { continueQuery = resolve; });
  const interceptAudit = (delegate: object) => new Proxy(delegate, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property !== "findFirst") return typeof value === "function" ? value.bind(target) : value;
      return async (...args: unknown[]) => {
        const rows = await value.apply(target, args);
        if ((args[0] as { where?: { candidateHash?: string } })?.where?.candidateHash === "candidate") {
          queryReached();
          await continuation;
        }
        return rows;
      };
    },
  });
  const interceptDb = (client: typeof f.db) => new Proxy(client, {
    get(target, property, receiver) {
      if (property === "moduleActivation") return interceptAudit(Reflect.get(target, property, receiver));
      const value = Reflect.get(target, property, receiver);
      if (property !== "$transaction") return typeof value === "function" ? value.bind(target) : value;
      return (callback: (tx: unknown) => unknown) => value.call(target, (tx: object) => callback(new Proxy(tx, {
        get(transaction, key, txReceiver) { return key === "moduleActivation" ? interceptAudit(Reflect.get(transaction, key, txReceiver)) : Reflect.get(transaction, key, txReceiver); },
      })));
    },
  });
  const raceDb = interceptDb(f.db);
  const mismatch = recordModuleOutputMismatch(raceDb, { workspaceId: f.workspace.id, moduleId: f.module.id, activationId: f.activation.activationId,
    hash: "candidate", tool: "read", callId: "late-mismatch", issues: ["$.value required"], now: f.context.ports.now() });
  await reached;
  let activationFinished = false;
  const reactivation = f.db.$transaction(tx => recordModuleActivation(f.context, tx, { moduleId: f.module.id, previousHash: "candidate", hash: "candidate" }))
    .then(outcome => { activationFinished = true; return outcome; });
  await Bun.sleep(25);
  expect(activationFinished).toBe(false);
  continueQuery();
  await mismatch;
  const current = await reactivation;
  expect(current.activationId).not.toBe(f.activation.activationId);
  expect((await moduleEvolutionOutcomes(f.db, f.workspace.id, f.module.id))[0]).toMatchObject({ activationId: current.activationId, status: "awaiting-verification" });
  expect(await f.db.audit.count({ where: { kind: "module_output_mismatch", subjectId: f.module.id } })).toBe(1);
});

test.each([
  ["first install", { firstInstall: true }], ["paused", { paused: true }], ["migrating", { migrating: true }],
  ["migration or restore", { migration: true }], ["schema mismatch", { manifestSchema: 2, previousSchema: 1, dataSchema: 2 }],
  ["migration marker", { migrated: true }],
  ["unapproved target", { targetStatus: "pending_review" as const }], ["successful verification", { verified: true }],
] as const)("automatic rollback stays blocked for %s", async (_label, options) => {
  const f = await rollbackFixture(options), result = await f.attempt();
  expect(result.rolledBack).toBe(false);
  expect((await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).activeHash).toBe("candidate");
  expect((await moduleEvolutionOutcomes(f.db, f.workspace.id, f.module.id))[0]!.rollback).toMatchObject({ attempted: false, result: "blocked" });
});

test.each([
  ["ordinary module", {}], ["entry module", { entry: true }], ["credential module", { secret: true }], ["network module", { effect: "network" }],
] as const)("start failure automatically rolls back %s without a grant", async (_label, options) => {
  const f = await rollbackFixture(options);
  expect(await f.attempt()).toMatchObject({ rolledBack: true });
  expect((await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).activeHash).toBe(f.previousHash);
});

test("rollback requires the current active hash and activation identity", async () => {
  const changed = await rollbackFixture();
  await changed.db.module.update({ where: { id: changed.module.id }, data: { activeHash: "someone-else" } });
  expect((await changed.attempt()).rolledBack).toBe(false);
  const aba = await rollbackFixture();
  const newEpoch = await aba.db.$transaction(tx => recordModuleActivation(aba.context, tx, { moduleId: aba.module.id, previousHash: "candidate", hash: "candidate" }));
  expect(newEpoch.activationId).not.toBe(aba.activation.activationId);
  expect((await aba.attempt()).rolledBack).toBe(false);
  expect((await moduleEvolutionOutcomes(aba.db, aba.workspace.id, aba.module.id))[0]!.activationId).toBe(newEpoch.activationId);
});

test("removed module cannot be switched by a stale rollback callback", async () => {
  const f = await rollbackFixture();
  await f.db.module.delete({ where: { id: f.module.id } });
  expect(await f.attempt()).toMatchObject({ rolledBack: false });
  expect(await f.db.module.findUnique({ where: { id: f.module.id } })).toBeNull();
});

test.each([false, true])("rollback failure remains diagnosable when failure recording also fails: %s", async recordFails => {
  const f = await rollbackFixture();
  let transactions = 0;
  const db = new Proxy(f.db, { get(target, property, receiver) {
    if (property === "$transaction") return (...args: Parameters<typeof target.$transaction>) => {
      transactions++;
      if (transactions === 2) return Promise.reject(new Error("switch failed Bearer synthetic-private-value"));
      if (transactions === 3 && recordFails) return Promise.reject(new Error("record failed Bearer synthetic-record-value"));
      return Reflect.apply(target.$transaction, target, args);
    };
    const value = Reflect.get(target, property, receiver);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const logged: string[] = [], logger = spyOn(console, "error").mockImplementation(line => { logged.push(String(line)); });
  try {
    const context = moduleContext({ ...f.context.ports, db }, f.workspace.id);
    const result = await rollbackFailedStart(context, f.module.id, "candidate", f.activation.activationId);
    expect(result).toMatchObject({ rolledBack: false, reason: expect.stringContaining("switch failed") });
    expect(result.reason).not.toContain("synthetic-private-value");
    const records = logged.map(line => JSON.parse(line));
    expect(records).toContainEqual(expect.objectContaining({ component: "module-generation", event: "rollback.failed", moduleId: f.module.id, activationId: f.activation.activationId, error: expect.stringContaining("switch failed") }));
    if (recordFails) expect(records).toContainEqual(expect.objectContaining({ event: "rollback.failure_record_failed", error: expect.stringContaining("record failed") }));
    else expect((await moduleEvolutionOutcomes(f.db, f.workspace.id, f.module.id))[0]).toMatchObject({ status: "failed", rollback: { attempted: true, reason: result.reason } });
    expect(logged.join("\n")).not.toContain("synthetic-private-value");
    expect(logged.join("\n")).not.toContain("synthetic-record-value");
    expect(await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).toMatchObject({ activeHash: "candidate" });
  } finally { logger.mockRestore(); }
});

test("eligible rollback preserves current data and unknown delivery evidence without replay", async () => {
  const f = await rollbackFixture({ recordedDelivery: true });
  const data = join(f.dataDir, "platform/data", f.module.id); await mkdir(data, { recursive: true }); await writeFile(join(data, "current.txt"), "current data");
  const schedule = await f.db.timer.findFirstOrThrow({ where: { moduleId: f.module.id } });
  const delivery = await f.db.moduleInvocation.findFirstOrThrow({ where: { target: f.module.name } });
  expect(await f.attempt()).toMatchObject({ rolledBack: true });
  expect(await readFile(join(data, "current.txt"), "utf8")).toBe("current data");
  expect(await f.db.timer.findMany({ where: { moduleId: f.module.id } })).toEqual([schedule]);
  expect(await f.db.moduleInvocation.findMany({ where: { target: f.module.name } })).toEqual([delivery]);
  const outcomes = await moduleEvolutionOutcomes(f.db, f.workspace.id, f.module.id);
  expect(outcomes[0]).toMatchObject({ candidateHash: f.previousHash, rollback: { attempted: false, result: "blocked" } });
  expect(outcomes[1]).toMatchObject({ candidateHash: "candidate", status: "rolled-back", rollback: { attempted: true, result: "succeeded" } });
  expect(await f.attempt()).toMatchObject({ rolledBack: false });
});
