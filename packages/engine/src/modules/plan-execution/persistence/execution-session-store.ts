import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { OrchestratorTrigger } from "../types";
import { withPlanExecutionDurability } from "./scheduler-durability";

export async function ensureExecutionSession(input: {
  workspaceId: string;
  taskId: string;
  planId: string;
  trigger: OrchestratorTrigger;
  workBlockId?: string | null;
  sessionId?: string;
}, suppliedTx?: Prisma.TransactionClient) {
  return withPlanExecutionDurability((tx) => ensureExecutionSessionInTransaction(input, tx), suppliedTx);
}

async function ensureExecutionSessionInTransaction(input: {
  workspaceId: string;
  taskId: string;
  planId: string;
  trigger: OrchestratorTrigger;
  workBlockId?: string | null;
  sessionId?: string;
}, tx: Prisma.TransactionClient) {
  const occurrence = input.workBlockId
    ? await tx.taskOccurrence.findUnique({ where: { workBlockId: input.workBlockId }, select: { id: true } })
    : null;
  const explicitSession = input.sessionId
    ? await tx.executionSession.findFirst({
        where: { id: input.sessionId, taskId: input.taskId },
      })
    : null;
  if (explicitSession) {
    return tx.executionSession.update({
      where: { id: explicitSession.id },
      data: {
        planId: input.planId,
        workBlockId: input.workBlockId ?? explicitSession.workBlockId,
        occurrenceId: occurrence?.id ?? explicitSession.occurrenceId,
        ...(explicitSession.status === "Active" || explicitSession.status === "Paused"
          ? { activeScopeKey: "active" }
          : {}),
      },
    });
  }

  // The unique activeScopeKey makes the first writer across independent DB
  // connections authoritative for a task's one live execution session.
  return tx.executionSession.upsert({
    where: {
      taskId_activeScopeKey: { taskId: input.taskId, activeScopeKey: "active" },
    },
    update: {
      planId: input.planId,
      workBlockId: input.workBlockId ?? undefined,
      occurrenceId: occurrence?.id ?? undefined,
    },
    create: {
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      planId: input.planId,
      workBlockId: input.workBlockId ?? null,
      occurrenceId: occurrence?.id ?? null,
      activeScopeKey: "active",
      status: "Active",
      currentNodeId: null,
      pauseReason: null,
      completedNodeIds: "[]",
    },
  });
}

export async function abandonActiveExecutionSessions(input: {
  taskId: string;
  workBlockId?: string | null;
  reason?: string;
}, suppliedTx?: Prisma.TransactionClient) {
  return withPlanExecutionDurability((tx) => tx.executionSession.updateMany({

    where: {
      taskId: input.taskId,
      status: { in: ["Active", "Paused"] },
      ...(input.workBlockId !== undefined ? { workBlockId: input.workBlockId } : {}),
    },
    data: {
      activeScopeKey: null,
      status: "Abandoned",
      currentNodeId: null,
      currentNodeAttemptId: null,
      pauseReason: input.reason ?? null,
      completedAt: new Date(),
    },
  }), suppliedTx);
}

export type ExecutionSessionRow = Awaited<ReturnType<typeof ensureExecutionSession>>;

export async function getActiveExecutionWorkBlockId(taskId: string): Promise<string | null> {
  const session = await db.executionSession.findUnique({
    where: { taskId_activeScopeKey: { taskId, activeScopeKey: "active" } },
    select: { workBlockId: true },
  });
  return session?.workBlockId ?? null;
}

export type ActiveExecutionSessionScope = {
  executionSessionId: string;
  workBlockId: string | null;
  occurrenceId: string | null;
  planId: string | null;
};

/**
 * The unique live-session ownership row is the authority for an executing
 * task's plan and work-block scope. Terminal sessions use a NULL scope key.
 */
export async function getActiveExecutionSessionScope(
  taskId: string,
): Promise<ActiveExecutionSessionScope | null> {
  const session = await db.executionSession.findUnique({
    where: { taskId_activeScopeKey: { taskId, activeScopeKey: "active" } },
    select: { id: true, occurrenceId: true, workBlockId: true, planId: true },
  });
  if (!session) return null;
  return {
    executionSessionId: session.id,
    occurrenceId: session.occurrenceId,
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
}, suppliedTx?: Prisma.TransactionClient) {
  return withPlanExecutionDurability((tx) => tx.executionSession.update({
    where: { id: input.sessionId },
    data: {
      status: input.status,
      activeScopeKey: input.status === "Active" || input.status === "Paused" ? "active" : null,
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
  }), suppliedTx);
}
