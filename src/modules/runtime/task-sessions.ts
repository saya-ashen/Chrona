import { RunStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";

type EnsureDefaultTaskSessionInput = {
  taskId: string;
  taskTitle: string;
  runtimeName: string;
  defaultSessionId?: string | null;
};

type TaskSessionStatus = "idle" | "running" | "waiting_for_input" | "waiting_for_approval";

export function buildDefaultTaskSessionKey(input: { taskId: string; runtimeName: string }) {
  return `agent-dashboard:${input.runtimeName}:task:${input.taskId}:default`;
}

export function resolveTaskSessionKey(input: {
  taskSession?: { sessionKey: string } | null;
  runtimeSessionRef: string | null;
}) {
  return input.taskSession?.sessionKey ?? input.runtimeSessionRef ?? undefined;
}

export async function ensureDefaultTaskSession(input: EnsureDefaultTaskSessionInput) {
  const expectedSessionKey = buildDefaultTaskSessionKey({
    taskId: input.taskId,
    runtimeName: input.runtimeName,
  });

  if (input.defaultSessionId) {
    const existingDefaultSession = await db.taskSession.findUnique({
      where: { id: input.defaultSessionId },
    });

    if (existingDefaultSession?.sessionKey === expectedSessionKey) {
      return existingDefaultSession;
    }
  }

  const existingSession = await db.taskSession.findUnique({
    where: { sessionKey: expectedSessionKey },
  });

  if (existingSession) {
    await db.task.update({
      where: { id: input.taskId },
      data: { defaultSessionId: existingSession.id },
    });

    return existingSession;
  }

  const createdSession = await db.taskSession.create({
    data: {
      taskId: input.taskId,
      runtimeName: input.runtimeName,
      sessionKey: expectedSessionKey,
      label: `${input.taskTitle.trim() || "Task"} · Default session`,
      createdByFramework: true,
    },
  });

  await db.task.update({
    where: { id: input.taskId },
    data: { defaultSessionId: createdSession.id },
  });

  return createdSession;
}

export async function updateTaskSessionStateFromRun(input: {
  taskSessionId?: string | null;
  runId: string;
  runStatus: RunStatus;
  runtimeRunRef?: string | null;
}) {
  if (!input.taskSessionId) {
    return;
  }

  const status = toTaskSessionStatus(input.runStatus);

  await db.taskSession.update({
    where: { id: input.taskSessionId },
    data: {
      status,
      lastRunStatus: input.runStatus,
      activeRunId: status === "idle" ? null : input.runId,
      ...(input.runtimeRunRef !== undefined ? { lastRunRef: input.runtimeRunRef } : {}),
    },
  });
}

function toTaskSessionStatus(runStatus: RunStatus): TaskSessionStatus {
  switch (runStatus) {
    case RunStatus.WaitingForInput:
      return "waiting_for_input";
    case RunStatus.WaitingForApproval:
      return "waiting_for_approval";
    case RunStatus.Pending:
    case RunStatus.Running:
      return "running";
    case RunStatus.Failed:
    case RunStatus.Completed:
    case RunStatus.Cancelled:
    default:
      return "idle";
  }
}
