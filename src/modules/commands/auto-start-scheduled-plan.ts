import { db } from "@/lib/db";
import { startRun } from "@/modules/commands/start-run";
import { materializeTaskPlan } from "@/modules/commands/materialize-task-plan";
import { getAcceptedTaskPlanGraph, getReadyAutoRunnableNodes } from "@/modules/tasks/task-plan-graph-store";

function readSessionStrategy(value: unknown): "shared" | "per_subtask" {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const raw = (value as { sessionStrategy?: unknown }).sessionStrategy;
    if (raw === "shared") {
      return "shared";
    }
  }
  return "per_subtask";
}

export async function autoStartScheduledPlanTasks(input?: { now?: Date }) {
  const now = input?.now ?? new Date();
  const dueTasks = await db.task.findMany({
    where: {
      scheduleStatus: "Scheduled",
      scheduledStartAt: { lte: now },
      status: { in: ["Ready", "Scheduled", "Queued"] },
    },
    orderBy: [{ scheduledStartAt: "asc" }, { priority: "desc" }],
  });

  const startedTaskIds: string[] = [];

  for (const task of dueTasks) {
    const existingRunning = await db.run.findFirst({
      where: {
        taskId: task.id,
        status: { in: ["Pending", "Running", "WaitingForInput", "WaitingForApproval"] },
      },
      orderBy: { createdAt: "desc" },
    });

    if (existingRunning) {
      continue;
    }

    await startRun({ taskId: task.id });
    startedTaskIds.push(task.id);

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

      await startRun({ taskId: childTask.id });
      startedTaskIds.push(childTask.id);
    }
  }

  return { startedTaskIds, now: now.toISOString() };
}
