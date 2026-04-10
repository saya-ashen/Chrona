import { Prisma, TaskPriority, TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import { getRuntimeTaskConfigSpec, resolveRuntimeAdapterKey } from "@/modules/runtime/registry";
import { validateTaskRuntimeConfig } from "@/modules/runtime/task-config";
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

function isRuntimeObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stripSyncedRuntimeConfigKeys(runtimeInput: unknown, previousRuntimeConfig: unknown) {
  if (!isRuntimeObject(runtimeInput)) {
    return runtimeInput;
  }

  const nextRuntimeInput = { ...runtimeInput };

  if (isRuntimeObject(previousRuntimeConfig)) {
    for (const key of Object.keys(previousRuntimeConfig)) {
      delete nextRuntimeInput[key];
    }
  }

  return nextRuntimeInput;
}

function adapterSpecHasFieldPath(adapterKey: string, path: string) {
  return getRuntimeTaskConfigSpec(adapterKey).fields.some((field) => field.path === path);
}

export async function updateTask(input: {
  taskId: string;
  title?: string;
  description?: string | null;
  priority?: "Low" | "Medium" | "High" | "Urgent";
  dueAt?: Date | null;
  scheduledStartAt?: Date | null;
  scheduledEndAt?: Date | null;
  runtimeAdapterKey?: string | null;
  runtimeInput?: Prisma.InputJsonObject | null;
  runtimeInputVersion?: string | null;
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
  const currentTask = await db.task.findUniqueOrThrow({
    where: { id: input.taskId },
    include: {
      workspace: {
        select: { defaultRuntime: true },
      },
    },
  });
  validateScheduleWindow({
    scheduledStartAt:
      input.scheduledStartAt === undefined ? currentTask.scheduledStartAt : input.scheduledStartAt,
    scheduledEndAt:
      input.scheduledEndAt === undefined ? currentTask.scheduledEndAt : input.scheduledEndAt,
  });
  const nextRuntimeModel = runtimeModel === undefined ? currentTask.runtimeModel : runtimeModel;
  const nextPrompt = prompt === undefined ? currentTask.prompt : prompt;
  const nextRuntimeConfig =
    input.runtimeConfig === undefined ? currentTask.runtimeConfig : input.runtimeConfig;
  const nextRuntimeAdapterKeyInput =
    input.runtimeAdapterKey === undefined ? currentTask.runtimeAdapterKey : input.runtimeAdapterKey;
  const currentResolvedRuntimeAdapterKey = resolveRuntimeAdapterKey({
    runtimeAdapterKey: currentTask.runtimeAdapterKey,
    workspaceDefaultRuntime: currentTask.workspace.defaultRuntime,
  });
  const nextResolvedRuntimeAdapterKey = resolveRuntimeAdapterKey({
    runtimeAdapterKey: nextRuntimeAdapterKeyInput,
    workspaceDefaultRuntime: currentTask.workspace.defaultRuntime,
  });
  const adapterChanged = nextResolvedRuntimeAdapterKey !== currentResolvedRuntimeAdapterKey;
  const nextAdapterSupportsModel = adapterSpecHasFieldPath(nextResolvedRuntimeAdapterKey, "model");
  const nextAdapterSupportsPrompt = adapterSpecHasFieldPath(nextResolvedRuntimeAdapterKey, "prompt");
  const nextRuntimeInputBase =
    input.runtimeInput !== undefined
      ? input.runtimeInput
      : adapterChanged
        ? undefined
      : input.runtimeConfig === undefined
        ? currentTask.runtimeInput
        : stripSyncedRuntimeConfigKeys(currentTask.runtimeInput, currentTask.runtimeConfig);
  const nextRuntimeInputVersion =
    input.runtimeInputVersion !== undefined
      ? input.runtimeInputVersion
      : input.runtimeAdapterKey !== undefined && input.runtimeAdapterKey !== currentTask.runtimeAdapterKey
        ? undefined
        : currentTask.runtimeInputVersion;
  const validatedRuntimeConfig = validateTaskRuntimeConfig({
    runtimeAdapterKey: nextRuntimeAdapterKeyInput,
    workspaceDefaultRuntime: currentTask.workspace.defaultRuntime,
    runtimeInput: nextRuntimeInputBase,
    runtimeInputIsAuthoritative: input.runtimeInput !== undefined,
    runtimeInputVersion: nextRuntimeInputVersion,
    runtimeModel:
      input.runtimeInput !== undefined
        ? runtimeModel
        : adapterChanged && !nextAdapterSupportsModel
          ? runtimeModel
          : nextRuntimeModel,
    prompt:
      input.runtimeInput !== undefined
        ? prompt
        : adapterChanged && !nextAdapterSupportsPrompt
          ? prompt
          : nextPrompt,
    runtimeConfig: input.runtimeInput !== undefined || adapterChanged ? runtimeConfig : nextRuntimeConfig,
  });
  const runnability = deriveTaskRunnability({
    runtimeAdapterKey: validatedRuntimeConfig.runtimeAdapterKey,
    runtimeInput: validatedRuntimeConfig.runtimeInput,
    runtimeModel: validatedRuntimeConfig.runtimeModel,
    prompt: validatedRuntimeConfig.prompt,
    runtimeConfig: validatedRuntimeConfig.runtimeConfig,
  });
  const shouldManageStatus =
    currentTask.status === TaskStatus.Draft || currentTask.status === TaskStatus.Ready;
  const nextStatus = shouldManageStatus
    ? runnability.isRunnable
      ? TaskStatus.Ready
      : TaskStatus.Draft
    : undefined;
  const shouldPersistResolvedRuntimeConfig =
    input.runtimeInput !== undefined ||
    input.runtimeAdapterKey !== undefined ||
    input.runtimeInputVersion !== undefined ||
    input.runtimeModel !== undefined ||
    input.prompt !== undefined ||
    input.runtimeConfig !== undefined;

  const changedFields = [
    input.title !== undefined ? "title" : null,
    input.description !== undefined ? "description" : null,
    input.priority !== undefined ? "priority" : null,
    input.dueAt !== undefined ? "dueAt" : null,
    input.scheduledStartAt !== undefined ? "scheduledStartAt" : null,
    input.scheduledEndAt !== undefined ? "scheduledEndAt" : null,
    input.runtimeAdapterKey !== undefined ? "runtimeAdapterKey" : null,
    input.runtimeInput !== undefined ? "runtimeInput" : null,
    input.runtimeInputVersion !== undefined ? "runtimeInputVersion" : null,
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
      runtimeAdapterKey: shouldPersistResolvedRuntimeConfig
        ? validatedRuntimeConfig.runtimeAdapterKey
        : undefined,
      runtimeInput:
        !shouldPersistResolvedRuntimeConfig
          ? undefined
          : (validatedRuntimeConfig.runtimeInput as Prisma.InputJsonObject),
      runtimeInputVersion: shouldPersistResolvedRuntimeConfig
        ? validatedRuntimeConfig.runtimeInputVersion
        : undefined,
      runtimeModel: shouldPersistResolvedRuntimeConfig ? validatedRuntimeConfig.runtimeModel : runtimeModel,
      prompt: shouldPersistResolvedRuntimeConfig ? validatedRuntimeConfig.prompt : prompt,
      runtimeConfig: shouldPersistResolvedRuntimeConfig
        ? validatedRuntimeConfig.runtimeConfig === null
          ? Prisma.DbNull
          : (validatedRuntimeConfig.runtimeConfig as Prisma.InputJsonObject)
        : runtimeConfig,
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
