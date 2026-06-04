import { db } from "@/lib/db";
import type { OrchestratorTrigger } from "../types";

export async function ensureExecutionSession(input: {
  workspaceId: string;
  taskId: string;
  planId: string;
  trigger: OrchestratorTrigger;
  workBlockId?: string | null;
  sessionId?: string;
}) {
  const explicitSession = input.sessionId
    ? await db.executionSession.findFirst({
        where: { id: input.sessionId, taskId: input.taskId },
      })
    : null;
  const candidates = explicitSession
    ? []
    : await db.executionSession.findMany({
        where: {
          taskId: input.taskId,
          status: { in: ["Active", "Paused"] },
        },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        take: 10,
      });
  const existing = explicitSession ??
    candidates.find((candidate) => candidate.currentNodeId) ??
    candidates[0] ??
    null;

  if (existing) {
    return db.executionSession.update({
      where: { id: existing.id },
      data: {
        planId: input.planId,
        workBlockId: input.workBlockId ?? existing.workBlockId,
      },
    });
  }

  return db.executionSession.create({
    data: {
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      planId: input.planId,
      workBlockId: input.workBlockId ?? null,
      status: "Active",
      currentNodeId: null,
      pauseReason: null,
      completedNodeIds: "[]",
    },
  });
}

export type ExecutionSessionRow = Awaited<ReturnType<typeof ensureExecutionSession>>;

export async function getActiveExecutionWorkBlockId(taskId: string): Promise<string | null> {
  const session = await db.executionSession.findFirst({
    where: {
      taskId,
      status: { in: ["Active", "Paused"] },
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: { workBlockId: true },
  });
  return session?.workBlockId ?? null;
}

export type ActiveExecutionSessionScope = {
  executionSessionId: string;
  workBlockId: string | null;
  planId: string | null;
};

/**
 * The authoritative "what is currently executing for this task" record. A live
 * (Active/Paused) ExecutionSession is the single source of truth for the work
 * block + plan an in-flight provider is operating on — callers that only hold a
 * taskId (e.g. MCP tools resolved from a sessionId) recover the work block from
 * here instead of guessing a null scope.
 */
export async function getActiveExecutionSessionScope(
  taskId: string,
): Promise<ActiveExecutionSessionScope | null> {
  const session = await db.executionSession.findFirst({
    where: {
      taskId,
      status: { in: ["Active", "Paused"] },
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: { id: true, workBlockId: true, planId: true },
  });
  if (!session) return null;
  return {
    executionSessionId: session.id,
    workBlockId: session.workBlockId,
    planId: session.planId,
  };
}

export async function setExecutionSessionState(input: {
  sessionId: string;
  status: "Active" | "Paused" | "Completed" | "Abandoned";
  currentNodeId?: string | null;
  currentNodeAttemptId?: string | null;
  pauseReason?: string | null;
  completedNodeIds?: string[];
  pausedByEventId?: string | null;
  pausedByRawEventId?: string | null;
  latestEventId?: string | null;
  latestRawEventId?: string | null;
}) {
  return db.executionSession.update({
    where: { id: input.sessionId },
    data: {
      status: input.status,
      currentNodeId: input.currentNodeId,
      currentNodeAttemptId: input.currentNodeAttemptId,
      pauseReason: input.pauseReason,
      completedNodeIds: input.completedNodeIds
        ? JSON.stringify(input.completedNodeIds)
        : undefined,
      pausedAt: input.status === "Paused" ? new Date() : null,
      pausedByEventId: input.status === "Paused" ? input.pausedByEventId : null,
      pausedByRawEventId: input.status === "Paused" ? input.pausedByRawEventId : null,
      latestEventId: input.latestEventId,
      latestRawEventId: input.latestRawEventId,
      completedAt:
        input.status === "Completed" || input.status === "Abandoned"
          ? new Date()
          : null,
    },
  });
}
