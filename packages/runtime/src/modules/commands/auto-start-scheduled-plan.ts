import { db } from "@/lib/db";
import { startRun } from "@/modules/commands/start-run";
import { materializeTaskPlan } from "@/modules/commands/materialize-task-plan";
import { getAcceptedTaskPlanGraph, getReadyAutoRunnableNodes } from "@/modules/tasks/task-plan-graph-store";
import { deriveAutoStartEligibility } from "@/modules/tasks/derive-auto-start-eligibility";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";

function readSessionStrategy(value: unknown): "shared" | "per_subtask" {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const raw = (value as { sessionStrategy?: unknown }).sessionStrategy;
    if (raw === "shared") {
      return "shared";
    }
  }
  return "per_subtask";
}

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

      const startedRun = await startRun({ taskId: task.id, triggeredBy: "scheduler" });
      result.started.push({ taskId: task.id, runId: startedRun.runId });

      const acceptedPlan = await getAcceptedTaskPlanGraph(task.id);
      if (!acceptedPlan) {
        continue;
      }

      const readyNodes = getReadyAutoRunnableNodes(acceptedPlan.plan);
      if (readyNodes.length === 0) {
        continue;
      }

      const materialized = await materializeTaskPlan({ taskId: task.id });
      if (materialized.createdTaskIds.length === 0) {
        continue;
      }

      const childTasks = await db.task.findMany({
        where: { id: { in: materialized.createdTaskIds } },
        orderBy: { createdAt: "asc" },
      });

      const strategy = readSessionStrategy(task.runtimeConfig);
      for (const childTask of childTasks) {
        try {
          if (strategy === "shared") {
            await db.task.update({
              where: { id: childTask.id },
              data: { defaultSessionId: task.defaultSessionId },
            });
          } else {
            const session = await db.taskSession.create({
              data: {
                taskId: childTask.id,
                runtimeName: childTask.runtimeAdapterKey ?? task.runtimeAdapterKey ?? "openclaw",
                sessionKey: `chrona:${childTask.runtimeAdapterKey ?? task.runtimeAdapterKey ?? "openclaw"}:task:${childTask.id}:subtask`,
                label: `${childTask.title} · Subtask session`,
                createdByFramework: true,
              },
            });
            await db.task.update({
              where: { id: childTask.id },
              data: { defaultSessionId: session.id },
            });
          }

          const childRun = await startRun({ taskId: childTask.id, triggeredBy: "scheduler" });
          result.started.push({ taskId: childTask.id, runId: childRun.runId });
        } catch (childError) {
          const message = childError instanceof Error ? childError.message : "Unknown error starting child task";
          result.failed.push({ taskId: childTask.id, error: message });
        }
      }
    } catch (parentError) {
      const message = parentError instanceof Error ? parentError.message : "Unknown error during auto-start";
      result.failed.push({ taskId: task.id, error: message });
    }
  }

  return result;
}
