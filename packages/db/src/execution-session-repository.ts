import { db } from "./db";
import type { ExecutionSession, Prisma } from "./generated/prisma/client";

export async function getActiveExecutionSession(taskId: string): Promise<ExecutionSession | null> {
  return db.executionSession.findFirst({
    where: {
      taskId,
      status: { in: ["Active", "Paused"] },
    },
    orderBy: { startedAt: "desc" },
  });
}

export async function getSessionByWorkBlock(workBlockId: string): Promise<ExecutionSession | null> {
  return db.executionSession.findFirst({
    where: { workBlockId },
    orderBy: { startedAt: "desc" },
  });
}

export async function createExecutionSession(
  data: Prisma.ExecutionSessionCreateInput,
): Promise<ExecutionSession> {
  return db.executionSession.create({ data });
}
