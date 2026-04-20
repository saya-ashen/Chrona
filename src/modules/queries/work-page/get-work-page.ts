import { db } from "@/lib/db";
import { syncTaskRunForRead } from "@/modules/runtime-sync/freshness";
import { getAcceptedTaskPlanGraph, getLatestTaskPlanGraph } from "@/modules/tasks/task-plan-graph-store";
import { WorkPageTaskNotFoundError, DEFAULT_COPY } from "./types";
import type { WorkPageCopy } from "./types";
import { isMissingRecordError, toIsoString, classifyWorkstreamItem, formatEventTitle, summarizePayload } from "./helpers";
import {
  buildScheduleImpact,
  readBlockReason,
  buildTaskPlanFromGraph,
  buildCurrentIntervention,
  buildLatestOutput,
  buildReliability,
  buildClosureState,
  buildWorkspaceRail,
} from "./builders";

export async function getWorkPage(taskId: string, copy: Partial<WorkPageCopy> = {}) {
  const mergedCopy = { ...DEFAULT_COPY, ...copy };

  const taskExists = await db.task.findUnique({
    where: { id: taskId },
    select: { id: true },
  });

  if (!taskExists) {
    throw new WorkPageTaskNotFoundError(taskId);
  }

  try {
    await syncTaskRunForRead(taskId, undefined, { forceActive: true });
  } catch (error) {
    if (isMissingRecordError(error)) {
      const taskStillExists = await db.task.findUnique({
        where: { id: taskId },
        select: { id: true },
      });

      if (!taskStillExists) {
        throw new WorkPageTaskNotFoundError(taskId);
      }
    }

    throw error;
  }
  const now = new Date();

  const task = await db.task.findUnique({
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

  if (!task) {
    throw new WorkPageTaskNotFoundError(taskId);
  }

  const workspaceProjections = await db.taskProjection.findMany({
    where: { workspaceId: task.workspaceId },
    include: {
      task: {
        select: {
          id: true,
          title: true,
        },
      },
    },
    orderBy: [{ lastActivityAt: "desc" }, { updatedAt: "desc" }],
    take: 24,
  });

  const currentRun = task.runs[0] ?? null;
  const latestFollowUp = await db.task.findFirst({
    where: { parentTaskId: task.id },
    orderBy: { createdAt: "desc" },
  });
  const savedPlan = (await getAcceptedTaskPlanGraph(task.id)) ?? (await getLatestTaskPlanGraph(task.id));
  const blockReason = readBlockReason(task);
  const approvals =
    currentRun?.approvals.map((approval) => ({
      id: approval.id,
      title: approval.title,
      status: approval.status,
      summary: approval.summary,
    })) ?? [];
  const allConversationEntries = await db.conversationEntry.findMany({
    where: { run: { taskId: task.id } },
    include: {
      run: {
        select: {
          id: true,
          createdAt: true,
        },
      },
    },
    orderBy: [{ runtimeTs: "asc" }, { createdAt: "asc" }, { sequence: "asc" }],
  });
  const conversation = allConversationEntries
    .slice()
    .sort((left, right) => {
      const leftRuntimeTs = left.runtimeTs?.getTime() ?? Number.POSITIVE_INFINITY;
      const rightRuntimeTs = right.runtimeTs?.getTime() ?? Number.POSITIVE_INFINITY;

      if (leftRuntimeTs !== rightRuntimeTs) {
        return leftRuntimeTs - rightRuntimeTs;
      }

      const leftRunCreatedAt = left.run.createdAt.getTime();
      const rightRunCreatedAt = right.run.createdAt.getTime();
      if (leftRunCreatedAt !== rightRunCreatedAt) {
        return leftRunCreatedAt - rightRunCreatedAt;
      }

      if (left.runId !== right.runId) {
        return left.runId.localeCompare(right.runId);
      }

      return left.sequence - right.sequence;
    })
    .map((entry) => ({
      id: entry.id,
      role: entry.role,
      content: entry.content,
      runtimeTs: toIsoString(entry.runtimeTs),
    }));
  const artifacts =
    currentRun?.artifacts.map((artifact) => ({
      id: artifact.id,
      title: artifact.title,
      type: artifact.type,
      uri: artifact.uri,
      createdAt: toIsoString(artifact.createdAt),
    })) ?? [];
  const toolCalls =
    currentRun?.toolCallDetails.map((tool) => ({
      id: tool.id,
      toolName: tool.toolName,
      status: tool.status,
      argumentsSummary: tool.argumentsSummary,
      resultSummary: tool.resultSummary,
      errorSummary: tool.errorSummary,
    })) ?? [];
  const workstreamItems = task.events.map((event) => {
    const eventInfo = classifyWorkstreamItem(event.eventType, mergedCopy);

    return {
      id: event.id,
      eventType: event.eventType,
      title: formatEventTitle(event.eventType),
      summary: summarizePayload(event.payload as Record<string, unknown>),
      payload: event.payload as Record<string, unknown>,
      runtimeTs: toIsoString(event.runtimeTs),
      runId: event.runId,
      kind: eventInfo.kind,
      badge: eventInfo.badge,
      whyItMatters: eventInfo.whyItMatters,
      linkedEvidenceLabel: eventInfo.linkedEvidenceLabel,
    };
  });
  const serializedRun = currentRun
    ? {
        id: currentRun.id,
        status: currentRun.status,
        startedAt: toIsoString(currentRun.startedAt),
        endedAt: toIsoString(currentRun.endedAt),
        updatedAt: toIsoString(currentRun.updatedAt),
        lastSyncedAt: toIsoString(currentRun.lastSyncedAt),
        syncStatus: currentRun.syncStatus,
        resumeSupported: currentRun.resumeSupported,
        pendingInputPrompt: currentRun.pendingInputPrompt,
        errorSummary: currentRun.errorSummary,
      }
    : null;

  const latestOutput = buildLatestOutput({
    artifacts: currentRun?.artifacts.map((artifact) => ({
      id: artifact.id,
      title: artifact.title,
      type: artifact.type,
      uri: artifact.uri,
      createdAt: artifact.createdAt,
    })) ?? [],
    conversation: currentRun?.conversationEntries.map((entry) => ({
      id: entry.id,
      role: entry.role,
      content: entry.content,
      runtimeTs: entry.runtimeTs,
    })) ?? [],
    copy: mergedCopy,
  });
  const scheduleImpact = buildScheduleImpact(task, mergedCopy);
  const reliability = buildReliability({
    currentRun: serializedRun,
    blockReason,
    now,
  });
  const closure = buildClosureState({
    task: {
      status: task.status,
      completedAt: task.completedAt,
    },
    currentRun: serializedRun,
    events: task.events.map((event) => ({
      eventType: event.eventType,
      runId: event.runId,
      createdAt: event.createdAt,
    })),
    latestFollowUp,
  });
  const taskPlan = buildTaskPlanFromGraph({ savedPlan }) ?? {
    state: "empty" as const,
    revision: null,
    generatedBy: null,
    isMock: false,
    summary: null,
    updatedAt: null,
    changeSummary: null,
    currentStepId: null,
    steps: [],
    edges: [],
  };

  return {
    taskShell: {
      id: task.id,
      workspaceId: task.workspaceId,
      title: task.title,
      runtimeModel: task.runtimeModel,
      prompt: task.prompt,
      status: task.projection?.displayState ?? task.status,
      priority: task.priority,
      dueAt: toIsoString(task.dueAt),
      scheduledStartAt: toIsoString(task.scheduledStartAt),
      scheduledEndAt: toIsoString(task.scheduledEndAt),
      scheduleStatus: task.scheduleStatus,
      blockReason,
    },
    currentRun: serializedRun,
    currentIntervention: buildCurrentIntervention({
      taskTitle: task.title,
      currentRun: serializedRun,
      approvals,
      blockReason,
      latestOutput,
      workstreamItems,
      toolCalls,
      scheduleImpact,
      copy: mergedCopy,
    }),
    latestOutput,
    scheduleImpact,
    reliability,
    closure,
    taskPlan,
    workspaceRail: buildWorkspaceRail(task.id, workspaceProjections, {
      title: task.title,
      persistedStatus: task.status,
      displayState: task.projection?.displayState ?? null,
    }),
    workstreamItems,
    conversation,
    composerValue: "",
    inspector: {
      approvals,
      artifacts,
      toolCalls,
    },
  };
}
