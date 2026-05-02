import { db } from "@/lib/db";
import { startPlanExecution } from "@/modules/plan-execution";
import { deriveAutoStartEligibility } from "@/modules/tasks/derive-auto-start-eligibility";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";

export type AutoStartScheduledPlanResult = {
  started: Array<{ taskId: string; runId: string }>;
  skipped: Array<{ taskId: string; reason: string }>;
  failed: Array<{ taskId: string; error: string }>;
  now: string;
};

export async function autoStartScheduledPlanTasks(input?: { now?: Date }): Promise<AutoStartScheduledPlanResult> {
  const now = input?.now ?? new Date();
  const dueTasks = await db.task.findMany({
    where: {
      scheduleStatus: "Scheduled",
      scheduledStartAt: { lte: now },
      status: { in: ["Ready", "Scheduled", "Queued"] },
    },
    orderBy: [{ scheduledStartAt: "asc" }, { priority: "desc" }],
  });

  const result: AutoStartScheduledPlanResult = {
    started: [],
    skipped: [],
    failed: [],
    now: now.toISOString(),
  };

  for (const task of dueTasks) {
    try {
      const activeRun = await db.run.findFirst({
        where: {
          taskId: task.id,
          status: { in: ["Pending", "Running", "WaitingForInput", "WaitingForApproval"] },
        },
        orderBy: { createdAt: "desc" },
      });

      const eligibility = deriveAutoStartEligibility({
        task: {
          status: task.status,
          scheduleStatus: task.scheduleStatus,
          scheduledStartAt: task.scheduledStartAt,
          runtimeAdapterKey: task.runtimeAdapterKey,
        },
        now,
        activeRun: activeRun ? { status: activeRun.status } : null,
      });

      if (!eligibility.ok) {
        result.skipped.push({ taskId: task.id, reason: eligibility.reason });

        await appendCanonicalEvent({
          eventType: "task.auto_start.skipped",
          workspaceId: task.workspaceId,
          taskId: task.id,
          actorType: "system",
          actorId: "auto-start-scheduler",
          source: "scheduler",
          payload: {
            reason: eligibility.reason,
            scheduleStatus: task.scheduleStatus,
            scheduledStartAt: task.scheduledStartAt?.toISOString() ?? null,
          },
          dedupeKey: `task.auto_start.skipped:${task.id}:${now.toISOString().slice(0, 13)}`,
        });
        continue;
      }

      const startedRun = await startPlanExecution({ taskId: task.id, trigger: "scheduler" });
      result.started.push({ taskId: task.id, runId: startedRun.planId ?? task.id });
    } catch (parentError) {
      const message = parentError instanceof Error ? parentError.message : "Unknown error during auto-start";
      result.failed.push({ taskId: task.id, error: message });
    }
  }

  return result;
}
