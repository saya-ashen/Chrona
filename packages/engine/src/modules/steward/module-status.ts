import { z } from "zod";
import type { Prisma } from "@chrona/db";
import { scheduleRuleSchema } from "@chrona/contracts/steward";
import { nextOccurrence } from "@chrona/domain/steward/schedule-rule";
import { audit } from "./audit";
import { StewardError } from "./errors";
import { requireModule, type ModuleContext } from "./module-context";
import { notificationSettings } from "./settings";

/** Pausing or resuming an app keeps its data and versions. */
export type ModuleStatus = "paused" | "active";

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

/** Chrona pauses or resumes directly, recording its reason in the audit. */
export async function requestStatus(context: ModuleContext, moduleId: string, status: ModuleStatus, reason: string) {
  const module = await requireModule(context, context.db, moduleId);
  if (!module.activeHash) throw new StewardError("conflict", "Module has no active version");
  if (module.status === status) return { moduleId, status };
  if (status === "active" && module.status !== "paused") throw new StewardError("conflict", "Module is not paused");
  return context.db.$transaction(async tx => {
    const result = await setStatusIn(context, tx, moduleId, status, "chrona");
    await audit(tx, { workspaceId: context.workspaceId, actor: "chrona", kind: "module_status_changed", subjectId: moduleId, details: { status, reason } });
    return result;
  });
}
