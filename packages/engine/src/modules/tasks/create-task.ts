import { Prisma, TaskPriority, TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import { ensureDefaultTaskSession } from "@/modules/task-execution/task-sessions";
import { validateTaskRuntimeConfig } from "@/modules/task-execution/task-config";
import { getRuntimeTaskConfigSpec } from "@/modules/task-execution/registry";
import { deriveTaskStaticState } from "@chrona/domain";
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
      autoExecute: input.autoExecute ?? false,
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
      autoExecute: task.autoExecute,
      status: task.status,
      parentTaskId: task.parentTaskId,
    },
    dedupeKey: `task.created:${task.id}`,
  });

  await rebuildTaskProjection(task.id);

  return {
    taskId: task.id,
    workspaceId: task.workspaceId,
  };
}
