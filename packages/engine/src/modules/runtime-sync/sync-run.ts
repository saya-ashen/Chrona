import { ApprovalStatus, Prisma, RunStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import {
  createRuntimeAdapter,
  type OpenClawAdapter,
} from "@chrona/openclaw";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import { updateTaskSessionStateFromRun } from "@/modules/task-execution/task-sessions";
import {
  progressAcceptedTaskPlan,
  syncParentTaskStateFromAcceptedPlan,
} from "@/modules/commands/progress-accepted-task-plan";
import { syncAcceptedTaskPlanForTask } from "@/modules/tasks/sync-task-plan-graph";
import {
  decodeSyncCursor,
  encodeSyncCursor,
  mapApprovalDelta,
  mapApprovalResolution,
  mapHistoryDelta,
  mapRunLifecycleEvent,
} from "@/modules/runtime-sync/mapper";

function resolveSessionKey(run: {
  taskSession?: { sessionKey: string } | null;
  runtimeSessionRef: string | null;
  cursor?: { sessionKey?: string };
}) {
  if (run.taskSession?.sessionKey) {
    return run.taskSession.sessionKey;
  }

  if (run.cursor?.sessionKey) {
    return run.cursor.sessionKey;
  }

  return run.runtimeSessionRef ?? undefined;
}

function toRunStatus(status: string): RunStatus {
  switch (status) {
    case "Pending":
      return RunStatus.Pending;
    case "WaitingForInput":
      return RunStatus.WaitingForInput;
    case "WaitingForApproval":
      return RunStatus.WaitingForApproval;
    case "Failed":
      return RunStatus.Failed;
    case "Completed":
      return RunStatus.Completed;
    case "Cancelled":
      return RunStatus.Cancelled;
    case "Running":
    default:
      return RunStatus.Running;
  }
}

export async function syncRunFromRuntime(input: {
  runId: string;
  adapter?: OpenClawAdapter;
}) {
  const adapter = input.adapter ?? (await createRuntimeAdapter());
  const cursorRecord = await db.runtimeCursor.findUnique({
    where: { runId: input.runId },
  });
  const cursor = decodeSyncCursor(cursorRecord?.nextCursor);
  const run = await db.run.findUniqueOrThrow({
    where: { id: input.runId },
    include: {
      task: true,
      taskSession: true,
    },
  });

  if (!run.runtimeRunRef) {
    throw new Error(`Run ${run.id} is missing runtimeRunRef`);
  }

  const snapshot = await adapter.getRunSnapshot({
    runtimeRunRef: run.runtimeRunRef,
    runtimeSessionKey: resolveSessionKey({
      taskSession: run.taskSession,
      runtimeSessionRef: run.runtimeSessionRef,
      cursor,
    }),
  });
  const runtimeSessionKey =
    snapshot.runtimeSessionKey ??
    resolveSessionKey({
      taskSession: run.taskSession,
      runtimeSessionRef: run.runtimeSessionRef,
      cursor,
    });

  if (!runtimeSessionKey) {
    throw new Error(
      `Run ${run.id} is missing a runtime session key for history sync`,
    );
  }

  const [history, approvals] = await Promise.all([
    adapter.readHistory({ runtimeSessionKey }),
    adapter.listApprovals({ runtimeSessionKey }),
  ]);
  const pendingApprovals = await db.approval.findMany({
    where: {
      runId: run.id,
      status: ApprovalStatus.Pending,
    },
  });

  const historyDelta = mapHistoryDelta({ history, cursor });
  const approvalDelta = mapApprovalDelta({ approvals, cursor });
  const lifecycleEvent = mapRunLifecycleEvent({
    previousStatus: run.status,
    snapshot,
    runId: run.id,
  });
  const currentApprovalIds = new Set(
    approvals.map((approval) => approval.approvalId),
  );
  const resolvedApprovals =
    snapshot.status === "WaitingForApproval"
      ? []
      : await Promise.all(
          pendingApprovals
            .filter((approval) => !currentApprovalIds.has(approval.id))
            .map(async (approval) => {
              const resolution = mapApprovalResolution({
                approvalId: approval.id,
                decision: await adapter.waitForApprovalDecision(approval.id),
              });

              return {
                approval,
                resolution,
              };
            }),
        );

  for (const entry of historyDelta.conversationEntries) {
    if (!entry.externalRef) {
      continue;
    }

    await db.conversationEntry.upsert({
      where: { externalRef: entry.externalRef },
      update: {
        role: entry.role,
        content: entry.content,
        runtimeTs: entry.runtimeTs,
        sequence: entry.sequence,
      },
      create: {
        runId: run.id,
        role: entry.role,
        content: entry.content,
        runtimeTs: entry.runtimeTs,
        sequence: entry.sequence,
        externalRef: entry.externalRef,
      },
    });
  }

  for (const toolCall of historyDelta.toolCalls) {
    await db.toolCallDetail.upsert({
      where: { externalRef: toolCall.externalRef },
      update: {
        toolName: toolCall.toolName,
        status: toolCall.status,
        argumentsSummary: toolCall.argumentsSummary,
        resultSummary: toolCall.resultSummary,
        errorSummary: toolCall.errorSummary,
        runtimeTs: toolCall.runtimeTs,
      },
      create: {
        runId: run.id,
        toolName: toolCall.toolName,
        status: toolCall.status,
        argumentsSummary: toolCall.argumentsSummary,
        resultSummary: toolCall.resultSummary,
        errorSummary: toolCall.errorSummary,
        runtimeTs: toolCall.runtimeTs,
        externalRef: toolCall.externalRef,
      },
    });
  }

  for (const approval of approvalDelta.approvals) {
    await db.approval.upsert({
      where: { id: approval.approvalId },
      update: {
        type: approval.type,
        title: approval.title,
        summary: approval.summary,
        riskLevel: approval.riskLevel,
        payload: approval.payload as Prisma.InputJsonValue,
        status: ApprovalStatus.Pending,
        requestedAt: approval.requestedAt,
      },
      create: {
        id: approval.approvalId,
        workspaceId: run.task.workspaceId,
        taskId: run.taskId,
        runId: run.id,
        type: approval.type,
        title: approval.title,
        summary: approval.summary,
        riskLevel: approval.riskLevel,
        payload: approval.payload as Prisma.InputJsonValue,
        status: ApprovalStatus.Pending,
        requestedAt: approval.requestedAt,
      },
    });
  }

  for (const { approval, resolution } of resolvedApprovals) {
    await db.approval.update({
      where: { id: approval.id },
      data: {
        status: resolution.status as ApprovalStatus,
        resolvedAt: resolution.resolvedAt,
        resolvedBy: "runtime",
        resolutionNote: resolution.resolutionNote,
      },
    });
  }

  for (const event of [
    ...historyDelta.events,
    ...approvalDelta.events,
    ...resolvedApprovals.map(({ resolution }) => resolution.event),
    ...(lifecycleEvent ? [lifecycleEvent] : []),
  ]) {
    await appendCanonicalEvent({
      eventType: event.eventType,
      workspaceId: run.task.workspaceId,
      taskId: run.taskId,
      runId: run.id,
      actorType: "runtime",
      actorId: run.runtimeName,
      source: "adapter",
      payload: event.payload,
      dedupeKey: event.dedupeKey,
      runtimeTs: event.runtimeTs,
    });
  }

  const now = new Date();
  await db.run.update({
    where: { id: run.id },
    data: {
      status: toRunStatus(snapshot.status),
      runtimeSessionRef: runtimeSessionKey,
      endedAt:
        snapshot.status === "Completed" ||
        snapshot.status === "Failed" ||
        snapshot.status === "Cancelled"
          ? now
          : null,
      errorSummary:
        snapshot.status === "Failed" ? (snapshot.lastMessage ?? null) : null,
      retryable: snapshot.status === "Failed",
      resumeSupported:
        snapshot.status === "WaitingForApproval" ||
        snapshot.status === "WaitingForInput",
      pendingInputPrompt:
        snapshot.status === "WaitingForInput"
          ? (snapshot.lastMessage ?? null)
          : null,
      lastSyncedAt: now,
      syncStatus: "healthy",
      mappingPartial: false,
    },
  });

  const nextRunStatus = toRunStatus(snapshot.status);

  await updateTaskSessionStateFromRun({
    taskSessionId: run.taskSessionId,
    runId: run.id,
    runStatus: nextRunStatus,
    runtimeRunRef: snapshot.runtimeRunRef ?? run.runtimeRunRef,
  });

  if (run.task.parentTaskId) {
    await syncAcceptedTaskPlanForTask({
      taskId: run.task.parentTaskId,
      linkedTaskId: run.taskId,
      taskStatus: snapshot.status,
    });
    if (snapshot.status === "Completed") {
      await progressAcceptedTaskPlan({ parentTaskId: run.task.parentTaskId });
    } else if (snapshot.status === "WaitingForApproval") {
      await db.task.update({
        where: { id: run.task.parentTaskId },
        data: { status: "WaitingForApproval", completedAt: null },
      });
      await rebuildTaskProjection(run.task.parentTaskId);
    } else {
      await syncParentTaskStateFromAcceptedPlan(run.task.parentTaskId);
    }
  }

  const nextCursor = encodeSyncCursor({
    sessionKey: runtimeSessionKey,
    lastMessageSeq: historyDelta.lastMessageSeq,
    lastRunStatus: snapshot.status,
    approvalIds: approvalDelta.approvalIds,
  });

  await db.runtimeCursor.upsert({
    where: { runId: run.id },
    update: {
      runtimeName: run.runtimeName,
      nextCursor,
      lastEventRef:
        historyDelta.lastMessageSeq > 0
          ? `msg:${historyDelta.lastMessageSeq}`
          : cursorRecord?.lastEventRef,
      lastSyncedAt: now,
      healthStatus: "healthy",
      lastError: null,
    },
    create: {
      runId: run.id,
      runtimeName: run.runtimeName,
      nextCursor,
      lastEventRef:
        historyDelta.lastMessageSeq > 0
          ? `msg:${historyDelta.lastMessageSeq}`
          : null,
      lastSyncedAt: now,
      healthStatus: "healthy",
      lastError: null,
    },
  });

  await rebuildTaskProjection(run.taskId);
}
