import { join } from "node:path";
import { z } from "zod";
import type { Prisma } from "@chrona/db";
import type { StewardPorts } from "./ports";
import { StewardError } from "./errors";

export const intentSchema = z.object({ changes: z.array(z.string().trim().min(1).max(500)).min(1).max(20), preserves: z.array(z.string().trim().min(1).max(500)).max(20).default([]) }).strict();
export type TestReport = { stdout: string; stderr: string; exitCode: number }[];
/** Recorded kernel calls shown in the review preview, in the old effect wording. */
type PreviewEffect = { type: "notify_user"; key: string; level: "now" | "digest"; title: string; body: string } | { type: "wake_provider"; key: string; prompt: string };
export type ContinuityReport = { status: "passed" | "failed" | "skipped"; reason?: string; fromSchema: number | null; toSchema: number; migrated: boolean; effects?: PreviewEffect[]; migration?: TestReport[number]; output?: TestReport[number] };
export type KeyProbe = { status: "passed" | "repeated" | "skipped"; reason?: string; keys?: string[] };
/** v2-25: the entry type-checked against the SDK and call contracts before tests. */
export type TypecheckReport = { status: "passed" | "failed" | "skipped"; reason?: string; errors?: { file: string; line: number; code: number; message: string }[]; total?: number };
export type BuildReport = { tests: TestReport; continuity?: ContinuityReport; keyProbe?: KeyProbe; migration?: TestReport[number]; errors?: string[]; typecheck?: TypecheckReport; outputImpacts?: { caller: string; targets: string[] }[]; dependentChecks?: { caller: string; status: "passed" | "failed" | "skipped"; reason?: string; errors?: TypecheckReport["errors"] }[];
  /** v2-6: what Chrona installed (lockfile libraries; system programs → store or host paths). */
  dependencies?: { npm: boolean; python: boolean; packages: Record<string, string[]> } };
export type Proposal = { moduleId: string | null; hash: string; status: "building" | "testing" | "rejected" | "pending_review" | "approved"; approvalId?: string; report: BuildReport };
export type ModuleSource = "provider" | "user" | "build";
export const json = (value: unknown) => value as Prisma.InputJsonValue;
/** v2-15: one `activate_module` approval that activates a build's modules together (module-group). */
export const groupPayloadSchema = z.object({ kind: z.literal("activate_modules"), versions: z.array(z.object({ moduleId: z.string(), hash: z.string() }).strict()).min(2).max(4) }).strict();
export const isGroupPayload = (payload: unknown) => !!payload && typeof payload === "object" && !Array.isArray(payload) && (payload as { kind?: unknown }).kind === "activate_modules";
export function moduleContext(ports: StewardPorts, workspaceId: string) {
  const platform = join(ports.dataDir, "platform");
  return { ports, workspaceId, db: ports.db, now: ports.now, platform, store: join(platform, "store") };
}
export type ModuleContext = ReturnType<typeof moduleContext>;
export type ModuleVersion = Awaited<ReturnType<ModuleContext["db"]["moduleVersion"]["findFirstOrThrow"]>>;
export async function requireModule(context: ModuleContext, tx: Prisma.TransactionClient, id: string) {
  const row = await tx.module.findFirst({ where: { id, workspaceId: context.workspaceId } });
  if (!row) throw new StewardError("not_found", "Module not found");
  return row;
}
/** A release is not an incremental update to someone's fork. Explicit rollback is separate. */
export async function assertBuiltinUpgrade(tx: Prisma.TransactionClient, workspaceId: string, moduleId: string | null, payload: Prisma.JsonValue) {
  const input = z.object({ hash: z.string(), restore: z.unknown().optional() }).safeParse(payload);
  if (!moduleId || !input.success || input.data.restore !== undefined) return;
  const target = await tx.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId, hash: input.data.hash } } });
  if (target?.source !== "builtin") return;
  const module = await tx.module.findFirst({ where: { id: moduleId, workspaceId } });
  if (!module?.activeHash) return;
  const active = await tx.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId, hash: module.activeHash } } });
  if (active && active.source !== "builtin") throw new StewardError("conflict", `内置版本不能作为定制模块的普通更新启用。当前定制会被丢弃；如确需恢复已批准的内置版，请明确执行 chrona admin rollback ${module.name} builtin。`);
}
export async function expireModuleApprovals(context: ModuleContext, moduleId: string) {
  const { db, workspaceId, ports } = context;
  const open = await db.approval.findMany({ where: { workspaceId, action: "activate_module", status: "open" } });
  // v2-15: a group approval (versions[]) expires with any of its modules.
  const covers = (payload: Prisma.JsonValue) => !!payload && typeof payload === "object" && !Array.isArray(payload)
    && (payload.moduleId === moduleId || (Array.isArray(payload.versions) && payload.versions.some(entry => !!entry && typeof entry === "object" && !Array.isArray(entry) && entry.moduleId === moduleId)));
  const ids = open.filter(row => covers(row.payload)).map(row => row.id);
  await db.approval.updateMany({ where: { id: { in: ids }, status: "open" }, data: { status: "expired", resolvedAt: ports.now() } });
}
