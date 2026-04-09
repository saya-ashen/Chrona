import { db } from "@/lib/db";

function readBlockReason(
  task: {
    blockReason: unknown;
    projection:
      | {
          actionRequired: string | null;
          blockType: string | null;
          blockScope: string | null;
          blockSince: Date | null;
        }
      | null;
  },
) {
  return (
    (task.blockReason as {
      actionRequired?: string;
      blockType?: string;
      scope?: string;
      since?: string;
    } | null) ??
    (task.projection
      ? {
          actionRequired: task.projection.actionRequired ?? undefined,
          blockType: task.projection.blockType ?? undefined,
          scope: task.projection.blockScope ?? undefined,
          since: task.projection.blockSince?.toISOString(),
        }
      : null)
  );
}

export async function getWorkPage(taskId: string) {
  const task = await db.task.findUniqueOrThrow({
    where: { id: taskId },
    include: {
      projection: true,
      events: { orderBy: [{ runtimeTs: "asc" }, { ingestSequence: "asc" }], take: 100 },
      runs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          approvals: { where: { status: "Pending" }, orderBy: { requestedAt: "desc" } },
          artifacts: { orderBy: { createdAt: "desc" } },
          conversationEntries: { orderBy: { sequence: "asc" } },
          toolCallDetails: { orderBy: { createdAt: "asc" } },
        },
      },
    },
  });

  const currentRun = task.runs[0] ?? null;

  return {
    taskShell: {
      id: task.id,
      workspaceId: task.workspaceId,
      title: task.title,
      status: task.projection?.displayState ?? task.status,
      priority: task.priority,
      dueAt: task.dueAt?.toISOString() ?? null,
      blockReason: readBlockReason(task),
    },
    currentRun: currentRun
      ? {
          id: currentRun.id,
          status: currentRun.status,
          startedAt: currentRun.startedAt?.toISOString() ?? null,
          endedAt: currentRun.endedAt?.toISOString() ?? null,
          syncStatus: currentRun.syncStatus,
          resumeSupported: currentRun.resumeSupported,
          pendingInputPrompt: currentRun.pendingInputPrompt,
        }
      : null,
    timeline: task.events.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      payload: event.payload as Record<string, unknown>,
      runtimeTs: event.runtimeTs?.toISOString() ?? null,
    })),
    conversation:
      currentRun?.conversationEntries.map((entry) => ({
        id: entry.id,
        role: entry.role,
        content: entry.content,
        runtimeTs: entry.runtimeTs?.toISOString() ?? null,
      })) ?? [],
    toolCalls:
      currentRun?.toolCallDetails.map((tool) => ({
        id: tool.id,
        toolName: tool.toolName,
        status: tool.status,
        argumentsSummary: tool.argumentsSummary,
        resultSummary: tool.resultSummary,
        errorSummary: tool.errorSummary,
      })) ?? [],
    approvals:
      currentRun?.approvals.map((approval) => ({
        id: approval.id,
        title: approval.title,
        status: approval.status,
        summary: approval.summary,
      })) ?? [],
    artifacts:
      currentRun?.artifacts.map((artifact) => ({
        id: artifact.id,
        title: artifact.title,
        type: artifact.type,
        uri: artifact.uri,
      })) ?? [],
  };
}
