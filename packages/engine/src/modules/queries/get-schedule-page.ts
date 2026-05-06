import { db } from "@/lib/db";
import {
  buildPlanningSummary,
  formatDateKey,
  startOfDay,
} from "@/components/schedule/schedule-page-utils";
import { getRuntimeTaskConfigSpec, listRuntimeAdapterKeys } from "@/modules/task-execution/registry";
import { syncStaleWorkspaceRunsForRead } from "@/modules/runtime-sync/freshness";
import { deriveTaskRunnability } from "@chrona/shared";
import { analyzeConflicts } from "@/modules/ai/conflict-analyzer";
import type { ScheduledTaskInfo, TaskPlanReadModel } from "@chrona/contracts/ai";
import { getAcceptedCompiledPlan } from "@/modules/plan-execution/compiled-plan-store";
import { getLayers } from "@/modules/plan-execution/plan-run-store";
import { getLatestTaskPlanReadModel } from "@/modules/queries/task-plan-read-model";
import { isTaskPlanGenerationRunning } from "@/modules/commands/task-plan-generation-registry";
import type { ScheduleConflict, ScheduleSuggestion } from "@/components/schedule/schedule-page-types";
import { resolveEffectivePlanGraph } from "@chrona/domain";

function mapProjectionItem(item: Awaited<ReturnType<typeof db.taskProjection.findMany>>[number] & { task: {
  id: string;
  workspaceId: string;
  parentTaskId: string | null;
  title: string;
  description: string | null;
  workspace: { defaultRuntime: string };
  priority: string;
  ownerType: string;
  assigneeAgentId: string | null;
  runtimeAdapterKey: string | null;
  runtimeInput: unknown;
  runtimeInputVersion: string | null;
  runtimeModel: string | null;
  prompt: string | null;
  runtimeConfig: unknown;
} }) {
  return {
    taskId: item.taskId,
    workspaceId: item.workspaceId,
    parentTaskId: item.task.parentTaskId,
    title: item.task.title,
    description: item.task.description,
    priority: item.task.priority,
    ownerType: item.task.ownerType,
    assigneeAgentId: item.task.assigneeAgentId,
    persistedStatus: item.persistedStatus,
    displayState: item.displayState,
    actionRequired: item.actionRequired,
    approvalPendingCount: item.approvalPendingCount ?? 0,
    scheduleStatus: item.scheduleStatus,
    scheduleSource: item.scheduleSource,
    dueAt: item.dueAt,
    scheduledStartAt: item.scheduledStartAt,
    scheduledEndAt: item.scheduledEndAt,
    latestRunStatus: item.latestRunStatus,
    scheduleProposalCount: item.scheduleProposalCount ?? 0,
    lastActivityAt: item.lastActivityAt,
    ...mapTaskRunnability(item.task),
  };
}

function mapTaskRunnability(task: {
  workspace: { defaultRuntime: string };
  runtimeAdapterKey: string | null;
  runtimeInput: unknown;
  runtimeInputVersion: string | null;
  runtimeModel: string | null;
  prompt: string | null;
  runtimeConfig: unknown;
}) {
  const runnability = deriveTaskRunnability({
    workspaceDefaultRuntime: task.workspace.defaultRuntime,
    runtimeAdapterKey: task.runtimeAdapterKey,
    runtimeInput: task.runtimeInput,
    runtimeModel: task.runtimeModel,
    prompt: task.prompt,
    runtimeConfig: task.runtimeConfig,
  });

  return {
    runtimeAdapterKey: task.runtimeAdapterKey,
    runtimeInput: task.runtimeInput,
    runtimeInputVersion: task.runtimeInputVersion,
    runtimeModel: task.runtimeModel,
    prompt: task.prompt,
    runtimeConfig: task.runtimeConfig,
    isRunnable: runnability.isRunnable,
    runnabilityState: runnability.state,
    runnabilitySummary: runnability.summary,
  };
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
    Math.round((item.scheduledEndAt.getTime() - item.scheduledStartAt.getTime()) / 60000),
  );
}

