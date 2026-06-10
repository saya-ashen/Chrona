import { db } from "@/lib/db";
import { isTaskPlanGenerationRunning } from "@/modules/plans/task-plan-generation-registry";
import { getLatestTaskPlanReadModel } from "@/modules/plans/task-plan-read-model";
import { reconcileTaskState } from "@/modules/orchestration/reconcile-task-state";
import {
  getRuntimeTaskConfigSpec,
  listExecutionRuntimes,
} from "@/modules/execution-runtime";
import { deriveTaskRunnability } from "@chrona/shared";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";
import {
  buildActivityTimeline,
  mapTimelineItemToActivity,
  orderActivityNewestFirst,
} from "./task-activity";

type TaskPlanGenerationStatus =
  | "idle"
  | "generating"
  | "waiting_acceptance"
  | "accepted";

type RecurrenceOccurrenceReadModel = {
  taskId: string;
  title: string;
  status: string;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  workBlockId: string | null;
  isCurrent: boolean;
};

function readBlockReason(task: {
  status: string;
  blockReason: unknown;
  projection: {
      blockType: string | null;
      actionRequired: string | null;
      blockScope: string | null;
      blockSince: Date | null;
      currentNodeId: string | null;
    } | null;
  }) {
  if (task.status === "Completed" || task.status === "Done") return null;

  const storedBlockReason = task.blockReason as {
    blockType?: string;
    actionRequired?: string;
    scope?: string;
    nodeId?: string;
    since?: string;
  } | null;
  const projectedBlockReason = task.projection && (task.projection.blockType || task.projection.actionRequired)
    ? {
        blockType: task.projection.blockType ?? undefined,
        actionRequired: task.projection.actionRequired ?? undefined,
        scope: task.projection.blockScope ?? undefined,
        nodeId: task.projection.currentNodeId ?? undefined,
        since: task.projection.blockSince?.toISOString(),
      }
    : null;

  if (storedBlockReason) {
    return {
      ...storedBlockReason,
      nodeId: storedBlockReason.nodeId ?? projectedBlockReason?.nodeId,
      since: storedBlockReason.since ?? projectedBlockReason?.since,
    };
  }

  return projectedBlockReason;
}

type TaskPageWorkBlock = {
  id: string;
  status: string;
  scheduledStartAt: Date;
  scheduledEndAt: Date;
  trigger: string;
};

function pickTaskPageWorkBlock(workBlocks: TaskPageWorkBlock[], selectedWorkBlockId: string | null, now: Date) {
  if (selectedWorkBlockId) {
    const selected = workBlocks.find((block) => block.id === selectedWorkBlockId);
    if (selected) return selected;
  }

  const active = workBlocks.find((block) => block.status === "Active");
  if (active) return active;

  const nextScheduled = workBlocks.find(
    (block) => block.status === "Scheduled" && block.scheduledStartAt.getTime() >= now.getTime(),
  );
  if (nextScheduled) return nextScheduled;

  const overdueScheduled = workBlocks.find((block) => block.status === "Scheduled");
  if (overdueScheduled) return overdueScheduled;

  return workBlocks.find((block) => block.status === "Completed") ?? null;
}

