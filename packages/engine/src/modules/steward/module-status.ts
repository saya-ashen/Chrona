import { z } from "zod";
import type { Prisma } from "@chrona/db";
import { scheduleRuleSchema } from "@chrona/contracts/steward";
import { nextOccurrence } from "@chrona/domain/steward/schedule-rule";
import { audit } from "./audit";
import { createApprovals } from "./approvals";
import { StewardError } from "./errors";
import { requireModule, type ModuleContext } from "./module-context";
import { notificationSettings } from "./settings";

/** v2-26: pausing or resuming an app keeps its data and versions; an approval for it is bound to the active hash. */
export type ModuleStatus = "paused" | "active";
export const moduleStatusPayloadSchema = z.object({ kind: z.literal("module_status"), moduleId: z.string(), hash: z.string(), status: z.enum(["paused", "active"]) }).strict();

/** Pausing records which schedules it paused, so resuming restores exactly those (and not ones the user paused). */
export function setStatusIn(context: ModuleContext, tx: Prisma.TransactionClient, moduleId: string, status: ModuleStatus, source: string): Promise<{ moduleId: string; status: ModuleStatus }> {
  return status === "paused" ? pauseIn(context, tx, moduleId, source) : resumeIn(context, tx, moduleId, source);
}
async function pauseIn(context: ModuleContext, tx: Prisma.TransactionClient, moduleId: string, source: string) {
  const { workspaceId } = context, module = await requireModule(context, tx, moduleId), result = { moduleId, status: "paused" as const };
  if (module.status === "paused") return result;
  if (module.status === "migrating") throw new StewardError("conflict", "Module is migrating");
  const schedules = (await tx.schedule.findMany({ where: { workspaceId, moduleId, status: "active" }, select: { id: true } })).map(row => row.id);
  await tx.module.update({ where: { id: moduleId }, data: { status: "paused" } });
  await tx.schedule.updateMany({ where: { id: { in: schedules } }, data: { status: "paused", nextAt: null } });
  await audit(tx, { workspaceId, actor: "user", kind: "module_disabled", subjectId: moduleId, details: { source, schedules } });
  return result;
}
async function resumeIn(context: ModuleContext, tx: Prisma.TransactionClient, moduleId: string, source: string) {
  const { workspaceId, ports } = context, now = ports.now(), module = await requireModule(context, tx, moduleId), result = { moduleId, status: "active" as const };
  if (module.status === "active") return result;
  if (module.status !== "paused" || !module.activeHash) throw new StewardError("conflict", "Module is not paused");
  const disabled = await tx.audit.findFirst({ where: { workspaceId, kind: "module_disabled", subjectId: moduleId }, orderBy: { createdAt: "desc" } });
  const ids = z.object({ schedules: z.array(z.string()) }).safeParse(disabled?.details).data?.schedules ?? [];
  const zone = notificationSettings((await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId } })).settings).timezone;
  for (const row of await tx.schedule.findMany({ where: { id: { in: ids }, status: "paused" } })) {
    const rule = scheduleRuleSchema.parse(row.rule);
    // A one-off time that passed while paused fires late rather than never.
    await tx.schedule.update({ where: { id: row.id }, data: { status: "active", nextAt: nextOccurrence(rule, now, zone) ?? (rule.kind === "at" ? now : null) } });
  }
  await tx.module.update({ where: { id: moduleId }, data: { status: "active" } });
  await audit(tx, { workspaceId, actor: "user", kind: "module_enabled", subjectId: moduleId, details: { source, schedules: ids } });
  return result;
}

/** The Provider never pauses or resumes an app itself: it asks, and the user decides once (yellow). */
export async function requestStatus(context: ModuleContext, moduleId: string, status: ModuleStatus, reason: string) {
  const module = await requireModule(context, context.db, moduleId);
  if (!module.activeHash) throw new StewardError("conflict", "Module has no active version");
  if (module.status === status) return { moduleId, status };
  if (status === "active" && module.status !== "paused") throw new StewardError("conflict", "Module is not paused");
  const verb = status === "paused" ? "停用" : "重新启用";
  const approval = await createApprovals(context).create({ moduleId, action: "activate_module", title: `${verb}应用 ${module.name}`.slice(0, 200), detail: reason.slice(0, 4000),
    payload: { kind: "module_status", moduleId, hash: module.activeHash, status },
    preview: status === "paused" ? `${module.name} 将停止运行，它的定时暂停；数据和版本保留，随时可以重新启用。` : `${module.name} 将恢复运行，停用时暂停的定时恢复。` });
  return { status: "pending_approval" as const, approvalId: approval.id };
}
