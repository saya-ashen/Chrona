import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@chrona/db";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { json, type ModuleContext } from "./module-context";

const KIND = "module_evolution_outcome";
export const moduleEvolutionOutcomeSchema = z.object({
  activationId: z.string(), moduleId: z.string(), previousHash: z.string().nullable(), candidateHash: z.string(),
  generationId: z.string(), activatedAt: z.string(), status: z.enum(["awaiting-verification", "verified", "failed", "rolled-back"]),
  changes: z.array(z.string()).max(20), checks: z.record(z.string(), z.json()), affectedCallers: z.array(z.string()).max(100),
  observedCapabilities: z.array(z.string()).max(100), dataHandling: z.string(), nextAction: z.string(),
  rollback: z.object({ attempted: z.boolean(), result: z.enum(["not-attempted", "blocked", "succeeded"]), reason: z.string().nullable() }),
}).strict();
export type ModuleEvolutionOutcome = z.infer<typeof moduleEvolutionOutcomeSchema>;
type Db = Prisma.TransactionClient;

async function save(db: Db, workspaceId: string, outcome: ModuleEvolutionOutcome, now: Date, grouped = false) {
  const { moduleId } = outcome;
  const previous = await db.moduleActivation.findFirst({ where: { moduleId }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true } });
  const createdAt = new Date(Math.max(now.getTime(), (previous?.updatedAt.getTime() ?? -Infinity) + 1));
  const data = { ...outcome, changes: json(outcome.changes), checks: json(outcome.checks),
    affectedCallers: json(outcome.affectedCallers), observedCapabilities: json(outcome.observedCapabilities), rollback: json(outcome.rollback) };
  await db.moduleActivation.upsert({ where: { activationId: outcome.activationId },
    create: { ...data, grouped, createdAt, updatedAt: createdAt }, update: { ...data, updatedAt: createdAt } });
  await db.audit.create({ data: { workspaceId, actorKey: "chrona", subjectId: moduleId, kind: KIND, details: json(outcome), createdAt } });
}

// eslint-disable-next-line complexity -- Preserve defensive report projection and activation audit ordering without changing historical outcomes.
export async function recordModuleActivation(context: ModuleContext, tx: Db, input: { moduleId: string; previousHash: string | null; hash: string; generationId: string; grouped?: boolean; dataHandling?: string; rollback?: ModuleEvolutionOutcome["rollback"] }) {
  const version = await tx.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: input.moduleId, hash: input.hash } } });
  const manifest = moduleManifestSchema.parse(version.manifest), report = version.report && typeof version.report === "object" && !Array.isArray(version.report) ? version.report as Record<string, unknown> : {};
  const impacts = Array.isArray(report.outputImpacts) ? report.outputImpacts as { caller?: unknown }[] : [];
  const tests = Array.isArray(report.tests) ? report.tests as { exitCode?: unknown }[] : [];
  const typecheck = report.typecheck && typeof report.typecheck === "object" ? report.typecheck as { status?: unknown; reason?: unknown; errors?: unknown[]; total?: unknown } : {};
  const continuity = report.continuity && typeof report.continuity === "object" ? report.continuity as { status?: unknown; fromSchema?: unknown; toSchema?: unknown; migrated?: unknown } : {};
  const dependentChecks = Array.isArray(report.dependentChecks) ? report.dependentChecks as { caller?: unknown; status?: unknown; reason?: unknown }[] : [];
  const outcome = moduleEvolutionOutcomeSchema.parse({
    activationId: randomUUID(), moduleId: input.moduleId, previousHash: input.previousHash, candidateHash: input.hash,
    generationId: input.generationId, activatedAt: context.ports.now().toISOString(), status: "awaiting-verification",
    changes: Array.isArray((version.intent as { changes?: unknown } | null)?.changes) ? (version.intent as { changes: string[] }).changes.slice(0, 20) : [],
    checks: { tests: { count: tests.length, failed: tests.filter(item => item.exitCode !== 0).length },
      typecheck: { status: typeof typecheck.status === "string" ? typecheck.status : "unrecorded", ...(typeof typecheck.reason === "string" ? { reason: typecheck.reason.slice(0, 300) } : {}), errorCount: Array.isArray(typecheck.errors) ? typecheck.errors.length : 0, ...(typeof typecheck.total === "number" ? { total: typecheck.total } : {}) },
      continuity: { status: typeof continuity.status === "string" ? continuity.status : "unrecorded", fromSchema: continuity.fromSchema ?? null, toSchema: continuity.toSchema ?? manifest.data.schema, migrated: continuity.migrated === true },
      dependentCallers: dependentChecks.slice(0, 100).map(item => ({ caller: typeof item.caller === "string" ? item.caller : "unknown", status: typeof item.status === "string" ? item.status : "unrecorded", ...(typeof item.reason === "string" ? { reason: item.reason.slice(0, 300) } : {}) })) },
    affectedCallers: [...new Set(impacts.map(item => typeof item.caller === "string" ? item.caller : null).filter((name): name is string => name !== null))].slice(0, 100),
    observedCapabilities: [], dataHandling: input.dataHandling ?? (input.previousHash ? `只切换代码；保留当前数据，schema ${String(manifest.data.schema)}。` : `首次启用；数据 schema ${String(manifest.data.schema)}，未恢复旧数据快照。`),
    nextAction: "运行实际功能并检查结果；启动或连接不代表功能已验证。",
    rollback: input.rollback ?? { attempted: false, result: "not-attempted", reason: null },
  });
  await save(tx, context.workspaceId, outcome, context.ports.now(), input.grouped);
  return outcome;
}

