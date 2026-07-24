import { Prisma, TaskPriority, TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { startAutoPlanGenerationForTask } from "@/modules/plans/auto-generate-task-plan";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import { validateTaskRuntimeConfig, getRuntimeTaskConfigSpec } from "@/modules/execution-runtime";
import { deriveTaskStaticState } from "@chrona/domain";
import type { CreateTaskInput } from "@chrona/contracts";
import { normalizeAutomationTiming } from "@chrona/contracts";
import { expandRecurrenceRule } from "@chrona/integrations";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";
import { buildAutomaticGoalTaskContext } from "../goals/goal-task-context";

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

export async function createTask(input: CreateTaskInput, client: Prisma.TransactionClient | typeof db = db) {
  const title = input.title.trim();
  const description = input.description?.trim() || null;
  const executionConfig = normalizeExecutionConfig(
    input.executionConfig as Prisma.InputJsonObject | null | undefined,
  );

  if (!title) {
    throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "title is required");
  }

  const workspace = await client.workspace.findUnique({
    where: { id: input.workspaceId },
    select: { defaultRuntime: true },
  });
  if (!workspace) {
    throw new Error(`Workspace not found: ${input.workspaceId}`);
  }

  if (input.parentTaskId) {
    const parentTask = await client.task.findUnique({
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

  const goalContext = input.goalId
    ? await buildAutomaticGoalTaskContext({
        goalId: input.goalId,
        workspaceId: input.workspaceId,
        additionalContext: input.goalContext as Prisma.InputJsonObject | undefined,
      }, client)
    : input.goalContext as Prisma.InputJsonObject | undefined;

  const task = await client.task.create({
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
      goalId: input.goalId ?? null,
      goalContext,
      aiClientId: input.aiClientId ?? null,
    },
  });

  const scheduleTrigger = recurrenceRule && recurrenceAnchorStartAt && recurrenceAnchorEndAt
    ? await client.taskTrigger.create({
        data: {
          workspaceId: task.workspaceId,
          taskId: task.id,
          kind: "schedule",
          state: "Enabled",
          config: {
            mode: "recurring",
            rrule: recurrenceRule,
            anchorStartAt: recurrenceAnchorStartAt.toISOString(),
            timezone: "UTC",
            durationMs: recurrenceAnchorEndAt.getTime() - recurrenceAnchorStartAt.getTime(),
            windowUntil: task.recurrenceWindowUntil?.toISOString(),
          },
        },
      })
    : null;

  if (input.parentTaskId) {
    await client.taskDependency.upsert({
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

  const defaultSession = await client.taskSession.create({
    data: { taskId: task.id, runtimeName: validatedRuntimeConfig.executionRuntime, sessionKey: `chrona:task:${task.id}:default`, label: `${task.title} · Default session`, createdByFramework: true },
  });
  await client.task.update({ where: { id: task.id }, data: { defaultSessionId: defaultSession.id } });

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
      const workBlock = await client.workBlock.create({
        data: {
          workspaceId: task.workspaceId,
          taskId: task.id,
          recurrenceKey: occurrence.startsAt.toISOString(),
          title: task.title,
          status: "Scheduled",
          scheduledStartAt: occurrence.startsAt,
          scheduledEndAt: occurrence.endsAt,
          trigger: "scheduled",
          occurrence: {
            create: {
              workspaceId: task.workspaceId,
              taskId: task.id,
              triggerId: scheduleTrigger!.id,
              occurrenceKey: `schedule:v${scheduleTrigger!.version}:${occurrence.startsAt.toISOString()}`,
              triggerVersion: scheduleTrigger!.version,
              source: { kind: "trigger", triggerId: scheduleTrigger!.id },
              status: occurrence.startsAt > new Date() ? "Scheduled" : "Ready",
              eligibleAt: occurrence.startsAt,
            },
          },
        },
        select: { id: true },
      });
      const workBlockSession = await client.taskSession.create({
        data: { taskId: task.id, runtimeName: validatedRuntimeConfig.executionRuntime, sessionKey: `chrona:task:${task.id}:work-block:${workBlock.id}`, label: `${task.title} · Work block session`, createdByFramework: true },
      });
      await client.workBlock.update({ where: { id: workBlock.id }, data: { sessionId: workBlockSession.id } });
      firstWorkBlockId ??= workBlock.id;
    }
  }

  if (!recurrenceRule) {
    await client.taskOccurrence.create({
      data: {
        workspaceId: task.workspaceId,
        taskId: task.id,
        occurrenceKey: `manual:${task.id}`,
        source: { kind: "manual", actor: { type: "user", id: "server-action" } },
        status: status === "Draft" ? "Scheduled" : "Ready",
        eligibleAt: new Date(),
      },
    });
  }

  await client.event.create({
    data: {
      eventType: "task.created",
      workspaceId: task.workspaceId,
      taskId: task.id,
      workBlockId: firstWorkBlockId,
      actorType: "user",
      actorId: "server-action",
      source: "ui",
      payload: { title: task.title, description: task.description, priority: task.priority, executionRuntime: task.executionRuntime, autoPlanGeneration: task.autoPlanGeneration, autoExecute: task.autoExecute, autoPlanGenerationTiming: task.autoPlanGenerationTiming, autoExecuteTiming: task.autoExecuteTiming, status: task.status, parentTaskId: task.parentTaskId },
      summary: `Created task: ${task.title}`,
      dedupeKey: `task.created:${task.id}`,
      ingestSequence: 0,
    },
  });

  if (client === db) await rebuildTaskProjection(task.id);

  if (client === db && task.autoPlanGeneration && autoPlanGenerationTiming === "immediate") {
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
