import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { testDb } from "./test-db";
import { moduleContext } from "./module-context";
import { moduleEvolutionOutcomes, recordModuleActivation, updateModuleEvolution } from "./module-evolution";
import { moduleIncidents, recordModuleFailure, recordModuleOutputMismatch, recordModuleRecovery } from "./module-diagnostics";
import { rollbackFailedStart } from "./module-generation";
import { moduleManifestSchema } from "@chrona/contracts/steward";

const closes: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of closes.splice(0).reverse()) await close(); });

async function rollbackFixture(options: { enabled?: boolean; mode?: "auto" | "notify_after" | "preapproved" | "ask" | "never"; scope?: "module" | "global"; once?: boolean; expired?: boolean; revoked?: boolean; paused?: boolean; migrating?: boolean; group?: boolean; migration?: boolean; migrated?: boolean; verified?: boolean; firstInstall?: boolean; dataSchema?: number; manifestSchema?: number; previousSchema?: number; entry?: boolean; secret?: boolean; effect?: "network" | "notify_user" | "wake_provider"; scheduled?: boolean; previousScheduled?: boolean; dynamic?: boolean; targetStatus?: "approved" | "pending_review" | "rejected" } = {}) {
  const db = testDb(), dataDir = await mkdtemp("/tmp/chrona-evolution-"); closes.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const workspace = await db.workspace.create({ data: { name: "auto rollback" } });
  const module = await db.module.create({ data: { workspaceId: workspace.id, name: "app", activeHash: "candidate", status: options.paused ? "paused" : options.migrating ? "migrating" : "active", dataSchema: options.dataSchema ?? 1 } });
  const manifest = moduleManifestSchema.parse({ name: "app", entry: "index.ts", keepAlive: true, tests: ["test.ts"], triggers: options.scheduled ? [{ id: "daily", schedule: { kind: "daily", time: "09:00" } }] : [],
    listen: options.entry ? "/api/app" : undefined, effects: options.effect ? [options.effect] : [], uses: options.dynamic ? ["schedules.create"] : [], secrets: options.secret ? ["demo_credential"] : [], data: { schema: options.manifestSchema ?? 1 } });
  if (!options.firstInstall) await db.moduleVersion.create({ data: { moduleId: module.id, hash: "previous", manifest: { ...manifest, triggers: options.previousScheduled ? [{ id: "daily", schedule: { kind: "daily", time: "09:00" } }] : [], data: { schema: options.previousSchema ?? options.manifestSchema ?? 1 } }, source: "user", status: options.targetStatus ?? "approved", intent: {}, report: {} } });
  await db.moduleVersion.create({ data: { moduleId: module.id, hash: "candidate", manifest, source: "user", status: "approved", intent: { changes: ["safe fix"] }, report: { tests: [], continuity: { status: "passed", fromSchema: 1, toSchema: 1, migrated: options.migrated ?? false } } } });
  const ports = { db, dataDir, publicUrl: null, moduleAutoRollback: options.enabled ?? true, now: () => new Date("2026-10-30T12:00:00Z") };
  const context = moduleContext(ports, workspace.id);
  const activation = await db.$transaction(tx => recordModuleActivation(context, tx, { moduleId: module.id, previousHash: options.firstInstall ? null : "previous", hash: "candidate", generationId: "gen-candidate" }));
  await updateModuleEvolution(db, { workspaceId: workspace.id, moduleId: module.id, activationId: activation.activationId, hash: "candidate", status: "failed", now: ports.now() });
  if (options.verified) await updateModuleEvolution(db, { workspaceId: workspace.id, moduleId: module.id, activationId: activation.activationId, hash: "candidate", capability: "tool:read", now: ports.now() });
  if (options.group) {
    const approval = await db.approval.create({ data: { workspaceId: workspace.id, action: "activate_module", title: "group", detail: "", preview: "", level: "yellow", payload: { kind: "activate_modules", versions: [{ moduleId: module.id, hash: "candidate" }, { moduleId: "other", hash: "other" }] } } });
    await db.audit.create({ data: { workspaceId: workspace.id, actorKey: "chrona", subjectId: module.id, kind: "module_activate", details: { hash: "candidate", generationId: "gen-candidate", approvalId: approval.id } } });
  }
  if (options.migration) await db.audit.create({ data: { workspaceId: workspace.id, actorKey: "chrona", subjectId: module.id, kind: "module_migration_started", details: { hash: "candidate", from: 1, to: 1 } } });
  if (options.scheduled) await db.schedule.create({ data: { workspaceId: workspace.id, moduleId: module.id, triggerId: "daily", mode: "module", rule: { kind: "daily", time: "09:00" }, text: "daily", createdBy: "chrona", nextAt: new Date("2030-01-01T00:00:00Z") } });
  if (options.scope || options.mode || options.once || options.expired || options.revoked) {
    const grant = await db.grant.create({ data: { workspaceId: workspace.id, action: "activate_module", mode: options.mode ?? "preapproved", scope: { kind: options.scope ?? "module", ...(options.scope === "global" ? {} : { moduleId: module.id }) }, once: options.once ?? false, expiresAt: options.expired ? new Date("2026-10-29T00:00:00Z") : null } });
    if (options.revoked) await db.grant.update({ where: { id: grant.id }, data: { revokedAt: new Date("2026-10-29T00:00:00Z") } });
  }
  const attempt = () => rollbackFailedStart(context, module.id, "candidate", activation.activationId);
  return { db, workspace, module, context, manifest, activation, attempt, dataDir };
}

