import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { Prisma } from "@chrona/db/generated/prisma/client";
import { listenPaths, moduleManifestSchema } from "@chrona/contracts/steward";
import { redactSensitiveText } from "@chrona/logging/redaction";
import { audit } from "../audit";
import { latestModuleEvolution, recordModuleActivation, updateModuleEvolution } from "./module-evolution";
import { StewardError } from "../errors";
import type { ModuleContext } from "./module-context";
import { assertExternalModule, assertModuleOperation } from "./module-identity";
import { pauseIn } from "./module-status";
import { fenceAgentModuleIn, abortDrainedAgentRuns } from "../agent/module-drain";
import { assertExecutionModuleIdle } from "../execution/execution-module-guard";
import { ensureVersionMaterial } from "./module-source";

export async function activateIn(context: ModuleContext, tx: Prisma.TransactionClient, { moduleId, hash, reason, dataHandling }: { moduleId: string; hash: string; reason: "activate" | "rollback"; dataHandling?: string }) {
  const { activeHash: previousHash } = await switchActiveIn(context, tx, moduleId, hash, { preservePause: reason === "activate", operation: reason });
  const previousOutcome = reason === "rollback" && previousHash ? await latestModuleEvolution(tx, context.workspaceId, moduleId, previousHash) : null;
  if (previousOutcome && previousHash) await updateModuleEvolution(tx, { workspaceId: context.workspaceId, moduleId, activationId: previousOutcome.activationId, hash: previousHash, status: "rolled-back", expectedCurrentHash: hash, ...(dataHandling ? { dataHandling } : {}), nextAction: `代码已切回 ${hash.slice(0, 12)}；${dataHandling ?? "本次恢复未恢复旧数据快照。"}`, now: context.ports.now() });
  const activation = await recordModuleActivation(context, tx, {
    moduleId, previousHash, hash,
    dataHandling: dataHandling ?? (reason === "rollback" ? `恢复到已批准版本 ${hash.slice(0, 12)}；本次未恢复旧数据快照。` : undefined),
    ...(reason === "rollback" ? { rollback: { attempted: false, result: "blocked", reason: "恢复目标不会自动继续回滚，避免版本来回切换。" } } as const : {}),
  });
  await audit(tx, { workspaceId: context.workspaceId, actor: "chrona", kind: `module_${reason}`, subjectId: moduleId, details: { hash, previousHash, activationId: activation.activationId } });
  return activation;
}
async function assertListenAvailable(tx: Prisma.TransactionClient, moduleId: string, manifest: ReturnType<typeof moduleManifestSchema.parse>) {
  if (!manifest.listen) return;
  for (const other of await tx.module.findMany({ where: { id: { not: moduleId }, status: "active", activeHash: { not: null } } })) {
    const active = await tx.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: other.id, hash: other.activeHash! } } });
    const taken = active ? listenPaths(moduleManifestSchema.parse(active.manifest)).find(path => listenPaths(manifest).includes(path)) : undefined;
    if (taken) throw new StewardError("conflict", `${taken} is served by module ${other.name}`);
  }
}
/** Switches an approved version and returns the pre-switch row for activation history. */
export async function switchActiveIn(context: ModuleContext, tx: Prisma.TransactionClient, moduleId: string, hash: string, { preservePause = true, operation = "activate" }: { preservePause?: boolean; operation?: "activate" | "rollback" } = {}) {
  const { workspaceId } = context;
  const module = await assertExternalModule(tx, workspaceId, moduleId, operation);
  if (module.activeHash !== hash) await assertExecutionModuleIdle(tx, moduleId);
  const version = await tx.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId, hash } } });
  if (!version || version.status !== "approved") throw new StewardError("conflict", "Module version is not approved");
  const manifest = moduleManifestSchema.parse(version.manifest);
  await assertListenAvailable(tx, moduleId, manifest);
  await ensureVersionMaterial(context, version);
  await tx.module.update({ where: { id: moduleId }, data: { activeHash: hash, status: "active", ...(module.activeHash !== hash ? { activationId: randomUUID(), executionFenceAt: null } : {}) } });
  if (preservePause && module.status === "paused") await pauseIn(context, tx, moduleId, { source: "chrona", reason: "版本切换保留原停用状态" });
  return module;
}
type AutomaticRollbackInput = { tx: Prisma.TransactionClient; workspaceId: string; moduleId: string; hash: string; previousHash: string; moduleSchema: number; current: NonNullable<Awaited<ReturnType<typeof latestModuleEvolution>>> };
function automaticRollbackDataError(candidate: ReturnType<typeof moduleManifestSchema.parse>, previous: ReturnType<typeof moduleManifestSchema.parse>, moduleSchema: number, current: AutomaticRollbackInput["current"]) {
  const migrated = current.checks.continuity && typeof current.checks.continuity === "object" && "migrated" in current.checks.continuity && current.checks.continuity.migrated === true;
  return candidate.data.schema !== previous.data.schema || candidate.data.schema !== moduleSchema || migrated ? "Data schema changed or migration was recorded; automatic code rollback is unsafe." : null;
}
async function automaticRollbackVersionError(input: AutomaticRollbackInput) {
  const { tx, moduleId, hash, previousHash, moduleSchema, current } = input;
  const [candidateRow, previousRow] = await Promise.all([
    tx.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId, hash } } }),
    tx.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId, hash: previousHash } } }),
  ]);
  if (!candidateRow || candidateRow.status !== "approved" || !previousRow || previousRow.status !== "approved") return "Candidate or rollback target is not an approved version.";
  const candidate = moduleManifestSchema.safeParse(candidateRow.manifest).data, previous = moduleManifestSchema.safeParse(previousRow.manifest).data;
  if (!candidate || !previous) return "Candidate or rollback target manifest is invalid.";
  return automaticRollbackDataError(candidate, previous, moduleSchema, current);
}
async function automaticRollbackMigrationError(tx: Prisma.TransactionClient, workspaceId: string, moduleId: string, hash: string) {
  const migration = await tx.moduleMigration.findFirst({ where: { moduleId, module: { workspaceId } }, select: { hash: true } });
  return migration?.hash === hash ? "This activation used migration or restore." : null;
}
async function automaticRollbackEligibility(input: AutomaticRollbackInput) {
  const { tx, workspaceId, moduleId, hash } = input;
  const versionError = await automaticRollbackVersionError(input);
  if (versionError) return versionError;
  const migrationError = await automaticRollbackMigrationError(tx, workspaceId, moduleId, hash);
  if (migrationError) return migrationError;
  return null;
}
async function automaticRollbackTarget(tx: Prisma.TransactionClient, context: ModuleContext, moduleId: string, hash: string, current: NonNullable<Awaited<ReturnType<typeof latestModuleEvolution>>>) {
  if (current.observedCapabilities.length) return { reason: "A successful capability was already verified." };
  const module = await tx.module.findFirst({ where: { id: moduleId, workspaceId: context.workspaceId } });
  if (!module || module.status !== "active" || module.activeHash !== hash) return { reason: "Module is paused, migrating, removed, or its active hash changed." };
  assertModuleOperation(module, "rollback");
  if (!current.previousHash) return { reason: "No previously approved version exists for a first installation." };
  return { moduleSchema: module.dataSchema, previousHash: current.previousHash };
}
/** Only a process start failure before any event can qualify; all switch checks and the version change share one transaction. */
export async function rollbackFailedStart(context: ModuleContext, moduleId: string, hash: string, activationId: string) {
  const { workspaceId, ports } = context, now = ports.now();
  // Commit the exact eligible activation's fence before attempting a switch that may need to drain.
  const drained = await ports.db.$transaction(async tx => {
    await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${workspaceId}`;
    const current = await latestModuleEvolution(tx, workspaceId, moduleId, hash);
    if (!current || current.activationId !== activationId || current.status !== "failed" || current.rollback.attempted || current.rollback.reason?.startsWith("恢复目标不会自动继续回滚")) return;
    const target = await automaticRollbackTarget(tx, context, moduleId, hash, current);
    if (target.reason) return;
    if (await automaticRollbackEligibility({ tx, workspaceId, moduleId, hash, previousHash: target.previousHash!, moduleSchema: target.moduleSchema!, current })) return;
    return fenceAgentModuleIn(ports, tx, workspaceId, moduleId);
  });
  if (drained) await abortDrainedAgentRuns(ports, workspaceId, drained.runIds);
  return ports.db.$transaction(async tx => {
    const current = await latestModuleEvolution(tx, workspaceId, moduleId, hash);
    const deny = async (reason: string) => {
      if (current?.activationId === activationId) await updateModuleEvolution(tx, { workspaceId, moduleId, activationId, hash, now, rollback: { attempted: false, result: "blocked", reason } });
      return { rolledBack: false, reason };
    };
    if (!current || current.activationId !== activationId) return { rolledBack: false, reason: "Activation changed or no current failure record." };
    if (current.status !== "failed") return deny("No current unverified start failure permits automatic rollback.");
    if (current.rollback.attempted) return { rolledBack: false, reason: current.rollback.reason ?? "Rollback was already attempted." };
    if (current.rollback.reason?.startsWith("恢复目标不会自动继续回滚")) return { rolledBack: false, reason: current.rollback.reason };
    const target = await automaticRollbackTarget(tx, context, moduleId, hash, current);
    if (target.reason) return deny(target.reason);
    const previousHash = target.previousHash!, moduleSchema = target.moduleSchema!;
    const eligibilityError = await automaticRollbackEligibility({ tx, workspaceId, moduleId, hash, previousHash, moduleSchema, current });
    if (eligibilityError) return deny(eligibilityError);
    const attempted = await updateModuleEvolution(tx, { workspaceId, moduleId, activationId, hash, now, rollback: { attempted: true, result: "blocked", reason: "A single automatic rollback attempt is in progress." } });
    if (!attempted) return { rolledBack: false, reason: "Activation changed before rollback." };
    await switchActiveIn(context, tx, moduleId, previousHash);
    await updateModuleEvolution(tx, { workspaceId, moduleId, activationId, hash, status: "rolled-back", expectedCurrentHash: previousHash, now,
      rollback: { attempted: true, result: "succeeded", reason: `Restored approved code ${previousHash.slice(0, 12)}; data and delivery evidence were preserved.` },
      dataHandling: "仅切换到已批准旧代码；未改动当前数据或投递记录，未重放外部效果。",
      nextAction: `已恢复旧代码 ${previousHash.slice(0, 12)}。已保留当前数据与投递记录；外部已产生效果不会撤销或重放。` });
    const restored = await recordModuleActivation(context, tx, { moduleId, previousHash: hash, hash: previousHash,
      dataHandling: "自动恢复到已批准旧代码；当前数据与投递记录保留，未重放外部效果。",
      rollback: { attempted: false, result: "blocked", reason: "恢复目标不会自动继续回滚，避免版本来回切换。" } });
    await audit(tx, { workspaceId, actor: "chrona", kind: "module_rollback", subjectId: moduleId, details: { hash: previousHash, failedHash: hash, activationId, restoredActivationId: restored.activationId, automatic: true } });
    return { rolledBack: true, reason: "Automatic code rollback succeeded; current data and delivery evidence were preserved." };
  }).catch(async error => {
    const reason = `Rollback attempt failed without changing data: ${redactSensitiveText(String(error), 300)}`;
    console.error(JSON.stringify({ component: "module-generation", event: "rollback.failed", moduleId, activationId, error: reason }));
    try {
      await ports.db.$transaction(tx => updateModuleEvolution(tx, { workspaceId, moduleId, activationId, hash, status: "failed", now: ports.now(), rollback: { attempted: true, result: "blocked", reason }, nextAction: "自动代码切换失败；候选版本仍为当前版本，请人工检查诊断并恢复。" }));
    } catch (recordError) {
      console.error(JSON.stringify({ component: "module-generation", event: "rollback.failure_record_failed", moduleId, activationId, error: redactSensitiveText(String(recordError), 300) }));
    }
    return { rolledBack: false, reason };
  });
}

export async function startMigration(context: ModuleContext, tx: Prisma.TransactionClient, moduleId: string, hash: string, schema: { from: number | null; to: number }) {
  const { from, to } = schema;
  const module = await assertExternalModule(tx, context.workspaceId, moduleId, "activate");
  await assertExecutionModuleIdle(tx, moduleId);
  // A module that is not migrating cannot own the old directory yet: any directory left there is from an
  // earlier, committed migration. recoverMigrations would otherwise restore it over current data.
  if (module.status !== "migrating") {
    await rm(join(context.platform, "data-old", moduleId), { recursive: true, force: true });
  }
  await tx.module.update({ where: { id: moduleId }, data: { status: "migrating" } });
  const previous = await tx.moduleMigration.findUnique({ where: { moduleId } });
  const createdAt = new Date(Math.max(context.ports.now().getTime(), previous ? previous.createdAt.getTime() + 1 : 0));
  const admission = { hash, fromSchema: from, toSchema: to, previousStatus: module.status, createdAt };
  await tx.moduleMigration.upsert({ where: { moduleId }, create: { moduleId, ...admission }, update: admission });
  await tx.audit.create({ data: { workspaceId: context.workspaceId, actorKey: "chrona", kind: "module_migration_started", subjectId: moduleId, details: { hash, from, to, previousStatus: module.status }, createdAt } });
}
