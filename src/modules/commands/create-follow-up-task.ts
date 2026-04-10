import { Prisma, TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import { deriveTaskRunnability } from "@/modules/tasks/derive-task-runnability";

function normalizeTitle(value: string) {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error("title is required");
  }

  return normalized;
}

export async function createFollowUpTask(input: {
  taskId: string;
  title: string;
  dueAt?: Date | null;
  priority?: "Low" | "Medium" | "High" | "Urgent";
}) {
  const parentTask = await db.task.findUniqueOrThrow({
    where: { id: input.taskId },
    include: {
      workspace: {
        select: { defaultRuntime: true },
      },
    },
  });
  const title = normalizeTitle(input.title);
  const runnability = deriveTaskRunnability({
    runtimeAdapterKey: parentTask.runtimeAdapterKey,
    workspaceDefaultRuntime: parentTask.workspace.defaultRuntime,
    runtimeInput: parentTask.runtimeInput,
    runtimeModel: parentTask.runtimeModel,
    prompt: parentTask.prompt,
    runtimeConfig: parentTask.runtimeConfig,
  });

  const status = runnability.isRunnable ? TaskStatus.Ready : TaskStatus.Draft;
  const followUp = await db.task.create({
    data: {
      workspaceId: parentTask.workspaceId,
      parentTaskId: parentTask.id,
      title,
      runtimeAdapterKey: parentTask.runtimeAdapterKey,
      runtimeInput:
        parentTask.runtimeInput === null
          ? Prisma.DbNull
          : (parentTask.runtimeInput as Prisma.InputJsonValue),
      runtimeInputVersion: parentTask.runtimeInputVersion,
      runtimeModel: parentTask.runtimeModel,
      prompt: parentTask.prompt,
      runtimeConfig:
        parentTask.runtimeConfig === null
          ? Prisma.DbNull
          : (parentTask.runtimeConfig as Prisma.InputJsonValue),
      status,
      priority: input.priority ?? parentTask.priority,
      ownerType: parentTask.ownerType,
      dueAt: input.dueAt ?? null,
      scheduleStatus: "Unscheduled",
    },
  });

  await appendCanonicalEvent({
    eventType: "task.created",
    workspaceId: followUp.workspaceId,
    taskId: followUp.id,
    actorType: "user",
    actorId: "server-action",
    source: "ui",
    payload: {
      title: followUp.title,
      priority: followUp.priority,
      status: followUp.status,
      parent_task_id: parentTask.id,
    },
    dedupeKey: `task.created:${followUp.id}`,
  });

  await appendCanonicalEvent({
    eventType: "task.follow_up_created",
    workspaceId: parentTask.workspaceId,
    taskId: parentTask.id,
    actorType: "user",
    actorId: "server-action",
    source: "ui",
    payload: {
      follow_up_task_id: followUp.id,
      follow_up_title: followUp.title,
      follow_up_status: followUp.status,
      follow_up_schedule_status: "Unscheduled",
    },
    dedupeKey: `task.follow_up_created:${parentTask.id}:${followUp.id}`,
  });

  await rebuildTaskProjection(followUp.id);
  await rebuildTaskProjection(parentTask.id);

  return {
    taskId: parentTask.id,
    workspaceId: parentTask.workspaceId,
    followUpTaskId: followUp.id,
  };
}
