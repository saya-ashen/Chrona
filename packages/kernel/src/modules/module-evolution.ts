import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@chrona/db";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { json, type ModuleContext } from "./module-context";

export const moduleEvolutionOutcomeSchema = z.object({
  activationId: z.string(), moduleId: z.string(), previousHash: z.string().nullable(), candidateHash: z.string(),
  activatedAt: z.string(), status: z.enum(["awaiting-verification", "verified", "failed", "rolled-back"]),
  changes: z.array(z.string()).max(20), checks: z.record(z.string(), z.json()),
  observedCapabilities: z.array(z.string()).max(100), dataHandling: z.string(), nextAction: z.string(),
  rollback: z.object({ attempted: z.boolean(), result: z.enum(["not-attempted", "blocked", "succeeded"]), reason: z.string().nullable() }),
}).strict();
export type ModuleEvolutionOutcome = z.infer<typeof moduleEvolutionOutcomeSchema>;
type Db = Prisma.TransactionClient;

async function save(db: Db, outcome: ModuleEvolutionOutcome, now: Date) {
  const { moduleId } = outcome;
  const previous = await db.moduleActivation.findFirst({ where: { moduleId }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true } });
  const createdAt = new Date(Math.max(now.getTime(), (previous?.updatedAt.getTime() ?? -Infinity) + 1));
  const data = { ...outcome, changes: json(outcome.changes), checks: json(outcome.checks),
    observedCapabilities: json(outcome.observedCapabilities), rollback: json(outcome.rollback) };
  await db.moduleActivation.upsert({ where: { activationId: outcome.activationId },
    create: { ...data, createdAt, updatedAt: createdAt }, update: { ...data, updatedAt: createdAt } });
}

// eslint-disable-next-line complexity -- Preserve defensive report projection and activation history ordering.
export async function recordModuleActivation(context: ModuleContext, tx: Db, input: { moduleId: string; previousHash: string | null; hash: string; dataHandling?: string; rollback?: ModuleEvolutionOutcome["rollback"] }) {
  const version = await tx.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: input.moduleId, hash: input.hash } } });
  const manifest = moduleManifestSchema.parse(version.manifest), report = version.report && typeof version.report === "object" && !Array.isArray(version.report) ? version.report as Record<string, unknown> : {};
  const continuity = report.continuity && typeof report.continuity === "object" ? report.continuity as { status?: unknown; fromSchema?: unknown; toSchema?: unknown; migrated?: unknown } : {};
  const outcome = moduleEvolutionOutcomeSchema.parse({
    activationId: randomUUID(), moduleId: input.moduleId, previousHash: input.previousHash, candidateHash: input.hash,
    activatedAt: context.ports.now().toISOString(), status: "awaiting-verification",
    changes: Array.isArray((version.intent as { changes?: unknown } | null)?.changes) ? (version.intent as { changes: string[] }).changes.slice(0, 20) : [],
    checks: { continuity: { status: typeof continuity.status === "string" ? continuity.status : "unrecorded", fromSchema: continuity.fromSchema ?? null, toSchema: continuity.toSchema ?? manifest.data.schema, migrated: continuity.migrated === true } },
    observedCapabilities: [], dataHandling: input.dataHandling ?? (input.previousHash ? `只切换代码；保留当前数据，schema ${String(manifest.data.schema)}。` : `首次启用；数据 schema ${String(manifest.data.schema)}，未恢复旧数据快照。`),
    nextAction: "运行实际功能并检查结果；启动或连接不代表功能已验证。",
    rollback: input.rollback ?? { attempted: false, result: "not-attempted", reason: null },
  });
  await save(tx, outcome, context.ports.now());
  return outcome;
}

/** Latest activation epoch for a hash; same-hash reactivation gets a different id. */
export async function latestModuleEvolution(db: Db, workspaceId: string, moduleId: string, hash: string) {
  const row = await db.moduleActivation.findFirst({ where: { moduleId, candidateHash: hash, module: { workspaceId } }, orderBy: [{ createdAt: "desc" }, { activationId: "desc" }] });
  return row ? moduleActivationOutcome(row) : null;
}
function moduleActivationOutcome(row: Prisma.ModuleActivationGetPayload<object>) {
  const { createdAt: _createdAt, updatedAt: _updatedAt, ...outcome } = row;
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

// eslint-disable-next-line complexity -- Keep activation-epoch guards and outcome transitions together before saving the outcome.
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
  await save(db, outcome, input.now);
  return true;
}
