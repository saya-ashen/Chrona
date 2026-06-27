import { db } from "@/lib/db";
import {
  buildPlanningSummary,
  formatDateKey,
  startOfDay,
} from "@chrona/domain";
import {
  getRuntimeTaskConfigSpec,
  listExecutionRuntimes,
} from "@/modules/execution-runtime";
import type { TaskPlanReadModel } from "@chrona/contracts/ai";
import { deriveTaskRunnability } from "@chrona/shared";
import { getAcceptedCompiledPlanForTask } from "@/modules/plan-execution/persistence/execution-scope";
import { getLatestTaskPlanReadModel, resolveSavedPlanEffectiveGraph } from "@/modules/plans/task-plan-read-model";
import { isTaskPlanGenerationRunning } from "@/modules/plans/task-plan-generation-registry";
import { deriveAutoStartEligibility } from "@/modules/scheduling/derive-auto-start-eligibility";

function mapProjectionItem(
  item: Awaited<ReturnType<typeof db.taskProjection.findMany>>[number] & {
    task: {
      id: string;
      workspaceId: string;
      parentTaskId: string | null;
      title: string;
      description: string | null;
      workspace: { defaultRuntime: string };
      priority: string;
      executionRuntime: string;
      executionConfig: unknown;
      aiClientId: string | null;
      autoPlanGeneration: boolean;
      autoExecute: boolean;
      autoPlanGenerationTiming: string;
      autoExecuteTiming: string;
      kind: string;
      recurrenceRule: string | null;
      importedCalendarEvents: Array<{
        id: string;
        description: string | null;
        calendarSource: { name: string; color: string };
      }>;
    };
  },
) {
  const importedEvent = item.task.importedCalendarEvents[0] ?? null;
  return {
    taskId: item.taskId,
    workspaceId: item.workspaceId,
    parentTaskId: item.task.parentTaskId,
    title: item.task.title,
    description: item.task.description,
    priority: item.task.priority,
    persistedStatus: item.persistedStatus,
    displayState: item.displayState,
    actionRequired: item.actionRequired,
    approvalPendingCount: item.approvalPendingCount,
    scheduleStatus: item.scheduleStatus,
    scheduleSource: item.scheduleSource,
    dueAt: item.dueAt,
    scheduledStartAt: item.scheduledStartAt,
    scheduledEndAt: item.scheduledEndAt,
    latestRunStatus: item.latestRunStatus,
    scheduleProposalCount: item.scheduleProposalCount,
    lastActivityAt: item.lastActivityAt,
    autoPlanGeneration: item.task.autoPlanGeneration,
    autoExecute: item.task.autoExecute,
    autoPlanGenerationTiming: item.task.autoPlanGenerationTiming,
    autoExecuteTiming: item.task.autoExecuteTiming,
    aiClientId: item.task.aiClientId,
    kind: item.task.kind,
    recurrenceRule: item.task.recurrenceRule,
    sourceManaged: importedEvent
      ? {
          source: "external_calendar" as const,
          eventId: importedEvent.id,
          sourceName: importedEvent.calendarSource.name,
          sourceColor: importedEvent.calendarSource.color,
          description: importedEvent.description,
          immutableFields: ["title", "scheduledStartAt", "scheduledEndAt"] as const,
        }
      : null,
    ...mapTaskRunnability(item.task),
  };
}

