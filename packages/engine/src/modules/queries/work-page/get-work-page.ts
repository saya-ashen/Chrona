import { db } from "@/lib/db";
import { syncTaskRunForRead } from "@/modules/runtime-sync/freshness";
import { getAcceptedCompiledPlan, getLatestCompiledPlan } from "@/modules/plan-execution/compiled-plan-store";
import { getLayers } from "@/modules/plan-execution/plan-run-store";
import { resolveEffectivePlanGraph } from "@chrona/domain";
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
  const savedPlan = (await getAcceptedCompiledPlan(task.id)) ?? (await getLatestCompiledPlan(task.id));
  const effectivePlanGraph = savedPlan && savedPlan.status === "accepted"
    ? resolveEffectivePlanGraph(savedPlan.compiledPlan, await getLayers(task.id, savedPlan.compiledPlan.editablePlanId))
    : null;
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

  const planExecution = (() => {
    if (!effectivePlanGraph) {
      return {
        status: "no_plan" as const,
        currentNodeId: null,
        executedNodeIds: [] as string[],
        waitingNodeIds: [] as string[],
        blockedNodeIds: [] as string[],
        message: "No accepted plan.",
      };
    }

    const effective = effectivePlanGraph;

    const executed = effective.completedNodeIds;
    const waiting = effective.nodes
      .filter((n) => n.status === "waiting_for_user")
      .map((n) => n.id);
    const blocked = effective.blockedNodeIds;
    const inProgress = effective.nodes.find((n) => n.status === "running");

    const allDone = effective.pendingNodeIds.length === 0 && effective.runningNodeIds.length === 0 && effective.blockedNodeIds.length === 0 && effective.failedNodeIds.length === 0;

    if (allDone) {
      return {
        status: "completed" as const,
        currentNodeId: null,
        executedNodeIds: executed,
        waitingNodeIds: waiting,
        blockedNodeIds: blocked,
        message: "All plan nodes completed.",
      };
    }

    if (task.status === "WaitingForInput" && waiting.length > 0) {
      return {
        status: "waiting_for_user" as const,
        currentNodeId: waiting[0],
        executedNodeIds: executed,
        waitingNodeIds: waiting,
        blockedNodeIds: blocked,
        message: task.blockReason
          ? (task.blockReason as { actionRequired?: string }).actionRequired ??
            "Waiting for user input"
          : "Waiting for user input",
      };
    }

    if (task.status === "WaitingForApproval") {
      return {
        status: "waiting_for_approval" as const,
        currentNodeId: inProgress?.id ?? null,
        executedNodeIds: executed,
        waitingNodeIds: waiting,
        blockedNodeIds: blocked,
        message: task.blockReason
          ? (task.blockReason as { actionRequired?: string }).actionRequired ??
            "Waiting for approval"
          : "Waiting for approval",
      };
    }

    if (task.status === "Blocked" && blocked.length > 0) {
      return {
        status: "blocked" as const,
        currentNodeId: blocked[0],
        executedNodeIds: executed,
        waitingNodeIds: waiting,
        blockedNodeIds: blocked,
        message: task.blockReason
          ? (task.blockReason as { actionRequired?: string }).actionRequired ??
            "Execution is blocked"
          : "Execution is blocked",
      };
    }

    return {
      status: "running" as const,
      currentNodeId: inProgress?.id ?? null,
      executedNodeIds: executed,
      waitingNodeIds: waiting,
      blockedNodeIds: blocked,
      message: "Executing plan nodes.",
    };
  })();

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
  const scheduleImpact = buildScheduleImpact({
    scheduleStatus: task.projection?.scheduleStatus ?? "Unscheduled",
    dueAt: task.dueAt,
    scheduledStartAt: task.projection?.scheduledStartAt ?? null,
    scheduledEndAt: task.projection?.scheduledEndAt ?? null,
  }, mergedCopy);
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
  const taskPlan = buildTaskPlanFromGraph({ savedPlan, effectivePlanGraph }) ?? {
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
      scheduledStartAt: toIsoString(task.projection?.scheduledStartAt ?? null),
      scheduledEndAt: toIsoString(task.projection?.scheduledEndAt ?? null),
      scheduleStatus: task.projection?.scheduleStatus ?? "Unscheduled",
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
      planExecution,
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
    planExecution,
    inspector: {
      approvals,
      artifacts,
      toolCalls,
    },
  };
}
