import { randomUUID } from "node:crypto";
import { fenceExecutionModule } from "../execution/execution-delivery-controls";
import type { Prisma } from "@chrona/db";
import { audit } from "../audit";
import { StewardError } from "../errors";
import { requireModule, type ModuleContext } from "./module-context";
import { assertExecutionModuleIdle } from "../execution/execution-module-guard";
import { assertModuleOperation } from "./module-identity";

/** Pausing or resuming an app keeps its data and versions. */
export type ModuleStatus = "paused" | "active";
type PauseCause = { source: string; reason?: string; incidentId?: string };

/** Status transitions never create or resume calendar work. */
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
  const module = await requireModule(context, tx, moduleId), result = { moduleId, status: "paused" as const };
  if (module.status === "paused") return result;
  if (module.status === "migrating") throw new StewardError("conflict", "Module is migrating");
  await assertExecutionModuleIdle(tx, moduleId);
  await tx.module.update({ where: { id: moduleId }, data: { status: "paused" } });
  await recordStatus(context, tx, moduleId, "module_disabled", { source, reason, ...(incidentId ? { incidentId } : {}) });
  return result;
}
async function resumeIn(context: ModuleContext, tx: Prisma.TransactionClient, moduleId: string, source: string) {
  const module = await requireModule(context, tx, moduleId), result = { moduleId, status: "active" as const };
  assertModuleOperation(module, "enable");
  if (module.status === "active" && !module.executionFenceAt) return result;
  if ((module.status !== "paused" && module.status !== "active") || !module.activeHash) throw new StewardError("conflict", "Module is not paused");
  if (module.executionFenceAt) {
    // A failed pause can leave an active module fenced. Only confirmed drain permits reopening it.
    await assertExecutionModuleIdle(tx, moduleId);
    if (!await tx.moduleVersion.findFirst({ where: { moduleId, hash: module.activeHash, status: "approved" } })) throw new StewardError("conflict", "Module version is not approved");
  }
  await tx.module.update({ where: { id: moduleId }, data: { status: "active", ...(module.status === "paused" ? { activationId: randomUUID() } : {}), executionFenceAt: null } });
  await recordStatus(context, tx, moduleId, "module_enabled", { source });
  return result;
}

/** Chrona pauses or resumes directly, recording its reason in the audit. */
export async function requestStatus(context: ModuleContext, moduleId: string, status: ModuleStatus, reason: string) {
  const module = await requireModule(context, context.db, moduleId);
  if (status === "active") assertModuleOperation(module, "enable");
  if (!module.activeHash) throw new StewardError("conflict", "Module has no active version");
  if (module.status === status && !(status === "active" && module.executionFenceAt)) return { moduleId, status };
  if (status === "active" && module.status !== "paused" && module.status !== "active") throw new StewardError("conflict", "Module is not paused");
  if (status === "paused") await fenceExecutionModule(context.ports, context.workspaceId, moduleId);
  return context.db.$transaction(async tx => {
    const result = await setStatusIn(context, tx, moduleId, status, { source: "chrona", reason });
    await audit(tx, { workspaceId: context.workspaceId, actor: "chrona", kind: "module_status_changed", subjectId: moduleId, details: { status, reason } });
    return result;
  });
}
