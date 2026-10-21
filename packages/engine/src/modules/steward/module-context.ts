import { join } from "node:path";
import { z } from "zod";
import type { Prisma } from "@chrona/db";
import type { ModuleOutput } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { createWorkspaceFs } from "./workspace-fs";
import { StewardError } from "./errors";

export const intentSchema = z.object({ changes: z.array(z.string().trim().min(1).max(500)).min(1).max(20), preserves: z.array(z.string().trim().min(1).max(500)).max(20).default([]) }).strict();
export type TestReport = { stdout: string; stderr: string; exitCode: number }[];
export type ContinuityReport = { status: "passed" | "failed" | "skipped"; reason?: string; fromSchema: number | null; toSchema: number; migrated: boolean; effects?: ModuleOutput["effects"]; migration?: TestReport[number]; output?: TestReport[number] };
export type ReplayResult = { ok: boolean; effects?: ModuleOutput["effects"] };
export type ReplayReport = { status: "identical" | "different" | "skipped"; reason?: string; steps: number; diffs: { step: number; triggerId: string; firedAt: string; old: ReplayResult; new: ReplayResult }[] };
export type BuildReport = { tests: TestReport; replay?: ReplayReport; continuity?: ContinuityReport; migration?: TestReport[number]; errors?: string[] };
export type Proposal = { moduleId: string | null; hash: string; status: "building" | "testing" | "rejected" | "pending_review" | "approved"; approvalId?: string; report: BuildReport };
export type ModuleSource = "provider" | "user" | "build";
export const json = (value: unknown) => value as Prisma.InputJsonValue;
export function moduleContext(ports: StewardPorts, workspaceId: string) {
  const platform = join(ports.dataDir, "platform");
  return { ports, workspaceId, db: ports.db, now: ports.now, platform, store: join(platform, "store"), fs: createWorkspaceFs(ports.dataDir) };
}
export type ModuleContext = ReturnType<typeof moduleContext>;
export type ModuleVersion = Awaited<ReturnType<ModuleContext["db"]["moduleVersion"]["findFirstOrThrow"]>>;
export async function requireModule(context: ModuleContext, tx: Prisma.TransactionClient, id: string) {
  const row = await tx.module.findFirst({ where: { id, workspaceId: context.workspaceId } });
  if (!row) throw new StewardError("not_found", "Module not found");
  return row;
}
export async function expireModuleApprovals(context: ModuleContext, moduleId: string) {
  const { db, workspaceId, ports } = context;
  const open = await db.approval.findMany({ where: { workspaceId, action: "activate_module", status: "open" } });
  const ids = open.filter(row => { const payload = row.payload; return payload && typeof payload === "object" && !Array.isArray(payload) && payload.moduleId === moduleId; }).map(row => row.id);
  await db.approval.updateMany({ where: { id: { in: ids }, status: "open" }, data: { status: "expired", resolvedAt: ports.now() } });
}
