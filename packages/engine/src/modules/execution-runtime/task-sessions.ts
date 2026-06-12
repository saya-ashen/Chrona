import { RunStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";

type EnsureDefaultTaskSessionInput = {
  taskId: string;
  taskTitle: string;
  runtimeName: string;
  defaultSessionId?: string | null;
  suffix?: string | null;
  label?: string | null;
};

type EnsureWorkBlockTaskSessionInput = {
  taskId: string;
  taskTitle: string;
  runtimeName: string;
  workBlockId: string;
  sessionId?: string | null;
  label?: string | null;
};
type EnsurePlanGenerationTaskSessionInput = {
  taskId: string;
  taskTitle: string;
  runtimeName: string;
  label?: string | null;
};


type EnsureWorkBlockPlanTaskSessionInput = {
  taskId: string;
  taskTitle: string;
  runtimeName: string;
  workBlockId: string;
  label?: string | null;
};

type EnsurePlanExecutionTaskSessionInput = {
  taskId: string;
  taskTitle: string;
  runtimeName: string;
  planId: string;
  label?: string | null;
};

type TaskSessionStatus =
  | "idle"
  | "running"
  | "waiting_for_input"
  | "waiting_for_approval";

export function buildDefaultTaskSessionKey(input: {
  taskId: string;
  suffix?: string | null;
}) {
  const suffix = input.suffix?.trim() || "default";
  return `chrona:task:${input.taskId}:${suffix}`;
}

export function buildWorkBlockTaskSessionKey(input: {
  taskId: string;
  workBlockId: string;
}) {
  return `chrona:task:${input.taskId}:work-block:${input.workBlockId}`;
}
export function buildPlanGenerationTaskSessionKey(input: {
  taskId: string;
}) {
  return `chrona:task:${input.taskId}:plan-generation`;
}

export function buildLegacyPlanGenerationTaskSessionKey(input: {
  taskId: string;
}) {
  return buildDefaultTaskSessionKey({ taskId: input.taskId, suffix: "pg" });
}


export function buildWorkBlockPlanTaskSessionKey(input: {
  taskId: string;
  workBlockId: string;
}) {
  return `chrona:task:${input.taskId}:work-block:${input.workBlockId}:plan-generation`;
}

export function buildLegacyWorkBlockPlanTaskSessionKey(input: {
  taskId: string;
  workBlockId: string;
}) {
  return `chrona:task:${input.taskId}:wb:${input.workBlockId}:pg`;
}

export function buildPlanExecutionTaskSessionKey(input: {
  taskId: string;
  planId: string;
}) {
  return `chrona:task:${input.taskId}:execute:${input.planId}`;
}

export function buildLegacyPlanExecutionTaskSessionKey(input: {
  taskId: string;
  planId: string;
}) {
  return buildDefaultTaskSessionKey({ taskId: input.taskId, suffix: `plan-${input.planId}` });
}

export async function ensureDefaultTaskSession(
  input: EnsureDefaultTaskSessionInput,
) {
  const suffix = input.suffix?.trim() || null;
  const shouldUpdateDefaultSessionId = !suffix;
  const expectedSessionKey = buildDefaultTaskSessionKey({
    taskId: input.taskId,
    suffix,
  });

  if (input.defaultSessionId) {
    const existingDefaultSession = await db.taskSession.findUnique({
      where: { id: input.defaultSessionId },
    });

    if (existingDefaultSession?.sessionKey === expectedSessionKey) {
      return existingDefaultSession;
    }
  }

  const existingSession = await db.taskSession.findFirst({
    where: {
      taskId: input.taskId,
      sessionKey: expectedSessionKey,
    },
    orderBy: { createdAt: "asc" },
  });

  if (existingSession) {
    if (existingSession.sessionKey !== expectedSessionKey) {
      await db.taskSession.update({
        where: { id: existingSession.id },
        data: { sessionKey: expectedSessionKey },
      });
    }

    if (shouldUpdateDefaultSessionId) {
      await db.task.update({
        where: { id: input.taskId },
        data: { defaultSessionId: existingSession.id },
      });
    }

    return existingSession.sessionKey === expectedSessionKey
      ? existingSession
      : { ...existingSession, sessionKey: expectedSessionKey };
  }

  const createdSession = await db.taskSession.create({
    data: {
      taskId: input.taskId,
      runtimeName: input.runtimeName,
      sessionKey: expectedSessionKey,
      label:
        input.label?.trim() ||
        `${input.taskTitle.trim() || "Task"} · ${suffix || "Default session"}`,
      createdByFramework: true,
    },
  });

  if (shouldUpdateDefaultSessionId) {
    await db.task.update({
      where: { id: input.taskId },
      data: { defaultSessionId: createdSession.id },
    });
  }

  return createdSession;
}

export async function ensureWorkBlockTaskSession(
  input: EnsureWorkBlockTaskSessionInput,
) {
  const expectedSessionKey = buildWorkBlockTaskSessionKey({
    taskId: input.taskId,
    workBlockId: input.workBlockId,
  });

  if (input.sessionId) {
    const existingSession = await db.taskSession.findUnique({
      where: { id: input.sessionId },
    });
    if (existingSession?.sessionKey === expectedSessionKey) {
      return existingSession;
    }
  }

  const existingSession = await db.taskSession.findFirst({
    where: {
      taskId: input.taskId,
      sessionKey: expectedSessionKey,
    },
    orderBy: { createdAt: "asc" },
  });

  if (existingSession) {
    await db.workBlock.update({
      where: { id: input.workBlockId },
      data: { sessionId: existingSession.id },
    });
    return existingSession;
  }

  const createdSession = await db.taskSession.create({
    data: {
      taskId: input.taskId,
      runtimeName: input.runtimeName,
      sessionKey: expectedSessionKey,
      label:
        input.label?.trim() ||
        `${input.taskTitle.trim() || "Task"} · Work block session`,
      createdByFramework: true,
    },
  });

  await db.workBlock.update({
    where: { id: input.workBlockId },
    data: { sessionId: createdSession.id },
  });

  return createdSession;
}

export async function ensurePlanGenerationTaskSession(
  input: EnsurePlanGenerationTaskSessionInput,
) {
  const expectedSessionKey = buildPlanGenerationTaskSessionKey({ taskId: input.taskId });
  const legacySessionKey = buildLegacyPlanGenerationTaskSessionKey({ taskId: input.taskId });

  const existingSession = await db.taskSession.findFirst({
    where: {
      taskId: input.taskId,
      sessionKey: { in: [expectedSessionKey, legacySessionKey] },
    },
    orderBy: { createdAt: "asc" },
  });

  if (existingSession) {
    if (existingSession.sessionKey !== expectedSessionKey) {
      return db.taskSession.update({
        where: { id: existingSession.id },
        data: { sessionKey: expectedSessionKey },
      });
    }
    return existingSession;
  }

  return db.taskSession.create({
    data: {
      taskId: input.taskId,
      runtimeName: input.runtimeName,
      sessionKey: expectedSessionKey,
      label:
        input.label?.trim() ||
        `${input.taskTitle.trim() || "Task"} · Plan generation session`,
      createdByFramework: true,
    },
  });
}

export async function ensureWorkBlockPlanTaskSession(
  input: EnsureWorkBlockPlanTaskSessionInput,
) {
  const expectedSessionKey = buildWorkBlockPlanTaskSessionKey({
    taskId: input.taskId,
    workBlockId: input.workBlockId,
  });

  const legacySessionKey = buildLegacyWorkBlockPlanTaskSessionKey({
    taskId: input.taskId,
    workBlockId: input.workBlockId,
  });
  const existingSession = await db.taskSession.findFirst({
    where: {
      taskId: input.taskId,
      sessionKey: { in: [expectedSessionKey, legacySessionKey] },
    },
    orderBy: { createdAt: "asc" },
  });

  if (existingSession) {
    if (existingSession.sessionKey !== expectedSessionKey) {
      return db.taskSession.update({
        where: { id: existingSession.id },
        data: { sessionKey: expectedSessionKey },
      });
    }
    return existingSession;
  }

  return db.taskSession.create({
    data: {
      taskId: input.taskId,
      runtimeName: input.runtimeName,
      sessionKey: expectedSessionKey,
      label:
        input.label?.trim() ||
        `${input.taskTitle.trim() || "Task"} · Work block plan generation session`,
      createdByFramework: true,
    },
  });
}

export async function ensurePlanExecutionTaskSession(
  input: EnsurePlanExecutionTaskSessionInput,
) {
  const expectedSessionKey = buildPlanExecutionTaskSessionKey({
    taskId: input.taskId,
    planId: input.planId,
  });
  const legacySessionKey = buildLegacyPlanExecutionTaskSessionKey({
    taskId: input.taskId,
    planId: input.planId,
  });

  const existingSession = await db.taskSession.findFirst({
    where: {
      taskId: input.taskId,
      sessionKey: { in: [expectedSessionKey, legacySessionKey] },
    },
    orderBy: { createdAt: "asc" },
  });

  if (existingSession) {
    if (existingSession.sessionKey !== expectedSessionKey) {
      return db.taskSession.update({
        where: { id: existingSession.id },
        data: { sessionKey: expectedSessionKey },
      });
    }
    return existingSession;
  }

  return db.taskSession.create({
    data: {
      taskId: input.taskId,
      runtimeName: input.runtimeName,
      sessionKey: expectedSessionKey,
      label:
        input.label?.trim() ||
        `${input.taskTitle.trim() || "Task"} · Plan execution main session`,
      createdByFramework: true,
    },
  });
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
      ...(input.runtimeRunRef !== undefined
        ? { lastRunRef: input.runtimeRunRef }
        : {}),
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