function mapWorkBlockItem(
  block: Awaited<ReturnType<typeof db.workBlock.findMany>>[number] & {
    task: {
      id: string;
      workspaceId: string;
      parentTaskId: string | null;
      title: string;
      description: string | null;
      status: string;
      dueAt: Date | null;
      workspace: { defaultRuntime: string };
      priority: string;
      executionRuntime: string;
      executionConfig: unknown;
      aiClientId: string | null;
      autoPlanGeneration: boolean;
      autoExecute: boolean;
      autoPlanGenerationTiming: string;
      autoExecuteTiming: string;
      kind: string;
      recurrenceRule: string | null;
      importedCalendarEvents: Array<{
        id: string;
        description: string | null;
        calendarSource: { name: string; color: string };
      }>;
    };
    importedCalendarEvent: {
      id: string;
      description: string | null;
      calendarSource: { name: string; color: string };
    } | null;
  },
) {
  const importedEvent = block.importedCalendarEvent ?? block.task.importedCalendarEvents[0];
  const scheduleStatus = block.status === "Completed" ? "Completed" : "Scheduled";
  return {
    taskId: block.taskId,
    workBlockId: block.id,
    workspaceId: block.workspaceId,
    parentTaskId: block.task.parentTaskId,
    title: block.title,
    description: block.task.description,
    priority: block.task.priority,
    persistedStatus: block.task.status,
    displayState: block.status,
    actionRequired: null,
    approvalPendingCount: 0,
    scheduleStatus,
    scheduleSource: "system",
    dueAt: block.task.dueAt,
    scheduledStartAt: block.scheduledStartAt,
    scheduledEndAt: block.scheduledEndAt,
    latestRunStatus: null,
    scheduleProposalCount: 0,
    lastActivityAt: block.startedAt ?? block.task.dueAt,
    autoPlanGeneration: block.task.autoPlanGeneration,
    autoExecute: block.task.autoExecute,
    autoPlanGenerationTiming: block.task.autoPlanGenerationTiming,
    autoExecuteTiming: block.task.autoExecuteTiming,
    aiClientId: block.task.aiClientId,
    kind: block.task.kind,
    recurrenceRule: block.task.recurrenceRule,
    sourceManaged: importedEvent
      ? {
          source: "external_calendar" as const,
          eventId: importedEvent.id,
          sourceName: importedEvent.calendarSource.name,
          sourceColor: importedEvent.calendarSource.color,
          description: importedEvent.description,
          immutableFields: ["title", "scheduledStartAt", "scheduledEndAt"] as const,
        }
      : null,
    ...mapTaskRunnability(block.task),
  };
}

function mapTaskRunnability(task: {
  workspace: { defaultRuntime: string };
  executionRuntime: string;
  executionConfig: unknown;
}) {
  const executionRuntime = task.executionRuntime || task.workspace.defaultRuntime;
  const runnability = deriveTaskRunnability({
    executionRuntime,
    executionConfig: task.executionConfig,
  });

  return {
    executionRuntime,
    executionConfig: task.executionConfig,
    isRunnable: runnability.isRunnable,
    runnabilityState: runnability.state,
    runnabilitySummary: runnability.summary,
  };
}

function mapScheduleTaskPlanSnapshot(savedPlan: TaskPlanReadModel | null) {
  if (!savedPlan) {
    return null;
  }

  return {
    id: savedPlan.id,
    status: savedPlan.status,
    revision: savedPlan.revision,
    summary: savedPlan.summary,
    updatedAt: savedPlan.updatedAt,
    generatedBy: savedPlan.generatedBy,
  };
}

function hasTask<T extends { task: unknown }>(
  item: T,
): item is T & { task: NonNullable<T["task"]> } {
  return item.task !== null;
}

function getScheduledMinutes(item: {
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
}) {
  if (!item.scheduledStartAt || !item.scheduledEndAt) {
    return 0;
  }

  return Math.max(
    0,
    Math.round(
      (item.scheduledEndAt.getTime() - item.scheduledStartAt.getTime()) / 60000,
    ),
  );
}

async function getReadyNodeIds(taskId: string, workBlockId?: string | null) {
  const acceptedPlan = await getAcceptedCompiledPlanForTask(taskId, { workBlockId });
  if (!acceptedPlan) {
    return [] as string[];
  }

  const effective = await resolveSavedPlanEffectiveGraph(acceptedPlan);
  return effective.readyNodeIds;
}

function buildFocusZones(items: Array<ReturnType<typeof mapProjectionItem>>) {
  const byDay = new Map<string, Array<ReturnType<typeof mapProjectionItem>>>();

  for (const item of items) {
    if (!item.scheduledStartAt || !item.scheduledEndAt) {
      continue;
    }

    const dayKey = formatDateKey(startOfDay(item.scheduledStartAt));
    const group = byDay.get(dayKey) ?? [];
    group.push(item);
    byDay.set(dayKey, group);
  }

  return Array.from(byDay.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([dayKey, dayItems]) => {
      const totalMinutes = dayItems.reduce(
        (sum, item) => sum + getScheduledMinutes(item),
        0,
      );
      const deepWorkMinutes = dayItems.reduce((sum, item) => {
        const isDeepWork =
          item.priority === "High" || item.priority === "Urgent";
        return isDeepWork ? sum + getScheduledMinutes(item) : sum;
      }, 0);
      const fragmentedMinutes = dayItems.reduce((sum, item) => {
        const minutes = getScheduledMinutes(item);
        return minutes < 90 ? sum + minutes : sum;
      }, 0);
      const hasHighRisk = dayItems.some(
        (item) =>
          item.scheduleStatus === "Overdue" || item.scheduleStatus === "AtRisk",
      );
      const riskLevel: "low" | "medium" | "high" = hasHighRisk
        ? "high"
        : fragmentedMinutes >= 120 || totalMinutes > 8 * 60
          ? "medium"
          : "low";

      return {
        dayKey,
        totalMinutes,
        deepWorkMinutes,
        fragmentedMinutes,
        riskLevel,
      };
    });
}