export async function getTaskPage(input: { taskId: string; workBlockId?: string | null } | string) {
  const taskId = typeof input === "string" ? input : input.taskId;
  const selectedWorkBlockId = typeof input === "string" ? null : input.workBlockId ?? null;
  const latestSavedPlan = await getLatestTaskPlanReadModel(taskId, selectedWorkBlockId);

  const task = await db.task.findUnique({
    where: { id: taskId },
    include: {
      projection: true,
      runs: { orderBy: { createdAt: "desc" }, take: 1 },
      approvals: { orderBy: { requestedAt: "desc" }, take: 5 },
      artifacts: { orderBy: { createdAt: "desc" }, take: 5 },
      timelineItems: {
        where: selectedWorkBlockId !== null ? { workBlockId: selectedWorkBlockId } : {},
        orderBy: [{ sortTime: "desc" }, { createdAt: "desc" }],
        take: 100,
      },
      events: {
        where: selectedWorkBlockId !== null ? { workBlockId: selectedWorkBlockId } : {},
        orderBy: { ingestSequence: "desc" },
        take: 300,
      },
      scheduleProposals: {
        where: { status: "Pending" },
        orderBy: { createdAt: "desc" },
        take: 5,
      },
      workspace: {
        select: { defaultRuntime: true },
      },
      workBlocks: {
        where: { status: { in: ["Scheduled", "Active", "Completed"] } },
        orderBy: [
          { status: "asc" },
          { scheduledStartAt: "asc" },
          { updatedAt: "desc" },
        ],
        take: 50,
      },
      importedCalendarEvents: {
        take: 1,
        include: {
          calendarSource: { select: { name: true, color: true } },
        },
      },
      dependencies: {
        include: {
          dependsOnTask: {
            select: { id: true, title: true, status: true },
          },
        },
      },
    },
  });
  if (!task) {
    throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Task not found");
  }

  const recurrenceSeriesTasks = task.seriesExternalUid
    ? await db.task.findMany({
        where: {
          workspaceId: task.workspaceId,
          seriesExternalUid: task.seriesExternalUid,
          id: { not: task.id },
        },
        select: {
          id: true,
          title: true,
          status: true,
          workBlocks: {
            where: { status: { in: ["Scheduled", "Active", "Completed"] } },
            orderBy: [
              { status: "asc" },
              { scheduledStartAt: "asc" },
              { updatedAt: "desc" },
            ],
            take: 50,
          },
        },
      })
    : [];

  const latestRun = task.runs[0] ?? null;
  const currentWorkBlock = pickTaskPageWorkBlock(task.workBlocks, selectedWorkBlockId, new Date());
  const importedEvent = task.importedCalendarEvents[0] ?? null;
  const sourceManaged = importedEvent
    ? {
        source: "external_calendar" as const,
        eventId: importedEvent.id,
        sourceName: importedEvent.calendarSource.name,
        sourceColor: importedEvent.calendarSource.color,
        description: importedEvent.description,
        immutableFields: ["title", "scheduledStartAt", "scheduledEndAt"] as const,
      }
    : null;
  const recurrenceOccurrences = [
    { id: task.id, title: task.title, status: task.status, workBlocks: task.workBlocks },
    ...recurrenceSeriesTasks,
  ];
  const savedPlan = latestSavedPlan;
  const aiPlanGenerationStatus: TaskPlanGenerationStatus =
    isTaskPlanGenerationRunning({ taskId, workBlockId: selectedWorkBlockId })
      ? "generating"
      : savedPlan !== null && savedPlan.status === "accepted"
        ? "accepted"
        : savedPlan !== null
          ? "waiting_acceptance"
          : "idle";
  const runnability = deriveTaskRunnability({
    executionRuntime: task.executionRuntime || task.workspace.defaultRuntime,
    executionConfig: task.executionConfig,
  });
  const orchestratorState = savedPlan?.effectivePlan
    ? reconcileTaskState({
        taskId,
        graph: savedPlan.effectivePlan,
        runnable: runnability.isRunnable,
        readinessReason: runnability.summary,
        taskStatus: task.status,
        blockReason: readBlockReason(task),
      })
    : null;

  const activityTimeline = task.timelineItems.length > 0
    ? orderActivityNewestFirst([
        ...task.timelineItems.map(mapTimelineItemToActivity),
        ...buildActivityTimeline([...task.events].reverse()),
      ]).slice(0, 100)
    : buildActivityTimeline([...task.events].reverse());
  const artifacts = task.artifacts.map((artifact) => ({
    id: artifact.id,
    title: artifact.title,
    type: artifact.type,
    uri: artifact.uri,
  }));

  return {
    defaultExecutionRuntime: task.workspace.defaultRuntime,
    executionRuntimes: listExecutionRuntimes().map((key) => ({
      key,
      label: key,
      spec: getRuntimeTaskConfigSpec(key),
    })),
    task: {
      id: task.id,
      workspaceId: task.workspaceId,
      title: task.title,
      description: task.description,
      sourceManaged,
      executionRuntime: task.executionRuntime,
      executionConfig: task.executionConfig,
      autoPlanGeneration: task.autoPlanGeneration,
      autoExecute: task.autoExecute,
      autoPlanGenerationTiming: task.autoPlanGenerationTiming,
      autoExecuteTiming: task.autoExecuteTiming,
      recurrenceRule: task.recurrenceRule,
      status: currentWorkBlock?.status ?? task.status,
      priority: task.priority,
      dueAt: task.dueAt?.toISOString() ?? null,
      scheduledStartAt:
        currentWorkBlock?.scheduledStartAt.toISOString() ?? task.projection?.scheduledStartAt?.toISOString() ?? null,
      recurrenceOccurrences: recurrenceOccurrences
        .flatMap<RecurrenceOccurrenceReadModel>((occurrence) => {
          if (occurrence.workBlocks.length === 0) {
            return [{
              taskId: occurrence.id,
              title: occurrence.title,
              status: occurrence.status,
              scheduledStartAt: null,
              scheduledEndAt: null,
              workBlockId: null,
              isCurrent: occurrence.id === task.id && !currentWorkBlock,
            }];
          }

          return occurrence.workBlocks.map((workBlock) => ({
            taskId: occurrence.id,
            title: occurrence.title,
            status: workBlock.status,
            scheduledStartAt: workBlock.scheduledStartAt.toISOString(),
            scheduledEndAt: workBlock.scheduledEndAt.toISOString(),
            workBlockId: workBlock.id,
            isCurrent: occurrence.id === task.id && currentWorkBlock?.id === workBlock.id,
          }));
        })
        .sort((left, right) => {
          if (left.scheduledStartAt && right.scheduledStartAt) return left.scheduledStartAt.localeCompare(right.scheduledStartAt);
          if (left.scheduledStartAt) return -1;
          if (right.scheduledStartAt) return 1;
          return left.title.localeCompare(right.title);
        }),
      scheduledEndAt: currentWorkBlock?.scheduledEndAt.toISOString() ?? task.projection?.scheduledEndAt?.toISOString() ?? null,
      scheduleStatus: currentWorkBlock?.status ?? task.projection?.scheduleStatus ?? "Unscheduled",
      scheduleSource: currentWorkBlock
        ? currentWorkBlock.trigger === "scheduled"
          ? "ai"
          : currentWorkBlock.trigger === "manual"
            ? "human"
            : null
        : task.projection?.scheduleSource ?? null,
      currentWorkBlock: currentWorkBlock
        ? {
            id: currentWorkBlock.id,
            status: currentWorkBlock.status,
            scheduledStartAt: currentWorkBlock.scheduledStartAt.toISOString(),
            scheduledEndAt: currentWorkBlock.scheduledEndAt.toISOString(),
          }
        : null,
      isRunnable: runnability.isRunnable,
      runnabilityState: runnability.state,
      runnabilitySummary: runnability.summary,
      savedPlan,
      aiPlanGenerationStatus,
      blockReason: readBlockReason(task),
      dependencies: task.dependencies.map((dependency) => ({
        id: dependency.id,
        dependencyType: dependency.dependencyType,
        dependsOnTask: dependency.dependsOnTask,
      })),
      executionSummary: orchestratorState?.summary ?? null,
      graphNodeStates: orchestratorState?.nodes ?? [],
    },
    reconciliation: orchestratorState?.reconciliation ?? null,
    latestRunSummary: latestRun
      ? {
          id: latestRun.id,
          status: latestRun.status,
          startedAt: latestRun.startedAt?.toISOString() ?? null,
          syncStatus: latestRun.syncStatus,
        }
      : null,
    scheduleProposals: task.scheduleProposals.map((proposal) => ({
      id: proposal.id,
      source: proposal.source,
      proposedBy: proposal.proposedBy,
      summary: proposal.summary,
      status: proposal.status,
      dueAt: proposal.dueAt?.toISOString() ?? null,
      scheduledStartAt: proposal.scheduledStartAt?.toISOString() ?? null,
      scheduledEndAt: proposal.scheduledEndAt?.toISOString() ?? null,
    })),
    approvals: task.approvals.map((approval) => ({
      id: approval.id,
      title: approval.title,
      status: approval.status,
      riskLevel: approval.riskLevel,
      requestedAt: approval.requestedAt.toISOString(),
    })),
    artifacts,
    activityTimeline,
  };
}
