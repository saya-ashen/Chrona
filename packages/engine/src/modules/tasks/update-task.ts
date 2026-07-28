import { Prisma, TaskPriority, TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events";
import { getAcceptedCompiledPlanForTask } from "@/modules/plan-execution/persistence/execution-scope";
import { startAutoPlanGenerationForTask } from "@/modules/plans/auto-generate-task-plan";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import { validateTaskRuntimeConfig, ensureWorkBlockTaskSession, getRuntimeTaskConfigSpec } from "@/modules/execution-runtime";
import { deriveTaskStaticState } from "@chrona/domain";
import type { UpdateTaskInput } from "@chrona/contracts";
import { normalizeAutomationTiming } from "@chrona/contracts";
import { expandRecurrenceRule } from "@chrona/integrations";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";

const SELF_SERIES_WINDOW_DAYS = 180;
const SELF_SERIES_MAX_OCCURRENCES = 365;

function normalizeRequiredUpdateTextField(
  value: string | undefined,
  field: string,
) {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, `${field} cannot be empty`);
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
    throw new EngineError(
      ENGINE_ERROR_CODES.VALIDATION_FAILED,
      "executionConfig must be an object",
    );
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
  const importedCalendarEvent = await db.importedCalendarEvent.findFirst({
    where: { taskId: input.taskId },
    select: { title: true },
  });
  if (
    importedCalendarEvent &&
    title !== undefined &&
    title !== importedCalendarEvent.title
  ) {
    throw new Error("External calendar task title is managed by the calendar source");
  }
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
  const currentExecutionConfig = currentTask.executionConfig as Record<string, unknown>;
  const nextExecutionConfigRecord = validatedRuntimeConfig.executionConfig as Record<string, unknown>;
  const currentConfiguredModel = typeof currentExecutionConfig.model === "string"
    ? currentExecutionConfig.model.trim()
    : "";
  const nextConfiguredModel = typeof nextExecutionConfigRecord.model === "string"
    ? nextExecutionConfigRecord.model.trim()
    : "";
  const nextExecutionRuntime = input.executionRuntime === undefined
    ? currentTask.executionRuntime
    : input.executionRuntime;
  const nextAiClientId = input.aiClientId === undefined ? currentTask.aiClientId : input.aiClientId;
  const modelRoutingChanged = (
    input.executionConfig !== undefined && currentConfiguredModel !== nextConfiguredModel
  ) || nextExecutionRuntime !== currentTask.executionRuntime
    || nextAiClientId !== currentTask.aiClientId;
  const acceptedPlan = await getAcceptedCompiledPlanForTask(currentTask.id);
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

    const staticState = deriveTaskStaticState({
      runtimeSpec: getRuntimeTaskConfigSpec(validatedRuntimeConfig.executionRuntime),
      executionConfig: validatedRuntimeConfig.executionConfig,
      hasAcceptedPlan: acceptedPlan !== null,
    });

    return TaskStatus[staticState.persistedStatus];
  })();
  const shouldPersistResolvedRuntimeConfig =
    input.executionRuntime !== undefined ||
    input.executionConfig !== undefined ||
    input.sessionStrategy !== undefined;
  const nextAutoExecute = input.autoExecute ?? currentTask.autoExecute;
  const nextAutoPlanGeneration = input.autoPlanGeneration !== undefined
    ? input.autoPlanGeneration
    : nextAutoExecute
      ? true
      : currentTask.autoPlanGeneration;
  const nextAutoPlanGenerationTiming =
    input.autoPlanGenerationTiming !== undefined
      ? normalizeAutomationTiming(input.autoPlanGenerationTiming)
      : normalizeAutomationTiming(currentTask.autoPlanGenerationTiming);
  const nextAutoExecuteTiming =
    input.autoExecuteTiming !== undefined
      ? normalizeAutomationTiming(input.autoExecuteTiming)
      : normalizeAutomationTiming(currentTask.autoExecuteTiming);

  const nextRecurrenceRule = input.recurrenceRule === undefined
    ? currentTask.recurrenceRule
    : input.recurrenceRule?.trim() || null;
  const recurrenceChanged = input.recurrenceRule !== undefined;
  const shouldMaterializeRecurrence = Boolean(
    recurrenceChanged &&
    nextRecurrenceRule &&
    input.recurrenceAnchorStartAt &&
    input.recurrenceAnchorEndAt,
  );
  const recurrenceAnchorStartAt = input.recurrenceAnchorStartAt
    ? new Date(input.recurrenceAnchorStartAt)
    : null;
  const recurrenceAnchorEndAt = input.recurrenceAnchorEndAt
    ? new Date(input.recurrenceAnchorEndAt)
    : null;

  if (input.recurrenceRule && (!recurrenceAnchorStartAt || !recurrenceAnchorEndAt)) {
    throw new EngineError(
      ENGINE_ERROR_CODES.VALIDATION_FAILED,
      "recurrenceAnchorStartAt and recurrenceAnchorEndAt are required when recurrenceRule is set",
    );
  }
  if (
    input.recurrenceRule &&
    recurrenceAnchorStartAt &&
    recurrenceAnchorEndAt &&
    recurrenceAnchorEndAt.getTime() <= recurrenceAnchorStartAt.getTime()
  ) {
    throw new EngineError(
      ENGINE_ERROR_CODES.VALIDATION_FAILED,
      "recurrenceAnchorEndAt must be after recurrenceAnchorStartAt",
    );
  }
  const shouldCancelOpenWorkBlocks = nextStatus === TaskStatus.Cancelled &&
    currentTask.status !== TaskStatus.Cancelled;

  const changedFields = [
    input.title !== undefined ? "title" : null,
    input.description !== undefined ? "description" : null,
    input.priority !== undefined ? "priority" : null,
    input.autoPlanGeneration !== undefined || input.autoExecute === true ? "autoPlanGeneration" : null,
    input.autoExecute !== undefined ? "autoExecute" : null,
    input.autoPlanGenerationTiming !== undefined ? "autoPlanGenerationTiming" : null,
    input.autoExecuteTiming !== undefined ? "autoExecuteTiming" : null,
    input.status !== undefined ? "status" : null,
    input.executionRuntime !== undefined ? "executionRuntime" : null,
    input.executionConfig !== undefined ? "executionConfig" : null,
    input.sessionStrategy !== undefined ? "executionConfig" : null,
    input.recurrenceRule !== undefined ? "recurrenceRule" : null,
    input.aiClientId !== undefined ? "aiClientId" : null,
  ].filter((field): field is string => field !== null);

  const task = await db.task.update({
    where: { id: input.taskId },
    data: {
      title,
      description,
      priority: input.priority ? TaskPriority[input.priority] : undefined,
      autoPlanGeneration:
        input.autoPlanGeneration !== undefined || input.autoExecute === true
          ? nextAutoPlanGeneration
          : undefined,
      autoExecute: input.autoExecute,
      autoPlanGenerationTiming:
        input.autoPlanGenerationTiming !== undefined
          ? nextAutoPlanGenerationTiming
          : undefined,
      autoExecuteTiming:
        input.autoExecuteTiming !== undefined ? nextAutoExecuteTiming : undefined,
      executionRuntime: shouldPersistResolvedRuntimeConfig
        ? validatedRuntimeConfig.executionRuntime
        : undefined,
      executionConfig: shouldPersistResolvedRuntimeConfig
        ? (validatedRuntimeConfig.executionConfig as Prisma.InputJsonObject)
        : executionConfig,
      pinnedModel: modelRoutingChanged ? (nextConfiguredModel || null) : undefined,
      pinnedModelSource: modelRoutingChanged ? (nextConfiguredModel ? "user" : null) : undefined,
      status: nextStatus,
      recurrenceRule: input.recurrenceRule !== undefined ? nextRecurrenceRule : undefined,
      kind: input.recurrenceRule !== undefined ? (nextRecurrenceRule ? "recurring" : "single") : undefined,
      recurrenceAnchorStartAt: input.recurrenceRule !== undefined ? recurrenceAnchorStartAt : undefined,
      recurrenceAnchorEndAt: input.recurrenceRule !== undefined ? recurrenceAnchorEndAt : undefined,
      recurrenceWindowUntil: input.recurrenceRule !== undefined && recurrenceAnchorStartAt
        ? new Date(recurrenceAnchorStartAt.getTime() + SELF_SERIES_WINDOW_DAYS * 24 * 60 * 60 * 1000)
        : input.recurrenceRule !== undefined
          ? null
          : undefined,
      seriesExternalUid: input.recurrenceRule !== undefined ? null : undefined,
      aiClientId: input.aiClientId !== undefined ? input.aiClientId : undefined,
    },
  });

  if (shouldCancelOpenWorkBlocks) {
    await db.workBlock.updateMany({
      where: {
        taskId: task.id,
        status: { in: ["Scheduled", "Active"] },
      },
      data: {
        status: "Cancelled",
        completedAt: new Date(),
      },
    });
  }

  if (!shouldCancelOpenWorkBlocks && recurrenceChanged && !nextRecurrenceRule) {
    await db.workBlock.updateMany({
      where: {
        taskId: task.id,
        status: "Scheduled",
        recurrenceKey: { not: null },
      },
      data: {
        status: "Cancelled",
        completedAt: new Date(),
      },
    });
  }

  if (!shouldCancelOpenWorkBlocks && shouldMaterializeRecurrence && recurrenceAnchorStartAt && recurrenceAnchorEndAt && nextRecurrenceRule) {
    const durationMs = recurrenceAnchorEndAt.getTime() - recurrenceAnchorStartAt.getTime();
    const windowTo = new Date(
      recurrenceAnchorStartAt.getTime() + SELF_SERIES_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    const occurrences = expandRecurrenceRule(nextRecurrenceRule, recurrenceAnchorStartAt, durationMs, {
      from: recurrenceAnchorStartAt,
      to: windowTo,
      maxOccurrences: SELF_SERIES_MAX_OCCURRENCES,
    });
    const nextKeys = new Set(occurrences.map((occurrence) => occurrence.startsAt.toISOString()));

    await db.workBlock.updateMany({
      where: {
        taskId: task.id,
        status: "Scheduled",
        recurrenceKey: { not: null },
        NOT: { recurrenceKey: { in: [...nextKeys] } },
      },
      data: {
        status: "Cancelled",
        completedAt: new Date(),
      },
    });

    for (const occurrence of occurrences) {
      const recurrenceKey = occurrence.startsAt.toISOString();
      const workBlock = await db.workBlock.upsert({
        where: {
          taskId_recurrenceKey: {
            taskId: task.id,
            recurrenceKey,
          },
        },
        create: {
          workspaceId: task.workspaceId,
          taskId: task.id,
          recurrenceKey,
          title: task.title,
          status: "Scheduled",
          scheduledStartAt: occurrence.startsAt,
          scheduledEndAt: occurrence.endsAt,
          trigger: "manual",
        },
        update: {
          title: task.title,
          scheduledStartAt: occurrence.startsAt,
          scheduledEndAt: occurrence.endsAt,
          trigger: "manual",
        },
        select: { id: true, sessionId: true },
      });
      await ensureWorkBlockTaskSession({
        taskId: task.id,
        taskTitle: task.title,
        runtimeName: validatedRuntimeConfig.executionRuntime,
        workBlockId: workBlock.id,
        sessionId: workBlock.sessionId,
        label: `${task.title} · Work block session`,
      });
    }
  }
  await appendCanonicalEvent({
    eventType: "task.updated",
    workspaceId: task.workspaceId,
    taskId: task.id,
    workBlockId: null,
    actorType: "user",
    actorId: "server-action",
    source: "ui",
    payload: {
      changed_fields: changedFields,
    },
    dedupeKey: `task.updated:${task.id}:${task.updatedAt.toISOString()}`,
  });

  await rebuildTaskProjection(task.id);

  if (
    nextAutoPlanGeneration &&
    nextAutoPlanGenerationTiming === "immediate" &&
    (
      (input.autoPlanGeneration === true && currentTask.autoPlanGeneration !== true) ||
      (input.autoExecute === true && currentTask.autoExecute !== true)
    )
  ) {
    startAutoPlanGenerationForTask({ taskId: task.id, accept: nextAutoExecute });
  }

  return {
    taskId: task.id,
    workspaceId: task.workspaceId,
  };
}
