import { Prisma, RunStatus, TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import { createRuntimeExecutionAdapter } from "@/modules/runtime/execution-registry";
import { validateTaskRuntimeConfig } from "@/modules/runtime/task-config";
import type { RuntimeExecutionAdapter } from "@/modules/runtime/types";
import { deriveTaskRunnability } from "@/modules/tasks/derive-task-runnability";

export async function startRun(input: {
  taskId: string;
  prompt?: string;
  adapter?: RuntimeExecutionAdapter;
}) {
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

  if (!runnability.isRunnable || !effectivePrompt) {
    throw new Error(runnability.summary);
  }

  if (task.status === TaskStatus.Done) {
    throw new Error("Re-open the task before starting another run.");
  }

  const run = await db.run.create({
    data: {
      taskId: task.id,
      runtimeName: runRuntimeConfig.runtimeAdapterKey,
      runtimeConfigSnapshot: runRuntimeConfig.runtimeInput as Prisma.InputJsonObject,
      runtimeConfigVersion: runRuntimeConfig.runtimeInputVersion,
      status: RunStatus.Pending,
      triggeredBy: "user",
      startedAt: new Date(),
    },
  });

  try {
    const created = await adapter.createRun({
      prompt: effectivePrompt,
      runtimeInput: runRuntimeConfig.runtimeInput,
    });
    const nextRunStatus = created.runStarted ? RunStatus.Running : RunStatus.Pending;
    const nextTaskStatus = created.runStarted ? TaskStatus.Running : TaskStatus.Queued;

    await db.run.update({
      where: { id: run.id },
      data: {
        runtimeRunRef: created.runtimeRunRef ?? null,
        runtimeSessionRef:
          created.runtimeSessionKey ?? created.runtimeSessionRef ?? run.runtimeSessionRef,
        status: nextRunStatus,
        syncStatus: "healthy",
      },
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

    await appendCanonicalEvent({
      eventType: "run.started",
      workspaceId: task.workspaceId,
      taskId: task.id,
      runId: run.id,
      actorType: "user",
      actorId: "server-action",
      source: "ui",
      payload: {
        runtime_name: runRuntimeConfig.runtimeAdapterKey,
        task_model: runRuntimeConfig.runtimeModel,
        runtime_run_ref: created.runtimeRunRef ?? null,
        runtime_session_key: created.runtimeSessionKey ?? null,
        triggered_by: "user",
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
