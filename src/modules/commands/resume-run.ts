import { Prisma, RunStatus, TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";
import { syncRunFromRuntime } from "@/modules/openclaw/sync-run";
import {
  createRuntimeAdapter,
  type OpenClawAdapter,
} from "@/modules/openclaw/adapter";
import {
  resolveTaskSessionKey,
  updateTaskSessionStateFromRun,
} from "@/modules/task-execution/task-sessions";

export async function resumeRun(input: {
  runId: string;
  approvalId?: string;
  inputText?: string;
  adapter?: OpenClawAdapter;
}) {
  const adapter = input.adapter ?? (await createRuntimeAdapter());
  const run = await db.run.findUnique({
    where: { id: input.runId },
    include: { task: true, taskSession: true },
  });

  if (!run) {
    throw new Error("The run no longer exists. Refresh the work page and try again.");
  }

  const resumableStatuses = [RunStatus.WaitingForApproval, RunStatus.WaitingForInput];

  if (!resumableStatuses.some((status) => status === run.status)) {
    throw new Error("Resume is only allowed for blocked runs.");
  }

  const runtimeSessionKey = resolveTaskSessionKey(run);

  if (!runtimeSessionKey) {
    throw new Error("Cannot resume a run without a runtime session key.");
  }

  const resumed = await adapter.resumeRun({
    runtimeSessionKey,
    approvalId: input.approvalId,
    decision: input.approvalId ? "approve" : undefined,
    inputText: input.inputText,
  });

  if (!resumed.accepted) {
    throw new Error("Runtime rejected the resume request.");
  }

  await db.run.update({
    where: { id: run.id },
    data: {
        status: RunStatus.Running,
        runtimeRunRef: "runtimeRunRef" in resumed ? resumed.runtimeRunRef ?? run.runtimeRunRef : run.runtimeRunRef,
        runtimeSessionRef:
          "runtimeSessionKey" in resumed
            ? resumed.runtimeSessionKey ?? runtimeSessionKey
            : runtimeSessionKey,
        pendingInputPrompt: null,
        pendingInputType: null,
        syncStatus: "healthy",
      lastSyncedAt: new Date(),
    },
  });

  await updateTaskSessionStateFromRun({
    taskSessionId: run.taskSessionId,
    runId: run.id,
    runStatus: RunStatus.Running,
    runtimeRunRef:
      "runtimeRunRef" in resumed ? resumed.runtimeRunRef ?? run.runtimeRunRef : run.runtimeRunRef,
  });

  await db.task.update({
    where: { id: run.taskId },
    data: {
      status: TaskStatus.Running,
      blockReason: Prisma.DbNull,
    },
  });

  await appendCanonicalEvent({
    eventType: "task.status_changed",
    workspaceId: run.task.workspaceId,
    taskId: run.taskId,
    runId: run.id,
    actorType: "user",
    actorId: "server-action",
    source: "ui",
    payload: {
      previous_status: run.task.status,
      next_status: TaskStatus.Running,
      resume_reason: input.approvalId ? "approval_resolved" : "input_provided",
    },
    dedupeKey: `task.status_changed:${run.id}:${Date.now()}`,
  });

  await syncRunFromRuntime({ runId: run.id, adapter });

  return {
    taskId: run.taskId,
    workspaceId: run.task.workspaceId,
    runId: run.id,
  };
}