async function getReadyNodeIds(taskId: string) {
  const acceptedPlan = await getAcceptedCompiledPlan(taskId);
  if (!acceptedPlan) {
    return [] as string[];
  }

  const layers = await getLayers(taskId, acceptedPlan.compiledPlan.editablePlanId);
  const effective = resolveEffectivePlanGraph(acceptedPlan.compiledPlan, layers);
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
        const isDeepWork = item.priority === "High" || item.priority === "Urgent";
        return isDeepWork ? sum + getScheduledMinutes(item) : sum;
      }, 0);
      const fragmentedMinutes = dayItems.reduce((sum, item) => {
        const minutes = getScheduledMinutes(item);
        return minutes < 90 ? sum + minutes : sum;
      }, 0);
      const hasHighRisk = dayItems.some(
        (item) => item.scheduleStatus === "Overdue" || item.scheduleStatus === "AtRisk",
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
  const proposalTaskIds = new Set(input.proposals.map((proposal) => proposal.taskId));
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

    if (!item.isRunnable && (!item.prompt || item.runnabilityState !== "ready_to_run")) {
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

    if (item.isRunnable && !blockedByApproval && !blockedByUser && !riskTaskIds.has(item.taskId)) {
      const readyNodeIds = await getReadyNodeIds(item.taskId);
      const sessionStrategy =
        item.runtimeConfig &&
        typeof item.runtimeConfig === "object" &&
        !Array.isArray(item.runtimeConfig) &&
        (item.runtimeConfig as Record<string, unknown>).sessionStrategy === "shared"
          ? "shared"
          : "per_subtask";

      candidates.push({
        taskId: item.taskId,
        kind: "auto_run",
        reason: "Scheduled task is ready to run automatically.",
        priority: item.priority === "Urgent" || item.priority === "High" ? "high" : "medium",
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
  await syncStaleWorkspaceRunsForRead(workspaceId);

  const [workspace, projections, proposals] = await Promise.all([
    db.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { defaultRuntime: true },
    }),
    db.taskProjection.findMany({
      where: { workspaceId },
      include: { task: { include: { workspace: { select: { defaultRuntime: true } } } } },
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
      orderBy: [{ scheduledStartAt: "asc" }, { dueAt: "asc" }, { createdAt: "asc" }],
    }),
  ]);
  const runtimeAdapters = listRuntimeAdapterKeys().map((key) => ({
    key,
    label: key,
    spec: getRuntimeTaskConfigSpec(key),
  }));

  const listItems = projections.map((item) => mapProjectionItem(item));
  const planSnapshots = new Map<string, TaskPlanReadModel>();
  const planStatuses = new Map<string, "idle" | "generating" | "waiting_acceptance" | "accepted">();
  await Promise.all(listItems.map(async (item) => {
    const savedPlan = await getLatestTaskPlanReadModel(item.taskId);
    if (savedPlan) {
      planSnapshots.set(item.taskId, savedPlan);
    }
    planStatuses.set(
      item.taskId,
      isTaskPlanGenerationRunning(item.taskId)
        ? "generating"
        : savedPlan?.status === "accepted"
          ? "accepted"
          : savedPlan
            ? "waiting_acceptance"
            : "idle",
    );
  }));
  const listItemsWithPlanState = listItems.map((item) => ({
    ...item,
    savedPlan: planSnapshots.get(item.taskId) ?? null,
    aiPlanGenerationStatus: planStatuses.get(item.taskId) ?? "idle",
  }));
  const topLevelItems = listItemsWithPlanState.filter((item) => item.parentTaskId === null);

  const scheduled = topLevelItems
    .filter((item) => item.scheduledStartAt && item.scheduledEndAt)
    .map((item) => item);

  const unscheduled = topLevelItems
    .filter((item) => item.scheduleStatus === "Unscheduled")
    .map((item) => item);

  const risks = topLevelItems
    .filter(
      (item) => item.scheduleStatus && ["AtRisk", "Overdue", "Interrupted"].includes(item.scheduleStatus),
    )
    .map((item) => item);

  const topLevelProposals = proposals.filter((proposal) => proposal.task.parentTaskId === null);

  const mappedProposals = topLevelProposals.map((proposal) => ({
    proposalId: proposal.id,
    taskId: proposal.taskId,
    workspaceId: proposal.workspaceId,
    title: proposal.task.title,
    priority: proposal.task.priority,
    ownerType: proposal.task.ownerType,
    assigneeAgentId: proposal.assigneeAgentId,
    source: proposal.source,
    proposedBy: proposal.proposedBy,
    summary: proposal.summary,
    dueAt: proposal.dueAt,
    scheduledStartAt: proposal.scheduledStartAt,
    scheduledEndAt: proposal.scheduledEndAt,
  }));

  const planningSummary = buildPlanningSummary({
    scheduled,
    unscheduled,
    risks,
    proposals: mappedProposals,
  });
  const focusZones = buildFocusZones(scheduled);
  const automationCandidates = await buildAutomationCandidates({
    scheduled,
    unscheduled,
    risks,
    proposals: topLevelProposals,
  });

  // 分析冲突
  const scheduledTasks: ScheduledTaskInfo[] = scheduled
    .filter((s) => s.scheduledStartAt !== null && s.scheduledEndAt !== null)
    .map((s) => ({
      taskId: s.taskId,
      title: s.title,
      priority: s.priority,
      scheduledStartAt: s.scheduledStartAt!,
      scheduledEndAt: s.scheduledEndAt!,
      dueAt: s.dueAt,
      estimatedMinutes: Math.round(
        (s.scheduledEndAt!.getTime() - s.scheduledStartAt!.getTime()) / 60000,
      ),
      dependencies: [], // TODO: 从数据库读取依赖关系
    }));

  const conflictAnalysis = analyzeConflicts(scheduledTasks);

  const workBlocks = await db.workBlock.findMany({
    where: { workspaceId, status: { in: ["Scheduled", "Active"] } },
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

  return {
    defaultRuntimeAdapterKey: workspace.defaultRuntime,
    runtimeAdapters,
    summary: {
      scheduledCount: scheduled.length,
      unscheduledCount: unscheduled.length,
      proposalCount: mappedProposals.length,
      riskCount: risks.length,
    },
    planningSummary,
    focusZones,
    automationCandidates,
    scheduled,
    unscheduled,
    risks,
    listItems: listItemsWithPlanState,
    proposals: mappedProposals,
    conflicts: conflictAnalysis.conflicts as unknown as ScheduleConflict[],
    suggestions: conflictAnalysis.suggestions as unknown as ScheduleSuggestion[],
    workBlocks: actionableWorkBlocks,
  };
}