test("activation outcome is tied to the active candidate and successful capability verification is idempotent", async () => {
  const db = testDb(); closes.push(() => db.$disconnect());
  const workspace = await db.workspace.create({ data: { name: "evolution" } });
  const module = await db.module.create({ data: { workspaceId: workspace.id, name: "example", activeHash: "candidate", dataSchema: 2 } });
  const manifest = { name: "example", entry: "index.ts", keepAlive: true, tests: ["test.ts"], triggers: [], effects: [], uses: [], data: { schema: 2 } };
  await db.moduleVersion.create({ data: { moduleId: module.id, hash: "old", manifest, source: "user", status: "approved", intent: {}, report: {} } });
  await db.moduleVersion.create({ data: { moduleId: module.id, hash: "candidate", manifest, source: "user", status: "approved", intent: { changes: ["repair search"], preserves: [] }, report: { tests: [{ exitCode: 0 }], typecheck: { status: "passed" }, continuity: { status: "passed" }, outputImpacts: [{ caller: "caller", targets: ["example.read"] }] } } });
  const context = moduleContext({ db, dataDir: "/tmp/not-used", publicUrl: null, now: () => new Date("2026-10-25T14:00:00Z") }, workspace.id);
  const outcome = await db.$transaction(tx => recordModuleActivation(context, tx, { moduleId: module.id, previousHash: "old", hash: "candidate", generationId: "generation-1" }));
  expect(outcome).toMatchObject({ previousHash: "old", candidateHash: "candidate", generationId: "generation-1", status: "awaiting-verification", changes: ["repair search"], affectedCallers: ["caller"], observedCapabilities: [], dataHandling: expect.stringContaining("保留当前数据") });
  const now = new Date("2026-10-25T14:01:00Z");
  await recordModuleOutputMismatch(db, { workspaceId: workspace.id, moduleId: module.id, activationId: outcome.activationId, hash: "candidate", tool: "read", callId: "call-1", issues: ["$.value required"], now });
  expect((await moduleEvolutionOutcomes(db, workspace.id, module.id))[0]).toMatchObject({ status: "failed" });
  expect(await db.audit.count({ where: { kind: "module_runtime_incident" } })).toBe(0);
  const auditCount = await db.audit.count({ where: { kind: "module_evolution_outcome" } });
  await updateModuleEvolution(db, { workspaceId: workspace.id, moduleId: module.id, activationId: outcome.activationId, hash: "candidate", capability: "tool:read", now: new Date(now.getTime() + 1) });
  const afterFirstSuccess = await db.audit.count({ where: { kind: "module_evolution_outcome" } });
  await updateModuleEvolution(db, { workspaceId: workspace.id, moduleId: module.id, activationId: outcome.activationId, hash: "candidate", capability: "tool:read", now: new Date(now.getTime() + 2) });
  expect(afterFirstSuccess).toBe(auditCount + 1);
  expect(await db.audit.count({ where: { kind: "module_evolution_outcome" } })).toBe(afterFirstSuccess);
  expect((await moduleEvolutionOutcomes(db, workspace.id, module.id))[0]).toMatchObject({ status: "verified", observedCapabilities: ["tool:read"], nextAction: expect.stringContaining("其他工具尚未") });
  expect(await db.module.findUniqueOrThrow({ where: { id: module.id } })).toMatchObject({ activeHash: "candidate", dataSchema: 2 });
});

