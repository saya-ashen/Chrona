import { OwnerType, Prisma, TaskPriority, TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import { enqueueTaskPlanGeneration } from "@/modules/commands/queue-task-plan-generation";
import { ensureDefaultTaskSession } from "@/modules/task-execution/task-sessions";
import { validateTaskRuntimeConfig } from "@/modules/task-execution/task-config";
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
  parentTaskId?: string | null;
  dueAt?: Date | null;
  runtimeAdapterKey?: string | null;
  runtimeInput?: Prisma.InputJsonObject | null;
  runtimeInputVersion?: string | null;
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

  const workspace = await db.workspace.findUniqueOrThrow({
    where: { id: input.workspaceId },
    select: { defaultRuntime: true },
  });

  if (input.parentTaskId) {
    const parentTask = await db.task.findUnique({
      where: { id: input.parentTaskId },
      select: { id: true, workspaceId: true },
    });

    if (!parentTask || parentTask.workspaceId !== input.workspaceId) {
      throw new Error("parentTaskId must reference a task in the same workspace");
    }
  }

  const validatedRuntimeConfig = validateTaskRuntimeConfig({
    runtimeAdapterKey: input.runtimeAdapterKey,
    workspaceDefaultRuntime: workspace.defaultRuntime,
    runtimeInput: input.runtimeInput,
    runtimeInputIsAuthoritative: input.runtimeInput !== undefined,
    runtimeInputVersion: input.runtimeInputVersion,
    runtimeModel,
    prompt,
    runtimeConfig,
  });

  const runnability = deriveTaskRunnability({
    runtimeAdapterKey: validatedRuntimeConfig.runtimeAdapterKey,
    runtimeInput: validatedRuntimeConfig.runtimeInput,
    runtimeModel: validatedRuntimeConfig.runtimeModel,
    prompt: validatedRuntimeConfig.prompt,
    runtimeConfig: validatedRuntimeConfig.runtimeConfig,
  });
  const status = runnability.isRunnable ? TaskStatus.Ready : TaskStatus.Draft;

  const task = await db.task.create({
    data: {
      workspaceId: input.workspaceId,
      title,
      description,
      runtimeAdapterKey: validatedRuntimeConfig.runtimeAdapterKey,
      runtimeInput: validatedRuntimeConfig.runtimeInput as Prisma.InputJsonObject,
      runtimeInputVersion: validatedRuntimeConfig.runtimeInputVersion,
      runtimeModel: validatedRuntimeConfig.runtimeModel,
      prompt: validatedRuntimeConfig.prompt,
      runtimeConfig:
        validatedRuntimeConfig.runtimeConfig === null
          ? Prisma.DbNull
          : (validatedRuntimeConfig.runtimeConfig as Prisma.InputJsonObject),
      priority: input.priority ? TaskPriority[input.priority] : TaskPriority.Medium,
      status,
      ownerType: OwnerType.human,
      parentTaskId: input.parentTaskId ?? null,
      dueAt: input.dueAt ?? null,
    },
  });

  if (input.parentTaskId) {
    await db.taskDependency.upsert({
      where: {
        taskId_dependsOnTaskId: {
          taskId: task.id,
          dependsOnTaskId: input.parentTaskId,
        },
      },
      create: {
        workspaceId: task.workspaceId,
        taskId: task.id,
        dependsOnTaskId: input.parentTaskId,
        dependencyType: "child_of",
      },
      update: {
        dependencyType: "child_of",
      },
    });
  }

  await ensureDefaultTaskSession({
    taskId: task.id,
    taskTitle: task.title,
    runtimeName: validatedRuntimeConfig.runtimeAdapterKey,
    defaultSessionId: task.defaultSessionId,
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
      parentTaskId: task.parentTaskId,
    },
    dedupeKey: `task.created:${task.id}`,
  });

  await rebuildTaskProjection(task.id);

  enqueueTaskPlanGeneration({ taskId: task.id, reason: "task_created" });

  return {
    taskId: task.id,
    workspaceId: task.workspaceId,
  };
}
