import { Prisma, TaskPriority, TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import { deriveTaskRunnability } from "@/modules/tasks/derive-task-runnability";
import { validateScheduleWindow } from "@/modules/tasks/validate-schedule-window";

function normalizeOptionalTextField(value: string | null | undefined, field: string) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`${field} cannot be empty`);
  }

  return normalized;
}

function normalizeRequiredUpdateTextField(value: string | undefined, field: string) {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`${field} cannot be empty`);
  }

  return normalized;
}

function normalizeRuntimeConfig(value: Prisma.InputJsonObject | null | undefined) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return Prisma.DbNull;
  }

  if (Array.isArray(value)) {
    throw new Error("runtimeConfig must be an object");
  }

  return value;
}

export async function updateTask(input: {
  taskId: string;
  title?: string;
  description?: string | null;
  priority?: "Low" | "Medium" | "High" | "Urgent";
  dueAt?: Date | null;
  scheduledStartAt?: Date | null;
  scheduledEndAt?: Date | null;
  runtimeModel?: string | null;
  prompt?: string | null;
  runtimeConfig?: Prisma.InputJsonObject | null;
}) {
  const title = normalizeRequiredUpdateTextField(input.title, "title");
  const description =
    input.description === undefined ? undefined : input.description?.trim() || null;
  const runtimeModel = normalizeOptionalTextField(input.runtimeModel, "runtimeModel");
  const prompt = normalizeOptionalTextField(input.prompt, "prompt");
  const runtimeConfig = normalizeRuntimeConfig(input.runtimeConfig);
  const currentTask = await db.task.findUniqueOrThrow({ where: { id: input.taskId } });
  validateScheduleWindow({
    scheduledStartAt:
      input.scheduledStartAt === undefined ? currentTask.scheduledStartAt : input.scheduledStartAt,
    scheduledEndAt:
      input.scheduledEndAt === undefined ? currentTask.scheduledEndAt : input.scheduledEndAt,
  });
  const nextRuntimeModel = runtimeModel === undefined ? currentTask.runtimeModel : runtimeModel;
  const nextPrompt = prompt === undefined ? currentTask.prompt : prompt;
  const nextRuntimeConfig = input.runtimeConfig === undefined ? currentTask.runtimeConfig : input.runtimeConfig;
  const runnability = deriveTaskRunnability({
    runtimeModel: nextRuntimeModel,
    prompt: nextPrompt,
    runtimeConfig: nextRuntimeConfig,
  });
  const shouldManageStatus =
    currentTask.status === TaskStatus.Draft || currentTask.status === TaskStatus.Ready;
  const nextStatus = shouldManageStatus
    ? runnability.isRunnable
      ? TaskStatus.Ready
      : TaskStatus.Draft
    : undefined;

  const changedFields = [
    input.title !== undefined ? "title" : null,
    input.description !== undefined ? "description" : null,
    input.priority !== undefined ? "priority" : null,
    input.dueAt !== undefined ? "dueAt" : null,
    input.scheduledStartAt !== undefined ? "scheduledStartAt" : null,
    input.scheduledEndAt !== undefined ? "scheduledEndAt" : null,
    input.runtimeModel !== undefined ? "runtimeModel" : null,
    input.prompt !== undefined ? "prompt" : null,
    input.runtimeConfig !== undefined ? "runtimeConfig" : null,
  ].filter((field): field is string => field !== null);

  const task = await db.task.update({
    where: { id: input.taskId },
    data: {
      title,
      description,
      priority: input.priority ? TaskPriority[input.priority] : undefined,
      dueAt: input.dueAt,
      scheduledStartAt: input.scheduledStartAt,
      scheduledEndAt: input.scheduledEndAt,
      runtimeModel,
      prompt,
      runtimeConfig,
      status: nextStatus,
    },
  });

  await appendCanonicalEvent({
    eventType: "task.updated",
    workspaceId: task.workspaceId,
    taskId: task.id,
    actorType: "user",
    actorId: "server-action",
    source: "ui",
    payload: {
      changed_fields: changedFields,
    },
    dedupeKey: `task.updated:${task.id}:${task.updatedAt.toISOString()}`,
  });

  await rebuildTaskProjection(task.id);

  return {
    taskId: task.id,
    workspaceId: task.workspaceId,
  };
}
