import { OwnerType, Prisma, TaskPriority, TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import { deriveTaskRunnability } from "@/modules/tasks/derive-task-runnability";

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

export async function createTask(input: {
  workspaceId: string;
  title: string;
  description?: string | null;
  priority?: "Low" | "Medium" | "High" | "Urgent";
  dueAt?: Date | null;
  runtimeModel?: string | null;
  prompt?: string | null;
  runtimeConfig?: Prisma.InputJsonObject | null;
}) {
  const title = input.title.trim();
  const description = input.description?.trim() || null;
  const runtimeModel = normalizeOptionalTextField(input.runtimeModel, "runtimeModel");
  const prompt = normalizeOptionalTextField(input.prompt, "prompt");
  const runtimeConfig = normalizeRuntimeConfig(input.runtimeConfig);

  if (!title) {
    throw new Error("title is required");
  }

  const runnability = deriveTaskRunnability({
    runtimeModel,
    prompt,
    runtimeConfig: input.runtimeConfig,
  });
  const status = runnability.isRunnable ? TaskStatus.Ready : TaskStatus.Draft;

  const task = await db.task.create({
    data: {
      workspaceId: input.workspaceId,
      title,
      description,
      ...(runtimeModel !== undefined ? { runtimeModel } : {}),
      ...(prompt !== undefined ? { prompt } : {}),
      ...(runtimeConfig !== undefined ? { runtimeConfig } : {}),
      priority: input.priority ? TaskPriority[input.priority] : TaskPriority.Medium,
      status,
      ownerType: OwnerType.human,
      dueAt: input.dueAt ?? null,
    },
  });

  await appendCanonicalEvent({
    eventType: "task.created",
    workspaceId: task.workspaceId,
    taskId: task.id,
    actorType: "user",
    actorId: "server-action",
    source: "ui",
    payload: {
      title: task.title,
      priority: task.priority,
      status: task.status,
    },
    dedupeKey: `task.created:${task.id}`,
  });

  await rebuildTaskProjection(task.id);

  return {
    taskId: task.id,
    workspaceId: task.workspaceId,
  };
}