test("stale failure and recovery callbacks cannot change same-hash activation diagnostics", async () => {
  const f = await rollbackFixture({ mode: "preapproved" });
  const current = await f.db.$transaction(tx => recordModuleActivation(f.context, tx, { moduleId: f.module.id, previousHash: "candidate", hash: "candidate", generationId: "gen-current" }));
  const evidence = { phase: "event" as const, reason: "late failure", runId: null, triggerId: "tool:read", delivery: "handler" as const, pid: 1, exitCode: 1, signal: null, stderr: "", virtualMemoryMb: null };
  expect(await recordModuleFailure(f.db, { workspaceId: f.workspace.id, moduleId: f.module.id, activationId: f.activation.activationId, hash: "candidate", now: f.context.ports.now(), retry: false, evidence })).toBeNull();
  await recordModuleRecovery(f.context.ports, { workspaceId: f.workspace.id, moduleId: f.module.id, hash: "candidate", activationId: f.activation.activationId, triggerId: "tool:read" });
  expect(await moduleIncidents(f.db, f.workspace.id, f.module.id)).toEqual([]);
  expect((await moduleEvolutionOutcomes(f.db, f.workspace.id, f.module.id))[0]).toMatchObject({ activationId: current.activationId, status: "awaiting-verification", observedCapabilities: [] });
});

test("a same-hash activation cannot interleave between mismatch epoch check and audit append", async () => {
  const f = await rollbackFixture({ mode: "preapproved" });
  let queryReached!: () => void, continueQuery!: () => void;
  const reached = new Promise<void>(resolve => { queryReached = resolve; });
  const continuation = new Promise<void>(resolve => { continueQuery = resolve; });
  const interceptAudit = (delegate: object) => new Proxy(delegate, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property !== "findMany") return typeof value === "function" ? value.bind(target) : value;
      return async (...args: unknown[]) => {
        const rows = await value.apply(target, args);
        if ((args[0] as { where?: { kind?: string } })?.where?.kind === "module_evolution_outcome") {
          queryReached();
          await continuation;
        }
        return rows;
      };
    },
  });
  const interceptDb = (client: typeof f.db) => new Proxy(client, {
    get(target, property, receiver) {
      if (property === "audit") return interceptAudit(Reflect.get(target, property, receiver));
      const value = Reflect.get(target, property, receiver);
      if (property !== "$transaction") return typeof value === "function" ? value.bind(target) : value;
      return (callback: (tx: unknown) => unknown) => value.call(target, (tx: object) => callback(new Proxy(tx, {
        get(transaction, key, txReceiver) { return key === "audit" ? interceptAudit(Reflect.get(transaction, key, txReceiver)) : Reflect.get(transaction, key, txReceiver); },
      })));
    },
  });
  const raceDb = interceptDb(f.db);
  const mismatch = recordModuleOutputMismatch(raceDb, { workspaceId: f.workspace.id, moduleId: f.module.id, activationId: f.activation.activationId,
    hash: "candidate", tool: "read", callId: "late-mismatch", issues: ["$.value required"], now: f.context.ports.now() });
  await reached;
  let activationFinished = false;
  const reactivation = f.db.$transaction(tx => recordModuleActivation(f.context, tx, { moduleId: f.module.id, previousHash: "candidate", hash: "candidate", generationId: "gen-aba-interleaving" }))
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
  ["disabled by default", { enabled: false }], ["first install", { firstInstall: true }], ["once grant", { once: true }],
  ["global grant", { scope: "global" as const }], ["expired grant", { expired: true }], ["revoked grant", { revoked: true }],
  ["ask policy", { mode: "ask" as const }], ["never policy", { mode: "never" as const }], ["paused", { paused: true }], ["migrating", { migrating: true }],
  ["group activation", { group: true }], ["migration or restore", { migration: true }], ["schema mismatch", { manifestSchema: 2, previousSchema: 1, dataSchema: 2 }],
  ["entry module", { entry: true }], ["credential module", { secret: true }], ["network effects", { effect: "network" }], ["user notification effects", { effect: "notify_user" }], ["dynamic schedule", { dynamic: true }], ["changed static schedule", { scheduled: true, previousScheduled: false }], ["migration marker", { migrated: true }],
  ["unapproved target", { targetStatus: "pending_review" as const }], ["successful verification", { verified: true }],
] as const)("automatic rollback stays blocked for %s", async (_label, options) => {
  const f = await rollbackFixture(options), result = await f.attempt();
  expect(result.rolledBack).toBe(false);
  expect((await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).activeHash).toBe("candidate");
  expect((await moduleEvolutionOutcomes(f.db, f.workspace.id, f.module.id))[0]!.rollback).toMatchObject({ attempted: false, result: "blocked" });
});

