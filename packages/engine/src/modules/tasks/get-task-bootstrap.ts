import { db } from "@/lib/db";
import { isTaskPlanGenerationRunning } from "@/modules/plans/task-plan-generation-registry";
import { getLatestTaskPlanReadModel } from "@/modules/plans/task-plan-read-model";
import { reconcileTaskState } from "@/modules/orchestration/reconcile-task-state";
import { deriveTaskRunnability } from "@chrona/domain";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";

type TaskPlanGenerationStatus = "idle" | "generating" | "waiting_acceptance" | "accepted";

type TaskPageWorkBlock = {
  id: string;
  status: string;
  scheduledStartAt: Date;
  scheduledEndAt: Date;
  trigger: string;
};

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
      blockDetail: string | null;
    } | null;
  }) {
  if (task.status === "Completed" || task.status === "Done") return null;

  const storedBlockReason = task.blockReason as {
    blockType?: string;
    actionRequired?: string;
    detail?: string;
    scope?: string;
    nodeId?: string;
    since?: string;
  } | null;
  const projectedBlockReason = task.projection && (task.projection.blockType || task.projection.actionRequired || task.projection.blockDetail)
    ? {
        blockType: task.projection.blockType ?? undefined,
        actionRequired: task.projection.actionRequired ?? undefined,
        detail: task.projection.blockDetail ?? undefined,
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
      detail: storedBlockReason.detail ?? projectedBlockReason?.detail,
    };
  }

  return projectedBlockReason;
}

function pickTaskPageWorkBlock(workBlocks: TaskPageWorkBlock[], selectedWorkBlockId: string | null, now: Date) {
  if (selectedWorkBlockId) {
    const selected = workBlocks.find((block) => block.id === selectedWorkBlockId);
    if (selected) return selected;
  }

  const active = workBlocks.find((block) => block.status === "Active");
  if (active) return active;

  const inWindowScheduled = workBlocks.find(
    (block) =>
      block.status === "Scheduled" &&
      block.scheduledStartAt.getTime() <= now.getTime() &&
      block.scheduledEndAt.getTime() > now.getTime(),
  );
  if (inWindowScheduled) return inWindowScheduled;

  const overdueScheduled = workBlocks
    .filter((block) => block.status === "Scheduled" && block.scheduledStartAt.getTime() < now.getTime())
    .at(-1);
  if (overdueScheduled) return overdueScheduled;

  const nextScheduled = workBlocks.find(
    (block) => block.status === "Scheduled" && block.scheduledStartAt.getTime() >= now.getTime(),
  );
  if (nextScheduled) return nextScheduled;

  return workBlocks.find((block) => block.status === "Completed") ?? null;
}

export async function getTaskBootstrap(input: { taskId: string; workBlockId?: string | null }) {
  const selectedWorkBlockId = input.workBlockId ?? null;
  const task = await db.task.findUnique({
    where: { id: input.taskId },
    include: {
      projection: true,
      runs: {
        where: selectedWorkBlockId === null ? {} : { workBlockId: selectedWorkBlockId },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      workspace: { select: { defaultRuntime: true } },
      goal: { select: { id: true, title: true } },
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
        include: { calendarSource: { select: { name: true, color: true } } },
      },
      dependencies: {
        include: {
          dependsOnTask: { select: { id: true, title: true, status: true } },
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

  const currentWorkBlock = pickTaskPageWorkBlock(task.workBlocks, selectedWorkBlockId, new Date());
  const planWorkBlockId = selectedWorkBlockId ?? currentWorkBlock?.id ?? null;
  const latestSavedPlan = await getLatestTaskPlanReadModel(input.taskId, planWorkBlockId);
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
  const latestRun = task.runs[0] ?? null;
  const recurrenceOccurrences = [
    { id: task.id, title: task.title, status: task.status, workBlocks: task.workBlocks },
    ...recurrenceSeriesTasks,
  ];
  const savedPlan = latestSavedPlan;
  const aiPlanGenerationStatus: TaskPlanGenerationStatus =
    isTaskPlanGenerationRunning({ taskId: task.id, workBlockId: planWorkBlockId })
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
        taskId: task.id,
        graph: savedPlan.effectivePlan,
        runnable: runnability.isRunnable,
        readinessReason: runnability.summary,
        taskStatus: task.status,
        blockReason: readBlockReason(task),
        hasActiveRun: latestRun?.status === "Pending" || latestRun?.status === "Running",
      })
    : null;

  return {
    task: {
      id: task.id,
      workspaceId: task.workspaceId,
      goalId: task.goalId,
      goal: task.goal,
      title: task.title,
      description: task.description,
      sourceManaged,
      executionRuntime: task.executionRuntime,
      executionConfig: task.executionConfig,
      aiClientId: task.aiClientId,
      autoPlanGeneration: task.autoPlanGeneration,
      autoExecute: task.autoExecute,
      autoPlanGenerationTiming: task.autoPlanGenerationTiming,
      autoExecuteTiming: task.autoExecuteTiming,
      recurrenceRule: task.recurrenceRule,
      status: task.status === "Done" || task.status === "Cancelled" ? task.status : currentWorkBlock?.status ?? task.status,
      priority: task.priority,
      dueAt: task.dueAt?.toISOString() ?? null,
      scheduledStartAt: currentWorkBlock?.scheduledStartAt.toISOString() ?? task.projection?.scheduledStartAt?.toISOString() ?? null,
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
  };
}
