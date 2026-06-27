import { Prisma, TaskPriority, TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events";
import { startAutoPlanGenerationForTask } from "@/modules/plans/auto-generate-task-plan";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import { ensureDefaultTaskSession, ensureWorkBlockTaskSession, validateTaskRuntimeConfig, getRuntimeTaskConfigSpec } from "@/modules/execution-runtime";
import { deriveTaskStaticState } from "@chrona/domain";
import type { CreateTaskInput } from "@chrona/contracts";
import { normalizeAutomationTiming } from "@chrona/contracts";
import { expandRecurrenceRule } from "@chrona/integrations";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";

const SELF_SERIES_WINDOW_DAYS = 180;
const SELF_SERIES_MAX_OCCURRENCES = 365;

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

export async function createTask(input: CreateTaskInput) {
  const title = input.title.trim();
  const description = input.description?.trim() || null;
  const executionConfig = normalizeExecutionConfig(
    input.executionConfig as Prisma.InputJsonObject | null | undefined,
  );

  if (!title) {
    throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "title is required");
  }

  const workspace = await db.workspace.findUnique({
    where: { id: input.workspaceId },
    select: { defaultRuntime: true },
  });
  if (!workspace) {
    throw new Error(`Workspace not found: ${input.workspaceId}`);
  }

  if (input.parentTaskId) {
    const parentTask = await db.task.findUnique({
      where: { id: input.parentTaskId },
      select: { id: true, workspaceId: true },
    });

    if (!parentTask || parentTask.workspaceId !== input.workspaceId) {
      throw new EngineError(
        ENGINE_ERROR_CODES.VALIDATION_FAILED,
        "parentTaskId must reference a task in the same workspace",
      );
    }
  }

  const validatedRuntimeConfig = validateTaskRuntimeConfig({
    executionRuntime: input.executionRuntime,
    workspaceDefaultRuntime: workspace.defaultRuntime,
    executionConfig,
  });
  const autoExecute = input.autoExecute ?? false;
  const autoPlanGeneration = autoExecute || (input.autoPlanGeneration ?? false);
  const autoPlanGenerationTiming = normalizeAutomationTiming(
    input.autoPlanGenerationTiming,
  );
  const autoExecuteTiming = normalizeAutomationTiming(input.autoExecuteTiming);

  const staticState = deriveTaskStaticState({
    runtimeSpec: getRuntimeTaskConfigSpec(validatedRuntimeConfig.executionRuntime),
    executionConfig: validatedRuntimeConfig.executionConfig,
    hasAcceptedPlan: false,
  });
  const status = TaskStatus[staticState.persistedStatus];

  const recurrenceRule = input.recurrenceRule?.trim() || null;
  const recurrenceAnchorStartAt = recurrenceRule
    ? new Date(input.recurrenceAnchorStartAt ?? "")
    : null;
  const recurrenceAnchorEndAt = recurrenceRule
    ? new Date(input.recurrenceAnchorEndAt ?? "")
    : null;

  if (recurrenceRule) {
    if (
      !recurrenceAnchorStartAt ||
      !recurrenceAnchorEndAt ||
      Number.isNaN(recurrenceAnchorStartAt.getTime()) ||
      Number.isNaN(recurrenceAnchorEndAt.getTime())
    ) {
      throw new EngineError(
        ENGINE_ERROR_CODES.VALIDATION_FAILED,
        "recurrenceAnchorStartAt and recurrenceAnchorEndAt are required when recurrenceRule is set",
      );
    }

    if (recurrenceAnchorEndAt.getTime() <= recurrenceAnchorStartAt.getTime()) {
      throw new EngineError(
        ENGINE_ERROR_CODES.VALIDATION_FAILED,
        "recurrenceAnchorEndAt must be after recurrenceAnchorStartAt",
      );
    }
  }

  const task = await db.task.create({
    data: {
      workspaceId: input.workspaceId,
      title,
      description,
      kind: recurrenceRule ? "recurring" : "single",
      recurrenceRule,
      seriesExternalUid: null,
      recurrenceAnchorStartAt,
      recurrenceAnchorEndAt,
      recurrenceWindowUntil: recurrenceAnchorStartAt
        ? new Date(recurrenceAnchorStartAt.getTime() + SELF_SERIES_WINDOW_DAYS * 24 * 60 * 60 * 1000)
        : null,
      executionRuntime: validatedRuntimeConfig.executionRuntime,
      executionConfig:
        validatedRuntimeConfig.executionConfig as Prisma.InputJsonObject,
      priority: input.priority
        ? TaskPriority[input.priority]
        : TaskPriority.Medium,
      autoPlanGeneration,
      autoExecute,
      autoPlanGenerationTiming,
      autoExecuteTiming,
      status,
      parentTaskId: input.parentTaskId ?? null,
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
    runtimeName: validatedRuntimeConfig.executionRuntime,
    defaultSessionId: task.defaultSessionId,
  });

  let firstWorkBlockId: string | null = null;
  if (recurrenceRule && recurrenceAnchorStartAt && recurrenceAnchorEndAt) {
    const durationMs =
      recurrenceAnchorEndAt.getTime() - recurrenceAnchorStartAt.getTime();
    const windowTo = new Date(
      recurrenceAnchorStartAt.getTime() +
        SELF_SERIES_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    const occurrences = expandRecurrenceRule(
      recurrenceRule,
      recurrenceAnchorStartAt,
      durationMs,
      {
        from: recurrenceAnchorStartAt,
        to: windowTo,
        maxOccurrences: SELF_SERIES_MAX_OCCURRENCES,
      },
    );

    for (const occurrence of occurrences) {
      const workBlock = await db.workBlock.create({
        data: {
          workspaceId: task.workspaceId,
          taskId: task.id,
          recurrenceKey: occurrence.startsAt.toISOString(),
          title: task.title,
          status: "Scheduled",
          scheduledStartAt: occurrence.startsAt,
          scheduledEndAt: occurrence.endsAt,
          trigger: "manual",
        },
        select: { id: true },
      });
      await ensureWorkBlockTaskSession({
        taskId: task.id,
        taskTitle: task.title,
        runtimeName: validatedRuntimeConfig.executionRuntime,
        workBlockId: workBlock.id,
        label: `${task.title} · Work block session`,
      });
      firstWorkBlockId ??= workBlock.id;
    }
  }

  await appendCanonicalEvent({
    eventType: "task.created",
    workspaceId: task.workspaceId,
    taskId: task.id,
    workBlockId: firstWorkBlockId,
    actorType: "user",
    actorId: "server-action",
    source: "ui",
    payload: {
      title: task.title,
      priority: task.priority,
      autoPlanGeneration: task.autoPlanGeneration,
      autoExecute: task.autoExecute,
      autoPlanGenerationTiming: task.autoPlanGenerationTiming,
      autoExecuteTiming: task.autoExecuteTiming,
      status: task.status,
      parentTaskId: task.parentTaskId,
    },
    dedupeKey: `task.created:${task.id}`,
  });

  await rebuildTaskProjection(task.id);

  if (task.autoPlanGeneration && autoPlanGenerationTiming === "immediate") {
    startAutoPlanGenerationForTask({ taskId: task.id, workBlockId: firstWorkBlockId, accept: task.autoExecute });
  }

  return {
    taskId: task.id,
    workspaceId: task.workspaceId,
    autoPlanGeneration: task.autoPlanGeneration,
    autoExecute: task.autoExecute,
    autoPlanGenerationTiming: task.autoPlanGenerationTiming,
    autoExecuteTiming: task.autoExecuteTiming,
  };
}
