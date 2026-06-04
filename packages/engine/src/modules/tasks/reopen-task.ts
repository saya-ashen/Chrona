import { Prisma, TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";
import { getAcceptedCompiledPlanForTask } from "@/modules/plan-execution/persistence/execution-scope";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import { getRuntimeTaskConfigSpec } from "@/modules/task-execution/registry";
import { deriveTaskStaticState } from "@chrona/domain";

export async function reopenTask(input: { taskId: string }) {
  const task = await db.task.findUniqueOrThrow({
    where: { id: input.taskId },
    include: {
      workspace: {
        select: { defaultRuntime: true },
      },
    },
  });
  const acceptedPlan = await getAcceptedCompiledPlanForTask(task.id);
  const staticState = deriveTaskStaticState({
    runtimeSpec: getRuntimeTaskConfigSpec(task.executionRuntime),
    executionConfig: task.executionConfig,
    hasAcceptedPlan: acceptedPlan !== null,
  });
  const nextStatus = TaskStatus[staticState.persistedStatus];

  await db.task.update({
    where: { id: task.id },
    data: {
      status: nextStatus,
      completedAt: null,
      blockReason: Prisma.DbNull,
    },
  });

  await appendCanonicalEvent({
    eventType: "task.reopened",
    workspaceId: task.workspaceId,
    taskId: task.id,
    workBlockId: null,
    actorType: "user",
    actorId: "server-action",
    source: "ui",
    payload: {
      previous_status: task.status,
      next_status: nextStatus,
    },
    dedupeKey: `task.reopened:${task.id}:${Date.now()}`,
  });

  await rebuildTaskProjection(task.id);

  return {
    taskId: task.id,
    workspaceId: task.workspaceId,
    status: nextStatus,
  };
}