async function buildAutomationCandidates(input: {
  scheduled: Array<ReturnType<typeof mapProjectionItem>>;
  unscheduled: Array<ReturnType<typeof mapProjectionItem>>;
  risks: Array<ReturnType<typeof mapProjectionItem>>;
  proposals: Awaited<ReturnType<typeof db.scheduleProposal.findMany>>;
}) {
  const today = startOfDay(new Date());
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const proposalTaskIds = new Set(
    input.proposals.map((proposal) => proposal.taskId),
  );
  const riskTaskIds = new Set(input.risks.map((item) => item.taskId));
  const candidates: Array<{
    taskId: string;
    kind: "auto_schedule" | "generate_plan" | "remind" | "auto_run";
    reason: string;
    priority: "low" | "medium" | "high";
    scheduledStartAt?: Date | null;
    executionMode?: "automatic" | "manual" | "hybrid" | "child_task" | "none";
    sessionStrategy?: "shared" | "per_subtask";
    readyNodeIds?: string[];
  }> = [];

  for (const item of input.unscheduled) {
    const isDueSoon =
      item.dueAt !== null &&
      item.dueAt.getTime() >= today.getTime() &&
      item.dueAt.getTime() < tomorrow.getTime();

    if (isDueSoon && proposalTaskIds.has(item.taskId)) {
      candidates.push({
        taskId: item.taskId,
        kind: "auto_schedule",
        reason: "Due soon and already has a pending proposal.",
        priority: "high",
      });
      continue;
    }

    if (!item.isRunnable) {
      candidates.push({
        taskId: item.taskId,
        kind: "generate_plan",
        reason: "Task needs execution details before it can run.",
        priority: isDueSoon ? "high" : "medium",
      });
    }
  }

  for (const item of input.risks) {
    if (
      item.actionRequired === "Schedule task" ||
      item.actionRequired === "Reschedule task" ||
      item.latestRunStatus === "WaitingForInput" ||
      item.latestRunStatus === "WaitingForApproval"
    ) {
      candidates.push({
        taskId: item.taskId,
        kind: "remind",
        reason:
          item.actionRequired === "Reschedule task"
            ? "Risk item is waiting on user rescheduling."
            : "Task is blocked on user follow-up.",
        priority:
          item.scheduleStatus === "Overdue" || item.scheduleStatus === "AtRisk"
            ? "high"
            : "medium",
      });
    }
  }

  for (const item of input.scheduled) {
    const blockedByApproval = item.approvalPendingCount > 0;
    const blockedByUser =
      item.latestRunStatus === "WaitingForInput" ||
      item.latestRunStatus === "WaitingForApproval" ||
      item.actionRequired === "Schedule task" ||
      item.actionRequired === "Reschedule task";

    if (
      item.isRunnable &&
      !blockedByApproval &&
      !blockedByUser &&
      !riskTaskIds.has(item.taskId)
    ) {
      const readyNodeIds = await getReadyNodeIds(item.taskId);
      const sessionStrategy =
        item.executionConfig &&
        typeof item.executionConfig === "object" &&
        !Array.isArray(item.executionConfig) &&
        (item.executionConfig as Record<string, unknown>).sessionStrategy ===
          "shared"
          ? "shared"
          : "per_subtask";

      candidates.push({
        taskId: item.taskId,
        kind: "auto_run",
        reason: "Scheduled task is ready to run automatically.",
        priority:
          item.priority === "Urgent" || item.priority === "High"
            ? "high"
            : "medium",
        scheduledStartAt: item.scheduledStartAt,
        executionMode: readyNodeIds.length > 0 ? "automatic" : "none",
        sessionStrategy,
        readyNodeIds,
      });
    }
  }

  return candidates;
}

