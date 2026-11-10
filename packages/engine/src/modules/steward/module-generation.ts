import { randomUUID } from "node:crypto";
import { Prisma } from "@chrona/db/generated/prisma/client";
import { BUILTIN_MODULE_NAMES, listenPaths, moduleManifestSchema } from "@chrona/contracts/steward";
import { audit } from "./audit";
import { latestModuleEvolution, recordModuleActivation, updateModuleEvolution } from "./module-evolution";
import { StewardError } from "./errors";
import { type ModuleContext, type ModuleVersion } from "./module-context";
import { assertExternalModule, assertModuleOperation } from "./module-identity";
import type { ModuleRelease } from "./module-release";
import { pauseIn } from "./module-status";
import { fenceExecutionModuleIn } from "./execution-delivery-controls";
import { assertExecutionModuleIdle } from "./execution-module-guard";
import { ensureVersionMaterial } from "./module-source";

export async function activateIn(context: ModuleContext, tx: Prisma.TransactionClient, { moduleId, hash, reason, dataHandling }: { moduleId: string; hash: string; reason: "activate" | "rollback"; dataHandling?: string }) {
  const { activeHash: previousHash } = await switchActiveIn(context, tx, moduleId, hash, { preservePause: reason === "activate", operation: reason });
  const previousOutcome = reason === "rollback" && previousHash ? await latestModuleEvolution(tx, context.workspaceId, moduleId, previousHash) : null;
  const generation = await recordGeneration(context, tx, reason);
  if (reason === "activate") await recordModuleActivation(context, tx, { moduleId, previousHash, hash, generationId: generation.id, ...(dataHandling ? { dataHandling } : {}) });
  else {
    if (previousOutcome && previousHash) await updateModuleEvolution(tx, { workspaceId: context.workspaceId, moduleId, activationId: previousOutcome.activationId, hash: previousHash, status: "rolled-back", expectedCurrentHash: hash, ...(dataHandling ? { dataHandling } : {}), nextAction: `代码已切回 ${hash.slice(0, 12)}；${dataHandling ?? "本次恢复未恢复旧数据快照。"}`, now: context.ports.now() });
    await recordModuleActivation(context, tx, { moduleId, previousHash, hash, generationId: generation.id, dataHandling: dataHandling ?? `恢复到已批准版本 ${hash.slice(0, 12)}；本次未恢复旧数据快照。`, rollback: { attempted: false, result: "blocked", reason: "恢复目标不会自动继续回滚，避免版本来回切换。" } });
  }
  await audit(tx, { workspaceId: context.workspaceId, actor: "chrona", kind: `module_${reason}`, subjectId: moduleId, details: { hash, generationId: generation.id } });
  return generation;
}
/** One generation for the current active hashes; a group activation (v2-15) records it once after switching all its modules. */
export async function recordGeneration(context: ModuleContext, tx: Prisma.TransactionClient, reason: "activate" | "rollback") {
  const { workspaceId } = context;
  const modules = await tx.module.findMany({ where: { workspaceId }, orderBy: { id: "asc" } });
  const previous = await tx.generation.findFirst({ where: { workspaceId }, orderBy: { seq: "desc" } });
  return tx.generation.create({ data: { workspaceId, seq: (previous?.seq ?? 0) + 1, modules: Object.fromEntries(modules.map(row => [row.id, row.activeHash])), reason, createdAt: context.ports.now() } });
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
function assertBuiltinSeedRelease(release: ModuleRelease) {
  if (release.origin !== "builtin" || !(BUILTIN_MODULE_NAMES as readonly string[]).includes(release.name) || !/^[a-f0-9]{40}$/.test(release.hash) || !release.git || release.git.commit !== release.hash) throw new StewardError("conflict", "Trusted release identity changed");
}
function assertBuiltinSeedVersion(version: ModuleVersion | null, release: ModuleRelease) {
  const report = version?.report as { git?: { commit?: unknown } } | null;
  if (version?.status !== "approved" || version.source !== "builtin" || report?.git?.commit !== release.hash || JSON.stringify(version.manifest) !== JSON.stringify(release.manifest)) throw new StewardError("conflict", "Trusted release metadata does not match");
}
async function assertAgentReleaseUpgrade(tx: Prisma.TransactionClient, module: { id: string; workspaceId: string; activeHash: string | null; dataSchema: number | null; status: string }, release: ModuleRelease, releaseUpgrade: boolean) {
  if (!releaseUpgrade || release.name !== "agent") throw new StewardError("conflict", "Trusted release activation is only allowed for the initial seed");
  if (module.dataSchema !== release.manifest.data.schema || module.status === "migrating") throw new StewardError("conflict", "Agent release requires compatible data");
  if (await tx.run.count({ where: { workspaceId: module.workspaceId, OR: [{ status: "running" }, { error: "Execution stop is unconfirmed" }] } }) || await tx.executionAttempt.count({ where: { workspaceId: module.workspaceId, stopConfirmedAt: null, run: { status: { not: "queued" } } } })) throw new StewardError("conflict", "Agent release waits for running or unconfirmed executions to stop");
  const old = await tx.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash! } } });
  if (old?.source !== "builtin" || old.status !== "approved") throw new StewardError("conflict", "Agent release requires a trusted prior version");
}
/** Internal bootstrap only: registrar resolves and exports the trusted seed before this DB transaction; never pass routed input. */
export async function activateBuiltinReleaseIn(context: ModuleContext, tx: Prisma.TransactionClient, release: ModuleRelease, releaseUpgrade = false) {
  assertBuiltinSeedRelease(release);
  const module = await tx.module.findUnique({ where: { workspaceId_name: { workspaceId: context.workspaceId, name: release.name } } });
  if (!module?.builtin) throw new StewardError("conflict", "Trusted release requires a built-in module identity");
  if (module.activeHash && module.activeHash !== release.hash) {
    await assertAgentReleaseUpgrade(tx, module, release, releaseUpgrade);
  }
  const version = await tx.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: release.hash } } });
  assertBuiltinSeedVersion(version, release);
  const previous = await tx.generation.findFirst({ where: { workspaceId: context.workspaceId }, orderBy: { seq: "desc" } });
  if (module.activeHash === release.hash && previous) return previous;
  await tx.module.update({ where: { id: module.id }, data: { activeHash: release.hash, dataSchema: release.manifest.data.schema, status: "active" } });
  if (module.status === "paused") await pauseIn(context, tx, module.id, { source: "chrona", reason: "版本切换保留原停用状态" });
  const generation = await recordGeneration(context, tx, "activate");
  await recordModuleActivation(context, tx, { moduleId: module.id, previousHash: module.activeHash, hash: release.hash, generationId: generation.id });
  return generation;
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
  return automaticRollbackDataError(candidate, previous, moduleSchema, current) ?? automaticRollbackScheduleError(candidate, previous);
}
async function automaticRollbackMigrationError(tx: Prisma.TransactionClient, workspaceId: string, moduleId: string, hash: string) {
  const migration = await tx.audit.findFirst({ where: { workspaceId, subjectId: moduleId, kind: "module_migration_started" }, orderBy: { createdAt: "desc" }, select: { details: true } });
  return migration?.details && typeof migration.details === "object" && !Array.isArray(migration.details) && migration.details.hash === hash
    ? "This activation used migration or restore." : null;
}
function automaticRollbackScheduleError(candidate: ReturnType<typeof moduleManifestSchema.parse>, previous: ReturnType<typeof moduleManifestSchema.parse>) {
  return candidate.uses.includes("schedules.create") || previous.uses.includes("schedules.create")
    ? "Removed calendar scheduler dependency; automatic rollback requires manual review." : null;
}
async function automaticRollbackGroupError(tx: Prisma.TransactionClient, workspaceId: string, moduleId: string, hash: string, generationId: string) {
  if (await tx.audit.findFirst({ where: { workspaceId, subjectId: generationId, kind: "module_group_activation" } })) return "This version was activated as a group; partial automatic rollback is disabled.";
  const activationAudit = await tx.audit.findMany({ where: { workspaceId, subjectId: moduleId, kind: "module_activate" }, orderBy: { createdAt: "desc" }, take: 20, select: { details: true } });
  const groupApproval = activationAudit.map(row => row.details).find(details => details && typeof details === "object" && !Array.isArray(details) && details.hash === hash && details.generationId === generationId && typeof details.approvalId === "string") as { approvalId: string } | undefined;
  if (!groupApproval) return null;
  const approval = await tx.approval.findUnique({ where: { id: groupApproval.approvalId }, select: { payload: true } });
  return approval?.payload && typeof approval.payload === "object" && !Array.isArray(approval.payload) && approval.payload.kind === "activate_modules"
    ? "This version was activated as a group; partial automatic rollback is disabled." : null;
}
async function automaticRollbackEligibility(input: AutomaticRollbackInput) {
  const { tx, workspaceId, moduleId, hash, current } = input;
  const versionError = await automaticRollbackVersionError(input);
  if (versionError) return versionError;
  const migrationError = await automaticRollbackMigrationError(tx, workspaceId, moduleId, hash);
  if (migrationError) return migrationError;
  const groupError = await automaticRollbackGroupError(tx, workspaceId, moduleId, hash, current.generationId);
  if (groupError) return groupError;
  return null;
}
async function automaticRollbackTarget(tx: Prisma.TransactionClient, context: ModuleContext, moduleId: string, hash: string, current: NonNullable<Awaited<ReturnType<typeof latestModuleEvolution>>>) {
  if (current.observedCapabilities.length) return { reason: "A successful capability was already verified." };
  const module = await tx.module.findFirst({ where: { id: moduleId, workspaceId: context.workspaceId } });
  if (!module || module.status !== "active" || module.activeHash !== hash) return { reason: "Module is paused, migrating, removed, or its active hash changed." };
  try { assertModuleOperation(module, "rollback"); } catch { return { reason: "Built-in or reserved modules cannot automatically switch code." }; }
  if (!current.previousHash) return { reason: "No previously approved version exists for a first installation." };
  return { moduleSchema: module.dataSchema, previousHash: current.previousHash };
}
/** Only a process start failure before any event can qualify; all switch checks and the version change share one transaction. */
export async function rollbackFailedStart(context: ModuleContext, moduleId: string, hash: string, activationId: string) {
  const { workspaceId, ports } = context, now = ports.now();
  // Commit the exact eligible activation's fence before attempting a switch that may need to drain.
  await ports.db.$transaction(async tx => {
    await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${workspaceId}`;
    const current = await latestModuleEvolution(tx, workspaceId, moduleId, hash);
    if (!current || current.activationId !== activationId || current.status !== "failed" || current.rollback.attempted || current.rollback.reason?.startsWith("恢复目标不会自动继续回滚")) return;
    const target = await automaticRollbackTarget(tx, context, moduleId, hash, current);
    if (target.reason) return;
    if (await automaticRollbackEligibility({ tx, workspaceId, moduleId, hash, previousHash: target.previousHash!, moduleSchema: target.moduleSchema!, current })) return;
    await fenceExecutionModuleIn(ports, tx, workspaceId, moduleId);
  });
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
    const generation = await recordGeneration(context, tx, "rollback");
    await updateModuleEvolution(tx, { workspaceId, moduleId, activationId, hash, status: "rolled-back", expectedCurrentHash: previousHash, now,
      rollback: { attempted: true, result: "succeeded", reason: `Restored approved code ${previousHash.slice(0, 12)}; data and delivery evidence were preserved.` },
      dataHandling: "仅切换到已批准旧代码；未改动当前数据或投递记录，未重放外部效果。",
      nextAction: `已恢复旧代码 ${previousHash.slice(0, 12)}。已保留当前数据与投递记录；外部已产生效果不会撤销或重放。` });
    const restored = await recordModuleActivation(context, tx, { moduleId, previousHash: hash, hash: previousHash, generationId: generation.id,
      dataHandling: "自动恢复到已批准旧代码；当前数据与投递记录保留，未重放外部效果。",
      rollback: { attempted: false, result: "blocked", reason: "恢复目标不会自动继续回滚，避免版本来回切换。" } });
    await audit(tx, { workspaceId, actor: "chrona", kind: "module_rollback", subjectId: moduleId, details: { hash: previousHash, failedHash: hash, generationId: generation.id, activationId, restoredActivationId: restored.activationId, automatic: true } });
    return { rolledBack: true, reason: "Automatic code rollback succeeded; current data and delivery evidence were preserved." };
  }).catch(async error => {
    const reason = `Rollback attempt failed without changing data: ${String(error).slice(0, 300)}`;
    await ports.db.$transaction(tx => updateModuleEvolution(tx, { workspaceId, moduleId, activationId, hash, status: "failed", now: ports.now(), rollback: { attempted: true, result: "blocked", reason }, nextAction: "自动代码切换失败；候选版本仍为当前版本，请人工检查诊断并恢复。" })).catch(() => {});
    return { rolledBack: false, reason };
  });
}

export async function startMigration(context: ModuleContext, tx: Prisma.TransactionClient, moduleId: string, hash: string, schema: { from: number | null; to: number }) {
  const { from, to } = schema;
  const module = await assertExternalModule(tx, context.workspaceId, moduleId, "activate");
  await assertExecutionModuleIdle(tx, moduleId);
  await tx.module.update({ where: { id: moduleId }, data: { status: "migrating" } });
  const previous = await tx.audit.findFirst({ where: { workspaceId: context.workspaceId, kind: "module_migration_started", subjectId: moduleId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  const createdAt = new Date(Math.max(context.ports.now().getTime(), previous ? previous.createdAt.getTime() + 1 : 0));
  await tx.audit.create({ data: { workspaceId: context.workspaceId, actorKey: "chrona", kind: "module_migration_started", subjectId: moduleId, details: { hash, from, to, previousStatus: module.status }, createdAt } });
}