/** Latest activation epoch for a hash; same-hash reactivation gets a different id. */
export async function latestModuleEvolution(db: Db, workspaceId: string, moduleId: string, hash: string) {
  const row = await db.moduleActivation.findFirst({ where: { moduleId, candidateHash: hash, module: { workspaceId } }, orderBy: [{ createdAt: "desc" }, { activationId: "desc" }] });
  return row ? moduleActivationOutcome(row) : null;
}
function moduleActivationOutcome(row: Prisma.ModuleActivationGetPayload<object>) {
  const { createdAt: _createdAt, updatedAt: _updatedAt, grouped: _grouped, ...outcome } = row;
  return moduleEvolutionOutcomeSchema.parse(outcome);
}

export async function currentModuleEvolution(db: Db, workspaceId: string, moduleId: string, hash: string) {
  const module = await db.module.findFirst({ where: { id: moduleId, workspaceId, status: "active", activeHash: hash }, select: { id: true } });
  return module ? latestModuleEvolution(db, workspaceId, moduleId, hash) : null;
}

export async function moduleEvolutionOutcomes(db: Db, workspaceId: string, moduleId: string) {
  const rows = await db.moduleActivation.findMany({ where: { moduleId, module: { workspaceId } }, orderBy: [{ updatedAt: "desc" }, { activationId: "desc" }], take: 5 });
  return rows.map(moduleActivationOutcome);
}

// eslint-disable-next-line complexity -- Keep activation-epoch guards and outcome transitions together before writing the audit record.
export async function updateModuleEvolution(db: Db, input: { workspaceId: string; moduleId: string; activationId: string; hash: string; capability?: string; status?: "failed" | "rolled-back"; expectedCurrentHash?: string; now: Date; nextAction?: string; dataHandling?: string; rollback?: ModuleEvolutionOutcome["rollback"] }) {
  const module = await db.module.findFirst({ where: { workspaceId: input.workspaceId, id: input.moduleId }, select: { activeHash: true, status: true } });
  const currentHash = input.status === "rolled-back" ? input.expectedCurrentHash : input.hash;
  if (!module || module.activeHash !== currentHash || (input.capability && module.status !== "active")) return false;
  const latest = await latestModuleEvolution(db, input.workspaceId, input.moduleId, input.hash);
  if (latest?.activationId !== input.activationId) return false;
  const previous = latest;
  if (previous.status === "rolled-back" && !input.rollback) return false;
  const observedCapabilities = input.capability && !previous.observedCapabilities.includes(input.capability)
    ? [...previous.observedCapabilities, input.capability].slice(-100) : previous.observedCapabilities;
  const outcome = moduleEvolutionOutcomeSchema.parse({ ...previous,
    status: input.status ?? (input.capability ? "verified" : previous.status), observedCapabilities,
    ...(input.dataHandling ? { dataHandling: input.dataHandling } : {}), ...(input.rollback ? { rollback: input.rollback } : {}),
    nextAction: input.nextAction ?? (input.status === "failed" ? "当前版本尚未验证成功；检查故障证据并按审批流程恢复。" : input.capability ? "已验证列出的实际调用能力；其他工具尚未因此验证。" : previous.nextAction),
  });
  if (JSON.stringify(outcome) === JSON.stringify(previous)) return true;
  await save(db, input.workspaceId, outcome, input.now);
  return true;
}
