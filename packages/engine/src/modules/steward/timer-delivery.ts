import { withTimerLock } from "./timer-lock";
import { z } from "zod";
import { timerScheduleSchema, wakeBudgetSchema } from "@chrona/contracts/steward";
import type { Prisma } from "@chrona/db";
import type { StewardPorts } from "./ports";
import { CallError } from "./module-call-error";
import { isModulePaused } from "./module-availability";
import { budgetTimezone } from "./settings";
import { localDayKey } from "@chrona/domain/steward/local-day";

export const storedTimerRule = z.object({ revision: z.string(), hash: z.string(), schedule: timerScheduleSchema }).strict();
type Db = StewardPorts["db"] | Prisma.TransactionClient;
export function nextTimerAt(schedule: z.infer<typeof timerScheduleSchema>, scheduledAt: Date, now: Date) {
  return schedule.kind === "every" ? new Date(scheduledAt.getTime() + (Math.floor((now.getTime() - scheduledAt.getTime()) / schedule.milliseconds) + 1) * schedule.milliseconds) : null;
}
/** Count durable admissions, including interrupted deliveries; exclude known unsent deferrals and this claim. */
export async function wakeAllowance(db: Db, workspaceId: string, now: Date, claimId?: string) {
  const workspace = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  const wake = wakeBudgetSchema.parse((workspace.settings as { wake?: unknown } | null)?.wake ?? {});
  const timezone = budgetTimezone(workspace.settings), day = localDayKey(now, timezone);
  const recent = await db.moduleInvocation.findMany({ where: { workspaceId, mode: "timer", status: { not: "deferred" }, ...(claimId ? { id: { not: claimId } } : {}), createdAt: { gte: new Date(now.getTime() - 48 * 3600_000), lte: now } }, select: { targetModuleId: true, createdAt: true } });
  const today = recent.filter(item => localDayKey(item.createdAt, timezone) === day);
  return (moduleId: string) => today.length < wake.dailyLimit
    && today.filter(item => item.targetModuleId === moduleId).length < wake.moduleDailyLimit
    && !recent.some(item => item.targetModuleId === moduleId && item.createdAt.getTime() > now.getTime() - wake.minIntervalMs);
}
/** Runtime serialization covers final validation, durable admission and synchronous transport write. */
export async function dispatchTimer(ports: StewardPorts, workspaceId: string, input: { timerId: string; revision: string; eventId: string; scheduledAt: Date }, send: () => void) {
  return withTimerLock(ports, workspaceId, async () => {
    try {
      await ports.db.$transaction(async tx => {
        await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${workspaceId}`;
        const timer = await tx.schedule.findUniqueOrThrow({ where: { id: input.timerId } });
        const rule = storedTimerRule.parse(timer.rule);
        if (timer.status !== "running" || rule.revision !== input.revision) throw new CallError("conflict", "Timer cancelled or replaced");
        const module = await tx.module.findFirst({ where: { id: timer.moduleId!, workspaceId, status: "active", activeHash: rule.hash } });
        if (!module || isModulePaused(module.name)) throw Object.assign(new CallError("unavailable", "Timer application changed"), { timerDeferred: true });
        const now = ports.now();
        if (!(await wakeAllowance(tx, workspaceId, now, input.eventId))(module.id)) throw Object.assign(new CallError("conflict", "Timer wake budget exhausted"), { timerDeferred: true });
        await tx.moduleInvocation.update({ where: { id: input.eventId }, data: { createdAt: now } });
        await tx.schedule.update({ where: { id: timer.id }, data: { lastAt: now, nextAt: nextTimerAt(rule.schedule, input.scheduledAt, now) } });
      });
      send();
    } catch (cause) {
      // Definite rejection is safe to stop; unclassified persistence/transport errors remain unknown.
      if (cause instanceof CallError) throw Object.assign(cause, { deliveryRejected: true });
      throw cause;
    }
  });
}
/** Completion evidence is bound to the unique event id, approved hash and application. Never replay. */
export async function recoverTimers(ports: StewardPorts, workspaceId: string) {
  const interrupted = await ports.db.moduleInvocation.findMany({ where: { workspaceId, mode: "timer", status: "running" } });
  for (const invocation of interrupted) await ports.db.$transaction(async tx => {
    await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${workspaceId}`;
    const args = z.object({ timerId: z.string(), revision: z.string() }).parse(invocation.args);
    const completed = invocation.targetModuleId && invocation.targetHash ? await tx.moduleRun.findMany({ where: { moduleId: invocation.targetModuleId, hash: invocation.targetHash, triggerId: invocation.id }, select: { exitCode: true, output: true } }) : [];
    const delivered = completed.filter(row => !(row.exitCode === 1 && (row.output as { delivery?: string } | null)?.delivery === "not_sent"));
    const succeeded = delivered.length === 1 && delivered[0]!.exitCode === 0;
    const changed = await tx.moduleInvocation.updateMany({ where: { id: invocation.id, status: "running" }, data: { status: succeeded ? "succeeded" : "unknown", error: succeeded ? null : "Timer delivery interrupted", finishedAt: ports.now() } });
    if (!changed.count) return;
    const timer = await tx.schedule.findUnique({ where: { id: args.timerId } });
    if (timer?.status !== "running" || storedTimerRule.parse(timer.rule).revision !== args.revision) return;
    await tx.schedule.update({ where: { id: timer.id }, data: succeeded ? { status: timer.nextAt ? "active" : "done", lastResult: "delivered" } : { status: "unknown", nextAt: null, lastResult: "Timer delivery interrupted; outcome unknown" } });
  });
}
