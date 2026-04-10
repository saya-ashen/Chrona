import { Prisma, RunStatus, TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import {
  createRuntimeAdapter,
  type OpenClawAdapter,
} from "@/modules/runtime/openclaw/adapter";
import { deriveTaskRunnability } from "@/modules/tasks/derive-task-runnability";

export async function startRun(input: {
  taskId: string;
  prompt?: string;
  adapter?: OpenClawAdapter;
}) {
  const adapter = input.adapter ?? (await createRuntimeAdapter());
  const task = await db.task.findUniqueOrThrow({ where: { id: input.taskId } });
  const effectivePrompt = input.prompt?.trim() || task.prompt?.trim() || null;
  const runnability = deriveTaskRunnability({
    runtimeModel: task.runtimeModel,
    prompt: effectivePrompt,
    runtimeConfig: task.runtimeConfig,
  });

  if (!runnability.isRunnable || !effectivePrompt) {
    throw new Error(runnability.summary);
  }

  const run = await db.run.create({
    data: {
      taskId: task.id,
      runtimeName: "openclaw",
      status: RunStatus.Pending,
      triggeredBy: "user",
      startedAt: new Date(),
    },
  });

  try {
    const created = await adapter.createRun({ prompt: effectivePrompt });
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
        runtime_name: "openclaw",
        task_model: task.runtimeModel,
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
      actorId: "openclaw",
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