export async function getSchedulePage(workspaceId: string) {
  const [workspace, projections, proposals] = await Promise.all([
    db.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { defaultRuntime: true },
    }),
    db.taskProjection.findMany({
      where: { workspaceId },
      include: {
        task: {
          include: {
            workspace: { select: { defaultRuntime: true } },
            importedCalendarEvents: {
              include: { calendarSource: { select: { name: true, color: true } } },
              orderBy: { startsAt: "asc" },
            },
          },
        },
      },
      orderBy: [
        { scheduledStartAt: "asc" },
        { dueAt: "asc" },
        { lastActivityAt: "desc" },
        { updatedAt: "desc" },
      ],
    }),
    db.scheduleProposal.findMany({
      where: {
        workspaceId,
        status: "Pending",
        source: "ai",
      },
      include: { task: true },
      orderBy: [
        { scheduledStartAt: "asc" },
        { dueAt: "asc" },
        { createdAt: "asc" },
      ],
    }),
  ]);
  const executionRuntimes = listExecutionRuntimes().map((key) => ({
    key,
    label: key,
    spec: getRuntimeTaskConfigSpec(key),
  }));
  const availableAiClients = await db.aiClient.findMany({
    where: { enabled: true },
    select: { id: true, name: true, enabled: true },
    orderBy: { createdAt: "asc" },
  });

  const listItems = projections.filter(hasTask).map((item) => mapProjectionItem(item));
  const planSnapshots = new Map<
    string,
    NonNullable<ReturnType<typeof mapScheduleTaskPlanSnapshot>>
  >();
  const planStatuses = new Map<
    string,
    "idle" | "generating" | "waiting_acceptance" | "accepted"
  >();
  await Promise.all(
    listItems.map(async (item) => {
      const savedPlan = await getLatestTaskPlanReadModel(item.taskId);
      if (savedPlan) {
        const snapshot = mapScheduleTaskPlanSnapshot(savedPlan);
        if (snapshot) {
          planSnapshots.set(item.taskId, snapshot);
        }
      }
      planStatuses.set(
        item.taskId,
        isTaskPlanGenerationRunning({ taskId: item.taskId, workBlockId: null })
          ? "generating"
          : savedPlan?.status === "accepted"
            ? "accepted"
            : savedPlan
              ? "waiting_acceptance"
              : "idle",
      );
    }),
  );
  const listItemsWithPlanState = listItems.map((item) => ({
    ...item,
    savedPlan: planSnapshots.get(item.taskId) ?? null,
    aiPlanGenerationStatus: planStatuses.get(item.taskId) ?? "idle",
  }));
  const topLevelItems = listItemsWithPlanState.filter(
    (item) => item.parentTaskId === null,
  );

  const scheduled = topLevelItems
    .filter((item) => item.scheduledStartAt && item.scheduledEndAt)
    .map((item) => item);

  const unscheduled = topLevelItems
    .filter(
      (item) =>
        item.scheduleStatus === "Unscheduled" && item.persistedStatus !== "Completed",
    )
    .map((item) => item);

  const risks = topLevelItems
    .filter(
      (item) =>
        item.scheduleStatus &&
        ["AtRisk", "Overdue", "Interrupted"].includes(item.scheduleStatus),
    )
    .map((item) => item);

  const topLevelProposals = proposals.filter(hasTask).filter(
    (proposal) => proposal.task.parentTaskId === null,
  );

  const mappedProposals = topLevelProposals.map((proposal) => ({
    proposalId: proposal.id,
    taskId: proposal.taskId,
    workspaceId: proposal.workspaceId,
    title: proposal.task.title,
    priority: proposal.task.priority,
    source: proposal.source,
    proposedBy: proposal.proposedBy,
    summary: proposal.summary,
    dueAt: proposal.dueAt,
    scheduledStartAt: proposal.scheduledStartAt,
    scheduledEndAt: proposal.scheduledEndAt,
  }));

  const workBlocks = await db.workBlock.findMany({
    where: { workspaceId, status: { in: ["Scheduled", "Active"] } },
    include: {
      task: {
        select: {
          id: true,
          workspaceId: true,
          status: true,
          dueAt: true,
          workspace: { select: { defaultRuntime: true } },
          kind: true,
          title: true,
          description: true,
          priority: true,
          executionRuntime: true,
          executionConfig: true,
          aiClientId: true,
          autoPlanGeneration: true,
          autoExecute: true,
          autoPlanGenerationTiming: true,
          autoExecuteTiming: true,
          recurrenceRule: true,
          parentTaskId: true,
          importedCalendarEvents: {
            include: { calendarSource: { select: { name: true, color: true } } },
            take: 1,
          },
        },
      },
      importedCalendarEvent: {
        select: {
          id: true,
          description: true,
          calendarSource: { select: { name: true, color: true } },
        },
      },
    },
    orderBy: { scheduledStartAt: "asc" },
  });

  const actionableWorkBlocks = workBlocks.map((block) => ({
    id: block.id,
    taskId: block.taskId,
    planId: block.planId,
    title: block.title,
    status: block.status,
    scheduledStartAt: block.scheduledStartAt,
    scheduledEndAt: block.scheduledEndAt,
    startedAt: block.startedAt,
    trigger: block.trigger,
  }));

  const workBlockScheduledItemsBase = workBlocks
    .map((block) => mapWorkBlockItem(block))
    .filter((item) => item.parentTaskId === null);
  // Batch one query for active runs across all scheduled tasks so the
  // eligibility derivation can reuse the same `already_running` signal as the
  // auto-start runner without N+1 reads.
  const scheduledTaskIds = Array.from(
    new Set(workBlockScheduledItemsBase.map((item) => item.taskId)),
  );
  const activeRuns = scheduledTaskIds.length
    ? await db.run.findMany({
        where: {
          taskId: { in: scheduledTaskIds },
          status: { in: ["Pending", "Running", "WaitingForInput", "WaitingForApproval"] },
        },
        select: { taskId: true, status: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      })
    : [];
  const activeRunByTaskId = new Map<string, { status: string }>();
  for (const run of activeRuns) {
    if (!activeRunByTaskId.has(run.taskId)) {
      activeRunByTaskId.set(run.taskId, { status: run.status });
    }
  }
  const eligibilityNow = new Date();
  const workBlockScheduledItems = await Promise.all(workBlockScheduledItemsBase.map(async (item) => {
    const savedPlan = await getLatestTaskPlanReadModel(item.taskId, item.workBlockId);
    const snapshot = savedPlan ? mapScheduleTaskPlanSnapshot(savedPlan) : null;
    const aiPlanGenerationStatus = isTaskPlanGenerationRunning({ taskId: item.taskId, workBlockId: item.workBlockId })
      ? "generating" as const
      : savedPlan?.status === "accepted"
        ? "accepted" as const
        : savedPlan
          ? "waiting_acceptance" as const
          : "idle" as const;
    const eligibility = deriveAutoStartEligibility({
      task: {
        status: item.persistedStatus,
        executionRuntime: item.executionRuntime,
        hasAcceptedPlan: savedPlan?.status === "accepted",
        autoExecuteTiming: item.autoExecuteTiming,
      },
      workBlock: { scheduledStartAt: item.scheduledStartAt },
      now: eligibilityNow,
      activeRun: activeRunByTaskId.get(item.taskId) ?? null,
    });
    return {
      ...item,
      savedPlan: snapshot,
      aiPlanGenerationStatus,
      autoStartEligible: eligibility.ok,
      autoStartReason: eligibility.ok ? null : eligibility.reason,
    };
  }));
  const workBlockScheduledKeys = new Set(
    workBlockScheduledItems.map((item) => `${item.taskId}:${item.scheduledStartAt.getTime()}:${item.scheduledEndAt.getTime()}`),
  );
  const allScheduled = [...workBlockScheduledItems, ...scheduled.filter((item) => (
    !workBlockScheduledKeys.has(`${item.taskId}:${item.scheduledStartAt?.getTime() ?? ""}:${item.scheduledEndAt?.getTime() ?? ""}`)
  ))].sort(
    (a, b) => (a.scheduledStartAt?.getTime() ?? 0) - (b.scheduledStartAt?.getTime() ?? 0),
  );

  const planningSummary = buildPlanningSummary({
    scheduled: allScheduled,
    unscheduled,
    risks,
    proposals: mappedProposals,
  });
  const focusZones = buildFocusZones(allScheduled);
  const automationCandidates = await buildAutomationCandidates({
    scheduled: allScheduled,
    unscheduled,
    risks,
    proposals: topLevelProposals,
  });

  return {
    defaultExecutionRuntime: workspace.defaultRuntime,
    executionRuntimes,
    availableAiClients,
    summary: {
      scheduledCount: allScheduled.length,
      unscheduledCount: unscheduled.length,
      proposalCount: mappedProposals.length,
      riskCount: risks.length,
    },
    planningSummary,
    focusZones,
    automationCandidates,
    scheduled: allScheduled,
    unscheduled,
    risks,
    listItems: listItemsWithPlanState,
    proposals: mappedProposals,
    workBlocks: actionableWorkBlocks,
  };
}
