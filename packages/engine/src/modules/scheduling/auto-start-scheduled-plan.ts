import { db } from "@/lib/db";
import { taskPlanExecution } from "@/modules/plan-execution";
import { TaskPlanStatus } from "@/generated/prisma/client";
import { deriveAutoStartEligibility } from "@/modules/scheduling/derive-auto-start-eligibility";
import { appendCanonicalEvent } from "@/modules/events";
import { publishTaskWorkspaceUpdatedEvent } from "@/modules/projections/task-projection-events";
import { AUTOMATION_TIMING_PRESETS, automationTimingOffsetMs } from "@chrona/contracts";

const MAX_AUTOMATION_TIMING_OFFSET_MS = Math.max(
  ...AUTOMATION_TIMING_PRESETS.map((preset) => automationTimingOffsetMs(preset)),
);

export type AutoStartScheduledPlanResult = {
  started: Array<{ taskId: string; workBlockId: string; runId: string }>;
  skipped: Array<{ taskId: string; workBlockId: string; reason: string }>;
  failed: Array<{ taskId: string; workBlockId: string; error: string }>;
  now: string;
};

export async function autoStartScheduledPlanTasks(input?: { now?: Date }): Promise<AutoStartScheduledPlanResult> {
  const now = input?.now ?? new Date();
  const windowUpperBound = new Date(now.getTime() + MAX_AUTOMATION_TIMING_OFFSET_MS);
  const dueWorkBlocks = await db.workBlock.findMany({
    where: {
      status: "Scheduled",
      scheduledStartAt: { lte: windowUpperBound },
      task: {
        status: { in: ["Draft", "Ready", "Scheduled", "Queued"] },
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
          autoExecuteTiming: true,
          executionRuntime: true,
          taskPlans: {
            where: { status: TaskPlanStatus.Accepted },
            select: { id: true },
            take: 1,
          },
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
            hasAcceptedPlan: task.taskPlans.length > 0,
            autoExecuteTiming: task.autoExecuteTiming,
          },
          workBlock: { scheduledStartAt: block.scheduledStartAt },
          now,
          activeRun: activeRun ? { status: activeRun.status } : null,
        });

      if (!eligibility.ok) {
        result.skipped.push({ taskId: task.id, workBlockId: block.id, reason: eligibility.disabledReason });

        // `not_due` is the expected steady state for blocks inside the widened
        // look-ahead window; emitting a canonical event every tick would flood
        // the log, so only record actionable skip reasons.
        if (eligibility.reason === "not_due") {
          continue;
        }

        await appendCanonicalEvent({
          eventType: "task.auto_start.skipped",
          workspaceId: task.workspaceId,
          taskId: task.id,
          workBlockId: block.id,
          actorType: "system",
          actorId: "auto-start-scheduler",
          source: "scheduler",
            payload: {
              reason: eligibility.reason,
              disabledReason: eligibility.disabledReason,
              workBlockId: block.id,
              scheduledStartAt: block.scheduledStartAt?.toISOString() ?? null,
            },
          dedupeKey: `task.auto_start.skipped:${task.id}:${now.toISOString().slice(0, 13)}`,
        });

        publishTaskWorkspaceUpdatedEvent({
          taskId: task.id,
          workspaceId: task.workspaceId,
          workBlockId: block.id,
          reason: "task.auto_start.skipped",
        });
        continue;
      }

      await db.workBlock.update({
        where: { id: block.id },
        data: { status: "Active", startedAt: now },
      });

      const startedRun = await taskPlanExecution.start({ taskId: task.id, trigger: "scheduler", workBlockId: block.id });
      result.started.push({ taskId: task.id, workBlockId: block.id, runId: startedRun.planId ?? task.id });
    } catch (parentError) {
      const message = parentError instanceof Error ? parentError.message : "Unknown error during auto-start";
      result.failed.push({ taskId: task.id, workBlockId: block.id, error: message });
    }
  }

  return result;
}
