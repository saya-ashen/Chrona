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

export async function setExecutionSessionState(input: {
  sessionId: string;
  status: "Active" | "Paused" | "Completed" | "Abandoned";
  currentNodeId?: string | null;
  pauseReason?: string | null;
  completedNodeIds?: string[];
}) {
  return db.executionSession.update({
    where: { id: input.sessionId },
    data: {
      status: input.status,
      currentNodeId: input.currentNodeId,
      pauseReason: input.pauseReason,
      completedNodeIds: input.completedNodeIds
        ? JSON.stringify(input.completedNodeIds)
        : undefined,
      pausedAt: input.status === "Paused" ? new Date() : null,
      completedAt:
        input.status === "Completed" || input.status === "Abandoned"
          ? new Date()
          : null,
    },
  });
}
