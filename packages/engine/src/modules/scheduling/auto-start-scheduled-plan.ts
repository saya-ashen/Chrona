import { db } from "@/lib/db";
import { taskPlanExecution } from "@/modules/plan-execution";
import { deriveAutoStartEligibility } from "@/modules/scheduling/derive-auto-start-eligibility";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";
import { publishTaskWorkspaceUpdatedEvent } from "@/modules/projections/task-projection-events";

export type AutoStartScheduledPlanResult = {
  started: Array<{ taskId: string; workBlockId: string; runId: string }>;
  skipped: Array<{ taskId: string; workBlockId: string; reason: string }>;
  failed: Array<{ taskId: string; workBlockId: string; error: string }>;
  now: string;
};

export async function autoStartScheduledPlanTasks(input?: { now?: Date }): Promise<AutoStartScheduledPlanResult> {
  const now = input?.now ?? new Date();
  const dueWorkBlocks = await db.workBlock.findMany({
    where: {
      status: "Scheduled",
      scheduledStartAt: { lte: now },
      task: {
        status: { in: ["Ready", "Scheduled", "Queued"] },
        autoExecute: true,
      },
    },
    include: {
      task: {
        select: {
          id: true,
          workspaceId: true,
          status: true,
          autoExecute: true,
          executionRuntime: true,
        },
      },
    },
    orderBy: [{ scheduledStartAt: "asc" }, { task: { priority: "desc" } }],
  });

  const result: AutoStartScheduledPlanResult = {
    started: [],
    skipped: [],
    failed: [],
    now: now.toISOString(),
  };

  for (const block of dueWorkBlocks) {
    const task = block.task;
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
            executionRuntime: task.executionRuntime,
          },
          workBlock: { scheduledStartAt: block.scheduledStartAt },
          now,
          activeRun: activeRun ? { status: activeRun.status } : null,
        });

      if (!eligibility.ok) {
        result.skipped.push({ taskId: task.id, workBlockId: block.id, reason: eligibility.reason });

        await appendCanonicalEvent({
          eventType: "task.auto_start.skipped",
          workspaceId: task.workspaceId,
          taskId: task.id,
          actorType: "system",
          actorId: "auto-start-scheduler",
          source: "scheduler",
            payload: {
              reason: eligibility.reason,
              workBlockId: block.id,
              scheduledStartAt: block.scheduledStartAt?.toISOString() ?? null,
            },
          dedupeKey: `task.auto_start.skipped:${task.id}:${now.toISOString().slice(0, 13)}`,
        });

        publishTaskWorkspaceUpdatedEvent({
          taskId: task.id,
          workspaceId: task.workspaceId,
          reason: "task.auto_start.skipped",
        });
        continue;
      }

      await db.workBlock.update({
        where: { id: block.id },
        data: { status: "Active", startedAt: now },
      });

      const startedRun = await taskPlanExecution.start({ taskId: task.id, trigger: "scheduler" });
      result.started.push({ taskId: task.id, workBlockId: block.id, runId: startedRun.planId ?? task.id });
    } catch (parentError) {
      const message = parentError instanceof Error ? parentError.message : "Unknown error during auto-start";
      result.failed.push({ taskId: task.id, workBlockId: block.id, error: message });
    }
  }

  return result;
}
