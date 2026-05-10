import { Prisma, TaskPriority, TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import { validateTaskRuntimeConfig } from "@/modules/task-execution/task-config";
import type { UpdateTaskInput } from "@chrona/contracts";

function normalizeRequiredUpdateTextField(
  value: string | undefined,
  field: string,
) {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`${field} cannot be empty`);
  }

  return normalized;
}

function normalizeExecutionConfig(
  value: Prisma.InputJsonObject | null | undefined,
) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || Array.isArray(value)) {
    throw new Error("executionConfig must be an object");
  }

  return value;
}

function mergeSessionStrategyIntoExecutionConfig(
  executionConfig: Prisma.InputJsonObject | null | undefined,
  sessionStrategy: "shared" | "per_subtask" | null | undefined,
) {
  if (sessionStrategy === undefined) {
    return executionConfig;
  }

  const nextConfig = executionConfig ? { ...executionConfig } : {};
  if (sessionStrategy === null) {
    delete nextConfig.sessionStrategy;
  } else {
    nextConfig.sessionStrategy = sessionStrategy;
  }

  return Object.keys(nextConfig).length > 0 ? nextConfig : null;
}

export async function updateTask(
  input: UpdateTaskInput & {
    sessionStrategy?: "shared" | "per_subtask" | null;
  },
) {
  const title = normalizeRequiredUpdateTextField(input.title, "title");
  const description =
    input.description === undefined
      ? undefined
      : input.description?.trim() || null;
  const executionConfig = normalizeExecutionConfig(
    input.executionConfig as Prisma.InputJsonObject | null | undefined,
  );
  const currentTask = await db.task.findUniqueOrThrow({
    where: { id: input.taskId },
    include: {
      workspace: {
        select: { defaultRuntime: true },
      },
    },
  });
  const baseExecutionConfig =
    input.executionConfig === undefined
      ? currentTask.executionConfig
      : input.executionConfig;
  const nextExecutionConfig = mergeSessionStrategyIntoExecutionConfig(
    baseExecutionConfig as Prisma.InputJsonObject | null | undefined,
    input.sessionStrategy,
  );
  const validatedRuntimeConfig = validateTaskRuntimeConfig({
    executionRuntime:
      input.executionRuntime === undefined
        ? currentTask.executionRuntime
        : input.executionRuntime,
    workspaceDefaultRuntime: currentTask.workspace.defaultRuntime,
    executionConfig: nextExecutionConfig,
  });
  const nextStatus = (() => {
    if (input.status) {
      return TaskStatus[input.status];
    }

    const shouldManageStatus =
      currentTask.status === TaskStatus.Draft ||
      currentTask.status === TaskStatus.Ready;

    if (!shouldManageStatus) {
      return undefined;
    }

    // FIXME:
    return TaskStatus.Ready;
  })();
  const shouldPersistResolvedRuntimeConfig =
    input.executionRuntime !== undefined ||
    input.executionConfig !== undefined ||
    input.sessionStrategy !== undefined;

  const changedFields = [
    input.title !== undefined ? "title" : null,
    input.description !== undefined ? "description" : null,
    input.priority !== undefined ? "priority" : null,
    input.status !== undefined ? "status" : null,
    input.executionRuntime !== undefined ? "executionRuntime" : null,
    input.executionConfig !== undefined ? "executionConfig" : null,
    input.sessionStrategy !== undefined ? "executionConfig" : null,
  ].filter((field): field is string => field !== null);

  const task = await db.task.update({
    where: { id: input.taskId },
    data: {
      title,
      description,
      priority: input.priority ? TaskPriority[input.priority] : undefined,
      executionRuntime: shouldPersistResolvedRuntimeConfig
        ? validatedRuntimeConfig.executionRuntime
        : undefined,
      executionConfig: shouldPersistResolvedRuntimeConfig
        ? (validatedRuntimeConfig.executionConfig as Prisma.InputJsonObject)
        : executionConfig,
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
