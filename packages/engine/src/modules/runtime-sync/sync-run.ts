import { ApprovalStatus, Prisma, RunStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import {
  type OpenClawChatHistory,
  type OpenClawPendingApproval,
  type OpenClawResponseSnapshot,
} from "@chrona/openclaw";
import type { ProviderRunSnapshot } from "@chrona/providers-foundation";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import { updateTaskSessionStateFromRun } from "@/modules/task-execution/task-sessions";
import { taskPlanExecution } from "@/modules/plan-execution";
import {
  decodeSyncCursor,
  encodeSyncCursor,
  mapApprovalDelta,
  mapApprovalResolution,
  mapHistoryDelta,
  mapRunLifecycleEvent,
} from "@/modules/runtime-sync/mapper";
import { aiClientRegistry } from "@/modules/ai/runtime/client-registry";
import { requireAiClient } from "@/modules/ai/runtime/client-resolution";

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

function normalizeResponseStatus(status: string | undefined): string {
  switch (status) {
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case "requires_action":
      return "WaitingForApproval";
    case "queued":
    case "in_progress":
      return "Running";
    default:
      return status ?? "Running";
  }
}

export type OpenClawRuntimeSyncClient = {
  getResponseSnapshot(input: {
    responseId?: string;
    sessionKey?: string;
  }): Promise<OpenClawResponseSnapshot>;
  readSessionHistory(sessionKey: string): Promise<OpenClawChatHistory>;
  listApprovals(): Promise<OpenClawPendingApproval[]>;
  waitForApprovalDecision(approvalId: string): Promise<"allow-once" | "allow-always" | "deny" | null>;
};

function toOpenClawResponseSnapshot(
  snapshot: ProviderRunSnapshot,
  sessionKey?: string,
): OpenClawResponseSnapshot {
  return {
    responseId: snapshot.nativeRunId ?? snapshot.runId,
    sessionId: snapshot.sessionId ?? sessionKey ?? snapshot.runId,
    sessionKey,
    status: snapshot.rawStatus ?? snapshot.status,
    output: snapshot.outputText,
    error: snapshot.error ?? null,
  };
}

async function retrieveOpenClawResponse(
  clientId: string | null,
  responseId: string,
  sessionKey?: string,
): Promise<OpenClawResponseSnapshot> {
  const client = await requireAiClient(clientId, "AI client is required for runtime sync");
  const openClawClient = aiClientRegistry.requireOpenClawClient(client);
  return toOpenClawResponseSnapshot(
    await openClawClient.providerClient.getRun({
      runId: responseId,
      sessionKey,
    }),
    sessionKey,
  );
}

async function createDefaultOpenClawSyncClient(): Promise<OpenClawRuntimeSyncClient> {
  const client = await requireAiClient(
    undefined,
    "Default AI client is required for runtime sync",
  );
  const openClawClient = aiClientRegistry.requireOpenClawClient(client);
  return {
    async getResponseSnapshot(input) {
      if (!input.responseId) {
        throw new Error("OpenClaw responseId is required for runtime sync");
      }
      return retrieveOpenClawResponse(
        openClawClient.record.id,
        input.responseId,
        input.sessionKey,
      );
    },
    async readSessionHistory() {
      return { messages: [] };
    },
    async listApprovals() {
      return [];
    },
    async waitForApprovalDecision() {
      return null;
    },
  };
}

export async function syncRunFromRuntime(input: {
  runId: string;
  client?: OpenClawRuntimeSyncClient;
}) {
  const client = input.client ?? (await createDefaultOpenClawSyncClient());
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

  const snapshot = await client.getResponseSnapshot({
    responseId: run.runtimeRunRef,
    sessionKey: resolveSessionKey({
      taskSession: run.taskSession,
      runtimeSessionRef: run.runtimeSessionRef,
      cursor,
    }),
  });
  const runtimeSessionKey =
    snapshot.sessionKey ??
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
  const snapshotStatus = normalizeResponseStatus(snapshot.status);
  const runtimeRunRef = snapshot.responseId ?? run.runtimeRunRef;
  const snapshotMessage = snapshot.error ?? snapshot.output ?? null;

  const [history, approvals] = await Promise.all([
    client.readSessionHistory(runtimeSessionKey),
    client.listApprovals(),
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
    snapshot: { ...snapshot, status: snapshotStatus },
    runId: run.id,
  });
  const currentApprovalIds = new Set(
    approvals.map((approval) => approval.approvalId),
  );
  const resolvedApprovals =
    snapshotStatus === "WaitingForApproval"
      ? []
      : await Promise.all(
          pendingApprovals
            .filter((approval) => !currentApprovalIds.has(approval.id))
            .map(async (approval) => {
              const resolution = mapApprovalResolution({
                approvalId: approval.id,
                decision: await client.waitForApprovalDecision(approval.id),
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
      source: "provider",
      payload: event.payload,
      dedupeKey: event.dedupeKey,
      runtimeTs: event.runtimeTs,
    });
  }

  const now = new Date();
  await db.run.update({
    where: { id: run.id },
    data: {
      status: toRunStatus(snapshotStatus),
      runtimeSessionRef: runtimeSessionKey,
      endedAt:
        snapshotStatus === "Completed" ||
        snapshotStatus === "Failed" ||
        snapshotStatus === "Cancelled"
          ? now
          : null,
      errorSummary:
        snapshotStatus === "Failed" ? snapshotMessage : null,
      retryable: snapshotStatus === "Failed",
      resumeSupported:
        snapshotStatus === "WaitingForApproval" ||
        snapshotStatus === "WaitingForInput",
      pendingInputPrompt:
        snapshotStatus === "WaitingForInput"
          ? snapshotMessage
          : null,
      lastSyncedAt: now,
      syncStatus: "healthy",
      mappingPartial: false,
    },
  });

  const nextRunStatus = toRunStatus(snapshotStatus);

  await updateTaskSessionStateFromRun({
    taskSessionId: run.taskSessionId,
    runId: run.id,
    runStatus: nextRunStatus,
    runtimeRunRef,
  });

  if (
    snapshotStatus === "Completed" ||
    snapshotStatus === "Failed" ||
    snapshotStatus === "Cancelled"
  ) {
    await taskPlanExecution.syncRuntimeResult({
      taskId: run.taskId,
      runtimeRunRef,
      status: snapshotStatus,
      summary: snapshotMessage,
      error: snapshotStatus === "Failed" ? snapshotMessage : null,
      output: snapshot.output ?? undefined,
    });
  }

  const nextCursor = encodeSyncCursor({
    sessionKey: runtimeSessionKey,
    lastMessageSeq: historyDelta.lastMessageSeq,
    lastRunStatus: snapshotStatus,
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
