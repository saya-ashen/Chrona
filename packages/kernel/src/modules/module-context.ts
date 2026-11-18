import { join } from "node:path";
import { z } from "zod";
import type { Prisma } from "@chrona/db";
import type { StewardPorts } from "../ports";
import { StewardError } from "../errors";
import { assertExternalModule } from "./module-identity";
import { recordWithdrawal } from "../notification-facts";

export const intentSchema = z.object({ changes: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
  preserves: z.array(z.string().trim().min(1).max(500)).max(20).default([]) }).strict();
export type TestReport = { stdout: string; stderr: string; exitCode: number }[];
export type ContinuityReport = { status: "passed" | "failed" | "skipped"; reason?: string; fromSchema: number | null; toSchema: number; migrated: boolean };
export type BuildReport = { exactReleaseUpdate?: import("./module-install-types").ExactReleaseBaseline; tests: TestReport;
  continuity?: ContinuityReport; migration?: TestReport[number]; errors?: string[];
  /** v2-6: what Chrona installed (lockfile libraries; system programs → store or host paths). */
  dependencies?: { npm: boolean; python: boolean; packages: Record<string, string[]> } };
export type Proposal = { moduleId: string | null; hash: string; status: "building" | "testing" | "rejected" | "pending_review" | "approved";
  approvalId?: string; report: BuildReport };
export type ModuleSource = "provider" | "user" | "build";
export const json = (value: unknown) => value as Prisma.InputJsonValue;
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
/** Approval restoration is a dynamic path; source hashes and restore payloads cannot grant release authority. */
export async function assertDynamicModuleActivation(tx: Prisma.TransactionClient, workspaceId: string, moduleId: string | null) {
  if (moduleId) await assertExternalModule(tx, workspaceId, moduleId, "activate");
}
export async function expireModuleApprovals(context: ModuleContext, moduleId: string, db?: Prisma.TransactionClient): Promise<void> {
  if (!db) return context.db.$transaction(tx => expireModuleApprovals(context, moduleId, tx));
  const { workspaceId, ports } = context;
  const open = await db.approval.findMany({ where: { workspaceId, action: "activate_module", status: "open" } });
  const covers = (payload: Prisma.JsonValue) => !!payload && typeof payload === "object" && !Array.isArray(payload)
    && payload.moduleId === moduleId;
  const ids = open.filter(row => covers(row.payload)).map(row => row.id);
  await db.approval.updateMany({ where: { id: { in: ids }, status: "open" }, data: { status: "expired", resolvedAt: ports.now() } });
  for (const id of ids) await recordWithdrawal(db, workspaceId, `approval:${id}`, ports.now());
}
