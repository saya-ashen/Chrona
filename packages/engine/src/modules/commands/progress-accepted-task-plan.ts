import { Prisma, TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { startRun } from "@/modules/commands/start-run";
import { materializeTaskPlan } from "@/modules/commands/materialize-task-plan";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import { resolveRuntimeAdapterKey } from "@/modules/task-execution/registry";
import { ensureDefaultTaskSession } from "@/modules/task-execution/task-sessions";
import {
  getAcceptedCompiledPlan,
} from "@/modules/plan-execution/compiled-plan-store";
import { getLayers } from "@/modules/plan-execution/plan-run-store";
import { resolveEffectivePlanGraph } from "@chrona/domain";
import type { EffectivePlanGraph } from "@chrona/contracts/ai";

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

function deriveParentTaskStatusFromEffectivePlan(effective: EffectivePlanGraph): TaskStatus | null {
  if (effective.nodes.length === 0) return null;
  const anyBlocked = effective.nodes.some((n) => n.status === "blocked");
  if (anyBlocked) return TaskStatus.Blocked;
  const anyWaiting = effective.nodes.some((n) => n.status === "waiting_for_user");
  if (anyWaiting) return TaskStatus.WaitingForInput;
  const allDone = effective.nodes.every((n) => n.status === "completed" || n.status === "skipped");
  if (allDone) return TaskStatus.Completed;
  const anyRunning = effective.nodes.some((n) => n.status === "running");
  if (anyRunning) return TaskStatus.Running;
  const anyPending = effective.nodes.some((n) => n.status === "pending" || n.status === "ready");
  if (anyPending) return TaskStatus.Ready;
  return null;
}

export async function syncParentTaskStateFromAcceptedPlan(parentTaskId: string) {
  const accepted = await getAcceptedCompiledPlan(parentTaskId);
  const parentTask = await db.task.findUniqueOrThrow({ where: { id: parentTaskId } });

  if (!accepted) {
    return { parentCompleted: false, status: parentTask.status };
  }

  const planId = accepted.compiledPlan.editablePlanId;
  const layers = await getLayers(parentTaskId, planId);
  const effective = resolveEffectivePlanGraph(accepted.compiledPlan, layers);
  const nextStatus = deriveParentTaskStatusFromEffectivePlan(effective);
  if (!nextStatus) {
    return { parentCompleted: false, status: parentTask.status };
  }

  const shouldComplete = nextStatus === TaskStatus.Completed;
  await db.task.update({
    where: { id: parentTaskId },
    data: {
      status: nextStatus,
      completedAt: shouldComplete ? parentTask.completedAt ?? new Date() : null,
      blockReason: nextStatus === TaskStatus.Blocked ? (parentTask.blockReason ?? Prisma.DbNull) : Prisma.DbNull,
    },
  });
  await rebuildTaskProjection(parentTaskId);

  return { parentCompleted: shouldComplete, status: nextStatus };
}

export async function progressAcceptedTaskPlan(input: { parentTaskId: string }) {
  const parentTask = await db.task.findUniqueOrThrow({ where: { id: input.parentTaskId } });
  const accepted = await getAcceptedCompiledPlan(input.parentTaskId);

  if (!accepted) {
    return {
      parentTaskId: input.parentTaskId,
      startedTaskIds: [],
      materializedTaskIds: [],
      readyNodeIds: [],
      parentCompleted: false,
    };
  }

  const planId = accepted.compiledPlan.editablePlanId;
  const layers = await getLayers(input.parentTaskId, planId);
  const effective = resolveEffectivePlanGraph(accepted.compiledPlan, layers);

  // Find ready, auto-runnable, non-materialized nodes
  const readyAutoNodes = effective.nodes.filter(
    (n) => n.ready && !n.linkedTaskId,
  );
  const readyNodeIds = readyAutoNodes.map((n) => n.id);

  let materializedTaskIds: string[] = [];
  const startedTaskIds: string[] = [];

  if (readyNodeIds.length > 0) {
    const materialized = await materializeTaskPlan({ taskId: input.parentTaskId });
    materializedTaskIds = materialized.createdTaskIds;

    if (materialized.createdTaskIds.length > 0) {
      // Re-read layers after materialization (which may have appended layers)
      const refreshedLayers = await getLayers(input.parentTaskId, planId);
      const refreshedEffective = resolveEffectivePlanGraph(accepted.compiledPlan, refreshedLayers);
      const readyTaskIds = new Set(
        refreshedEffective.nodes
          .filter((n) => readyNodeIds.includes(n.id) && n.linkedTaskId)
          .map((n) => n.linkedTaskId as string),
      );

      const childTasks = await db.task.findMany({
        where: { id: { in: materialized.createdTaskIds } },
        orderBy: { createdAt: "asc" },
      });

      const strategy = readSessionStrategy(parentTask.runtimeConfig);
      for (const childTask of childTasks) {
        if (!readyTaskIds.has(childTask.id)) continue;

        const existingRunning = await db.run.findFirst({
          where: {
            taskId: childTask.id,
            status: { in: ["Pending", "Running", "WaitingForInput", "WaitingForApproval"] },
          },
        });
        if (existingRunning) continue;

        if (strategy === "shared") {
          await db.task.update({
            where: { id: childTask.id },
            data: { defaultSessionId: parentTask.defaultSessionId },
          });
        } else {
          await ensureDefaultTaskSession({
            taskId: childTask.id,
            taskTitle: childTask.title,
            runtimeName: resolveRuntimeAdapterKey({
              runtimeAdapterKey: childTask.runtimeAdapterKey ?? parentTask.runtimeAdapterKey,
            }),
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

  // Re-check completion after progression
  const finalLayers = await getLayers(input.parentTaskId, planId);
  const finalEffective = resolveEffectivePlanGraph(accepted.compiledPlan, finalLayers);
  const allDone = Boolean(
    finalEffective.nodes.length > 0 &&
    finalEffective.nodes.every((n) => n.status === "completed" || n.status === "skipped"),
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
  } else {
    const synced = await syncParentTaskStateFromAcceptedPlan(input.parentTaskId);
    parentCompleted = synced.parentCompleted;
  }

  return {
    parentTaskId: input.parentTaskId,
    startedTaskIds,
    materializedTaskIds,
    readyNodeIds,
    parentCompleted,
  };
}
