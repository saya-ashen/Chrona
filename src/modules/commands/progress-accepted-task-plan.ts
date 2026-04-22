import { Prisma, TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { startRun } from "@/modules/commands/start-run";
import { materializeTaskPlan } from "@/modules/commands/materialize-task-plan";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import { ensureDefaultTaskSession } from "@/modules/task-execution/task-sessions";
import { getAcceptedTaskPlanGraph, getReadyAutoRunnableNodes } from "@/modules/tasks/task-plan-graph-store";

type SessionStrategy = "shared" | "per_subtask";

function readSessionStrategy(value: unknown): SessionStrategy {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const raw = (value as { sessionStrategy?: unknown }).sessionStrategy;
    if (raw === "shared") {
      return "shared";
    }
  }
  return "per_subtask";
}

function isTerminalStatus(status: string) {
  return status === "Completed" || status === "Done" || status === "Cancelled" || status === "Failed";
}

export async function progressAcceptedTaskPlan(input: { parentTaskId: string }) {
  const parentTask = await db.task.findUniqueOrThrow({
    where: { id: input.parentTaskId },
  });
  const acceptedPlan = await getAcceptedTaskPlanGraph(input.parentTaskId);
  if (!acceptedPlan) {
    return {
      parentTaskId: input.parentTaskId,
      startedTaskIds: [],
      materializedTaskIds: [],
      readyNodeIds: [],
      parentCompleted: false,
    };
  }

  const readyNodes = getReadyAutoRunnableNodes(acceptedPlan.plan).filter((node) => !node.linkedTaskId);
  const readyNodeIds = readyNodes.map((node) => node.id);

  let materializedTaskIds: string[] = [];
  let startedTaskIds: string[] = [];

  if (readyNodeIds.length > 0) {
    const materialized = await materializeTaskPlan({ taskId: input.parentTaskId });
    materializedTaskIds = materialized.createdTaskIds;

    if (materialized.createdTaskIds.length > 0) {
      const refreshedAfterMaterialize = await getAcceptedTaskPlanGraph(input.parentTaskId);
      const readyTaskIds = new Set(
        (refreshedAfterMaterialize?.plan.nodes ?? [])
          .filter((node) => readyNodeIds.includes(node.id) && node.linkedTaskId)
          .map((node) => node.linkedTaskId as string),
      );
      const childTasks = await db.task.findMany({
        where: { id: { in: materialized.createdTaskIds } },
        orderBy: { createdAt: "asc" },
      });

      const strategy = readSessionStrategy(parentTask.runtimeConfig);
      for (const childTask of childTasks) {
        if (!readyTaskIds.has(childTask.id)) {
          continue;
        }
        const existingRunning = await db.run.findFirst({
          where: {
            taskId: childTask.id,
            status: { in: ["Pending", "Running", "WaitingForInput", "WaitingForApproval"] },
          },
        });
        if (existingRunning) {
          continue;
        }

        if (strategy === "shared") {
          await db.task.update({
            where: { id: childTask.id },
            data: { defaultSessionId: parentTask.defaultSessionId },
          });
        } else {
          await ensureDefaultTaskSession({
            taskId: childTask.id,
            taskTitle: childTask.title,
            runtimeName: childTask.runtimeAdapterKey ?? parentTask.runtimeAdapterKey ?? "openclaw",
            defaultSessionId: childTask.defaultSessionId,
            suffix: "subtask",
            label: `${childTask.title} · Subtask session`,
          });
        }

        await startRun({ taskId: childTask.id });
        startedTaskIds.push(childTask.id);
      }
    }
  }

  const refreshedPlan = await getAcceptedTaskPlanGraph(input.parentTaskId);
  const allDone = Boolean(
    refreshedPlan &&
      refreshedPlan.plan.nodes.length > 0 &&
      refreshedPlan.plan.nodes.every((node) => node.status === "done" || node.status === "skipped"),
  );

  let parentCompleted = false;
  if (allDone && !isTerminalStatus(parentTask.status)) {
    await db.task.update({
      where: { id: input.parentTaskId },
      data: {
        status: TaskStatus.Completed,
        completedAt: new Date(),
        blockReason: Prisma.DbNull,
      },
    });
    await rebuildTaskProjection(input.parentTaskId);
    parentCompleted = true;
  }

  return {
    parentTaskId: input.parentTaskId,
    startedTaskIds,
    materializedTaskIds,
    readyNodeIds,
    parentCompleted,
  };
}
