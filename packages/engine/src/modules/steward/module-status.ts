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
type PauseCause = { source: string; reason?: string; incidentId?: string };

/** Pausing records which schedules it paused, so resuming restores exactly those (and not ones the user paused). */
export function setStatusIn(context: ModuleContext, tx: Prisma.TransactionClient, moduleId: string, status: ModuleStatus, cause: string | PauseCause): Promise<{ moduleId: string; status: ModuleStatus }> {
  const input = typeof cause === "string" ? { source: cause } : cause;
  return status === "paused" ? pauseIn(context, tx, moduleId, input) : resumeIn(context, tx, moduleId, input.source);
}
const statusKinds = ["module_disabled", "module_enabled"];
function latestStatus(tx: Prisma.TransactionClient, workspaceId: string, moduleId: string) {
  return tx.audit.findFirst({ where: { workspaceId, subjectId: moduleId, kind: { in: statusKinds } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
}
async function recordStatus(context: ModuleContext, tx: Prisma.TransactionClient, moduleId: string, kind: string, details: Prisma.InputJsonObject & { source: string }) {
  const previous = await latestStatus(tx, context.workspaceId, moduleId);
  // Preserve pause/resume order even when transitions share a millisecond or the clock moves back.
  const createdAt = new Date(Math.max(context.now().getTime(), (previous?.createdAt.getTime() ?? -Infinity) + 1));
  await tx.audit.create({ data: { workspaceId: context.workspaceId, subjectId: moduleId, actorKey: details.source === "automatic" || details.source === "chrona" ? "chrona" : "user", kind, details, createdAt } });
}
export async function pauseIn(context: ModuleContext, tx: Prisma.TransactionClient, moduleId: string, { source, reason = source, incidentId }: PauseCause) {
  const { workspaceId } = context, module = await requireModule(context, tx, moduleId), result = { moduleId, status: "paused" as const };
  if (module.status === "paused") return result;
  if (module.status === "migrating") throw new StewardError("conflict", "Module is migrating");
  const schedules = (await tx.schedule.findMany({ where: { workspaceId, moduleId, status: "active" }, select: { id: true } })).map(row => row.id);
  await tx.module.update({ where: { id: moduleId }, data: { status: "paused" } });
  await tx.schedule.updateMany({ where: { id: { in: schedules } }, data: { status: "paused", nextAt: null } });
  await recordStatus(context, tx, moduleId, "module_disabled", { source, reason, schedules, ...(incidentId ? { incidentId } : {}) });
  return result;
}
function nextResumedOccurrence(row: { rule: Prisma.JsonValue; until: Date | null }, now: Date, zone: string) {
  const rule = scheduleRuleSchema.parse(row.rule);
  // A one-off time that passed while paused never ran: it fires late rather than never. Recurring ones just continue.
  const next = nextOccurrence(rule, now, zone) ?? (rule.kind === "at" ? now : null);
  return next && (!row.until || next <= row.until) ? next : null;
}
async function resumeIn(context: ModuleContext, tx: Prisma.TransactionClient, moduleId: string, source: string) {
  const { workspaceId, ports } = context, now = ports.now(), module = await requireModule(context, tx, moduleId), result = { moduleId, status: "active" as const };
  if (module.status === "active") return result;
  if (module.status !== "paused" || !module.activeHash) throw new StewardError("conflict", "Module is not paused");
  const latest = await latestStatus(tx, workspaceId, moduleId);
  // Legacy automatic pauses recorded no IDs (and may follow an older manual pause/resume).
  const recorded = latest?.kind === "module_disabled" ? z.object({ schedules: z.array(z.string()) }).safeParse(latest.details).data : undefined;
  const ids = recorded?.schedules ?? [];
  const zone = notificationSettings((await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId } })).settings).timezone;
  for (const row of await tx.schedule.findMany({ where: { workspaceId, moduleId, id: { in: ids }, status: "paused" } })) {
    const nextAt = nextResumedOccurrence(row, now, zone);
    // Missed recurring runs are not caught up.
    await tx.schedule.update({ where: { id: row.id }, data: { status: nextAt ? "active" : "done", nextAt } });
  }
  await tx.module.update({ where: { id: moduleId }, data: { status: "active" } });
  await recordStatus(context, tx, moduleId, "module_enabled", { source, schedules: ids, ...(!recorded ? { unrestoredLegacyPause: true } : {}) });
  return result;
}

/** Chrona pauses or resumes directly, recording its reason in the audit. */
export async function requestStatus(context: ModuleContext, moduleId: string, status: ModuleStatus, reason: string) {
  const module = await requireModule(context, context.db, moduleId);
  if (!module.activeHash) throw new StewardError("conflict", "Module has no active version");
  if (module.status === status) return { moduleId, status };
  if (status === "active" && module.status !== "paused") throw new StewardError("conflict", "Module is not paused");
  return context.db.$transaction(async tx => {
    const result = await setStatusIn(context, tx, moduleId, status, { source: "chrona", reason });
    await audit(tx, { workspaceId: context.workspaceId, actor: "chrona", kind: "module_status_changed", subjectId: moduleId, details: { status, reason } });
    return result;
  });
}