test("rollback requires a module-scoped standing allow grant and active hash/activation identity", async () => {
  for (const mode of ["auto", "notify_after", "preapproved"] as const) {
    const f = await rollbackFixture({ mode });
    expect(await f.attempt()).toMatchObject({ rolledBack: true });
    expect((await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).activeHash).toBe("previous");
  }
  const changed = await rollbackFixture({ mode: "preapproved" });
  await changed.db.module.update({ where: { id: changed.module.id }, data: { activeHash: "someone-else" } });
  expect((await changed.attempt()).rolledBack).toBe(false);
  const aba = await rollbackFixture({ mode: "preapproved" });
  const newEpoch = await aba.db.$transaction(tx => recordModuleActivation(aba.context, tx, { moduleId: aba.module.id, previousHash: "candidate", hash: "candidate", generationId: "gen-aba" }));
  expect(newEpoch.activationId).not.toBe(aba.activation.activationId);
  expect((await aba.attempt()).rolledBack).toBe(false);
  expect((await moduleEvolutionOutcomes(aba.db, aba.workspace.id, aba.module.id))[0]!.activationId).toBe(newEpoch.activationId);
});

test("removed module cannot be switched by a stale rollback callback", async () => {
  const f = await rollbackFixture({ mode: "preapproved" });
  await f.db.module.delete({ where: { id: f.module.id } });
  expect(await f.attempt()).toMatchObject({ rolledBack: false });
  expect(await f.db.module.findUnique({ where: { id: f.module.id } })).toBeNull();
});

test("eligible rollback preserves current data and existing static schedule rows without replay", async () => {
  const f = await rollbackFixture({ mode: "auto", scheduled: true, previousScheduled: true });
  const data = join(f.dataDir, "platform/data", f.module.id); await mkdir(data, { recursive: true }); await writeFile(join(data, "current.txt"), "current data");
  const schedule = await f.db.schedule.findFirstOrThrow({ where: { moduleId: f.module.id } });
  expect(await f.attempt()).toMatchObject({ rolledBack: true });
  expect(await readFile(join(data, "current.txt"), "utf8")).toBe("current data");
  expect(await f.db.schedule.findMany({ where: { moduleId: f.module.id } })).toEqual([schedule]);
  const outcomes = await moduleEvolutionOutcomes(f.db, f.workspace.id, f.module.id);
  expect(outcomes[0]).toMatchObject({ candidateHash: "previous", rollback: { attempted: false, result: "blocked" } });
  expect(outcomes[1]).toMatchObject({ candidateHash: "candidate", status: "rolled-back", rollback: { attempted: true, result: "succeeded" } });
  expect(await f.attempt()).toMatchObject({ rolledBack: false });
});
