import { Prisma, RunStatus, TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import { createRuntimeExecutionAdapter } from "@/modules/task-execution/execution-registry";
import { validateTaskRuntimeConfig } from "@/modules/task-execution/task-config";
import {
  ensureDefaultTaskSession,
  updateTaskSessionStateFromRun,
} from "@/modules/task-execution/task-sessions";
import type { RuntimeExecutionAdapter } from "@chrona/runtime-core";
import { deriveTaskRunnability } from "@/modules/tasks/derive-task-runnability";

export type RunTrigger = "user" | "scheduler" | "system" | "runtime";

function resolveActor(triggeredBy: RunTrigger) {
  switch (triggeredBy) {
    case "scheduler":
      return { actorType: "system", actorId: "auto-start-scheduler", source: "scheduler" };
    case "system":
      return { actorType: "system", actorId: "system-action", source: "system" };
    case "runtime":
      return { actorType: "runtime", actorId: "runtime-orchestrator", source: "runtime" };
    default:
      return { actorType: "user", actorId: "server-action", source: "ui" };
  }
}

export async function startRun(input: {
  taskId: string;
  prompt?: string;
  adapter?: RuntimeExecutionAdapter;
  triggeredBy?: RunTrigger;
}) {
  const triggeredBy: RunTrigger = input.triggeredBy ?? "user";
  const task = await db.task.findUniqueOrThrow({
    where: { id: input.taskId },
    include: {
      workspace: {
        select: { defaultRuntime: true },
      },
    },
  });
  const persistedRuntimeConfig = validateTaskRuntimeConfig({
    runtimeAdapterKey: task.runtimeAdapterKey,
    workspaceDefaultRuntime: task.workspace.defaultRuntime,
    runtimeInput: task.runtimeInput,
    runtimeInputVersion: task.runtimeInputVersion,
    runtimeModel: task.runtimeModel,
    prompt: task.prompt,
    runtimeConfig: task.runtimeConfig,
  });
  const runRuntimeConfig = validateTaskRuntimeConfig({
    runtimeAdapterKey: task.runtimeAdapterKey,
    workspaceDefaultRuntime: task.workspace.defaultRuntime,
    runtimeInput: task.runtimeInput,
    runtimeInputVersion: task.runtimeInputVersion,
    runtimeModel: task.runtimeModel,
    prompt: task.prompt,
    runtimeConfig: task.runtimeConfig,
    promptOverride: input.prompt,
  });
  const adapter = input.adapter ?? (await createRuntimeExecutionAdapter(runRuntimeConfig.runtimeAdapterKey));
  const effectivePrompt = runRuntimeConfig.prompt;
  const runnability = deriveTaskRunnability({
    runtimeAdapterKey: runRuntimeConfig.runtimeAdapterKey,
    runtimeInput: runRuntimeConfig.runtimeInput,
    runtimeModel: runRuntimeConfig.runtimeModel,
    prompt: effectivePrompt,
    runtimeConfig: runRuntimeConfig.runtimeInput,
  });

  if (!runnability.isRunnable) {
    throw new Error(runnability.summary);
  }

  if (task.status === TaskStatus.Done) {
    throw new Error("Re-open the task before starting another run.");
  }

  const taskSession = await ensureDefaultTaskSession({
    taskId: task.id,
    taskTitle: task.title,
    runtimeName: runRuntimeConfig.runtimeAdapterKey,
    defaultSessionId: task.defaultSessionId,
  });

  const run = await db.run.create({
    data: {
      taskId: task.id,
      taskSessionId: taskSession.id,
      runtimeName: runRuntimeConfig.runtimeAdapterKey,
      runtimeSessionRef: taskSession.sessionKey,
      runtimeConfigSnapshot: runRuntimeConfig.runtimeInput as Prisma.InputJsonObject,
      runtimeConfigVersion: runRuntimeConfig.runtimeInputVersion,
      status: RunStatus.Pending,
      triggeredBy,
      startedAt: new Date(),
    },
  });

  try {
    const created = await adapter.createRun({
      prompt: effectivePrompt ?? "",
      runtimeInput: runRuntimeConfig.runtimeInput,
      runtimeSessionKey: taskSession.sessionKey,
    });
    const nextRunStatus = created.runStarted ? RunStatus.Running : RunStatus.Pending;
    const nextTaskStatus = created.runStarted ? TaskStatus.Running : TaskStatus.Queued;

    await db.run.update({
      where: { id: run.id },
      data: {
        runtimeRunRef: created.runtimeRunRef ?? null,
        runtimeSessionRef:
          created.runtimeSessionKey ?? created.runtimeSessionRef ?? taskSession.sessionKey,
        status: nextRunStatus,
        syncStatus: "healthy",
      },
    });

    await updateTaskSessionStateFromRun({
      taskSessionId: taskSession.id,
      runId: run.id,
      runStatus: nextRunStatus,
      runtimeRunRef: created.runtimeRunRef ?? null,
    });

    await db.task.update({
      where: { id: task.id },
      data: {
        runtimeAdapterKey: persistedRuntimeConfig.runtimeAdapterKey,
        runtimeInput: persistedRuntimeConfig.runtimeInput as Prisma.InputJsonObject,
        runtimeInputVersion: persistedRuntimeConfig.runtimeInputVersion,
        latestRunId: run.id,
        status: nextTaskStatus,
        blockReason: Prisma.DbNull,
      },
    });

    const actor = resolveActor(triggeredBy);

    await appendCanonicalEvent({
      eventType: "run.started",
      workspaceId: task.workspaceId,
      taskId: task.id,
      runId: run.id,
      actorType: actor.actorType,
      actorId: actor.actorId,
      source: actor.source,
      payload: {
        runtime_name: runRuntimeConfig.runtimeAdapterKey,
        task_model: runRuntimeConfig.runtimeModel,
        runtime_run_ref: created.runtimeRunRef ?? null,
        runtime_session_key:
          created.runtimeSessionKey ?? created.runtimeSessionRef ?? taskSession.sessionKey,
        triggered_by: triggeredBy,
      },
      dedupeKey: `run.started:${run.id}`,
    });

    await rebuildTaskProjection(task.id);

    return {
      taskId: task.id,
      workspaceId: task.workspaceId,
      runId: run.id,
      runtimeRunRef: created.runtimeRunRef ?? null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create runtime run";

    await db.run.update({
      where: { id: run.id },
      data: {
        status: RunStatus.Failed,
        errorSummary: message,
        retryable: true,
        endedAt: new Date(),
        syncStatus: "degraded",
      },
    });

    await updateTaskSessionStateFromRun({
      taskSessionId: taskSession.id,
      runId: run.id,
      runStatus: RunStatus.Failed,
      runtimeRunRef: null,
    });

    await db.task.update({
      where: { id: task.id },
      data: {
        runtimeAdapterKey: persistedRuntimeConfig.runtimeAdapterKey,
        runtimeInput: persistedRuntimeConfig.runtimeInput as Prisma.InputJsonObject,
        runtimeInputVersion: persistedRuntimeConfig.runtimeInputVersion,
        latestRunId: run.id,
        status: TaskStatus.Blocked,
        blockReason: {
          blockType: "run_create_failed",
          scope: "run",
          actionRequired: "Retry Run",
          message,
        },
      },
    });

    await appendCanonicalEvent({
      eventType: "run.failed",
      workspaceId: task.workspaceId,
      taskId: task.id,
      runId: run.id,
      actorType: "runtime",
      actorId: runRuntimeConfig.runtimeAdapterKey,
      source: "adapter",
      payload: {
        error: message,
      },
      dedupeKey: `run.failed:${run.id}:create`,
    });

    await rebuildTaskProjection(task.id);
    throw error;
  }
}

