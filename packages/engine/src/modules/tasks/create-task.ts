import { Prisma, TaskPriority, TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";
import { startAutoPlanGenerationForTask } from "@/modules/plans/auto-generate-task-plan";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import { ensureDefaultTaskSession } from "@/modules/task-execution/task-sessions";
import { validateTaskRuntimeConfig } from "@/modules/task-execution/task-config";
import { getRuntimeTaskConfigSpec } from "@/modules/task-execution/registry";
import { deriveTaskStaticState } from "@chrona/domain";
import { normalizeAutomationTiming } from "@chrona/contracts";
import type { CreateTaskInput } from "@chrona/contracts";

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

export async function createTask(input: CreateTaskInput) {
  const title = input.title.trim();
  const description = input.description?.trim() || null;
  const executionConfig = normalizeExecutionConfig(
    input.executionConfig as Prisma.InputJsonObject | null | undefined,
  );

  if (!title) {
    throw new Error("title is required");
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
      throw new Error(
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

  const task = await db.task.create({
    data: {
      workspaceId: input.workspaceId,
      title,
      description,
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
    startAutoPlanGenerationForTask({ taskId: task.id, accept: task.autoExecute });
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
