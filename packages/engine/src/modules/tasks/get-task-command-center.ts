import { db } from "@/lib/db";
import { buildCommandCenterArtifactsSpec, buildCommandCenterNowSpec, buildCommandCenterTrailSpec, buildTaskHeaderSpec, type TaskHeaderActionInput, type TaskHeaderTaskStatus } from "@chrona/ui-protocol";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";
import {
  buildActivityTimeline,
  mapTimelineItemToActivity,
  orderActivityNewestFirst,
} from "./task-activity";
import { getCurrentExecution } from "../plan-execution/use-cases/get-current-execution";
import { getLatestTaskPlanReadModel } from "@/modules/plans/task-plan-read-model";

function nowTone(status: string) {
  if (status === "completed") return "success" as const;
  if (status === "failed" || status === "blocked") return "danger" as const;
  if (status.startsWith("waiting")) return "warning" as const;
  if (status === "running" || status === "started") return "info" as const;
  return "neutral" as const;
}

function nowTitle(status: string) {
  if (status === "no_plan") return "No accepted plan";
  if (status === "completed") return "Execution complete";
  if (status === "running" || status === "started") return "Execution running";
  if (status.startsWith("waiting")) return "Needs input";
  if (status === "blocked") return "Execution blocked";
  if (status === "failed") return "Execution failed";
  return "Execution status";
}

function taskStatusLabel(status: TaskHeaderTaskStatus) {
  if (status === "approval-needed") return "Approval needed";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function taskHeaderStatus(input: { taskStatus: string; executionStatus: string }): TaskHeaderTaskStatus {
  if (input.executionStatus === "completed" || input.taskStatus === "Completed" || input.taskStatus === "Done") return "completed";
  if (input.executionStatus === "running" || input.executionStatus === "started" || input.taskStatus === "Running") return "running";
  if (input.executionStatus === "waiting_for_user" || input.executionStatus === "waiting_for_approval") return "approval-needed";
  if (input.executionStatus === "blocked" || input.taskStatus === "Blocked") return "blocked";
  return "waiting";
}

function priorityTone(priority: string) {
  if (priority === "Urgent") return "danger" as const;
  if (priority === "High") return "warning" as const;
  return "neutral" as const;
}

function formatOccurrenceWindow(start: Date | null, end: Date | null) {
  if (!start) return null;
  const dateLabel = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", weekday: "short" }).format(start);
  const startLabel = new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit" }).format(start);
  const endLabel = end ? new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit" }).format(end) : null;
  return endLabel ? `${dateLabel} ${startLabel}-${endLabel}` : `${dateLabel} ${startLabel}`;
}

function executionStatusLabel(status: string) {
  if (status === "started" || status === "running") return "Running now";
  if (status === "waiting_for_user") return "Waiting for input";
  if (status === "waiting_for_approval") return "Waiting for approval";
  if (status === "failed") return "Run failed";
  if (status === "blocked") return "Run blocked";
  if (status === "cancelled") return "Run cancelled";
  return null;
}

function headerActions(input: { executionStatus: string; hasPlan: boolean; hasAcceptedPlan: boolean; isRunnable: boolean }): TaskHeaderActionInput[] {
  if (!input.hasPlan) return [{ id: "generate-plan", label: "Generate plan" }];
  if (!input.hasAcceptedPlan) return [{ id: "accept-plan", label: "Accept plan" }];
  if (input.executionStatus === "completed" || input.executionStatus === "cancelled") return [];
  if (input.executionStatus === "running" || input.executionStatus === "started") return [
    { id: "pause", label: "Pause" },
    { id: "stop", label: "Stop" },
  ];
  if (["waiting_for_user", "waiting_for_approval", "blocked", "failed"].includes(input.executionStatus)) return [{ id: "stop", label: "Stop" }];
  return [{ id: "start", label: "Start", disabled: !input.isRunnable, disabledReason: input.isRunnable ? undefined : "Task is not runnable." }];
}

export async function getTaskCommandCenter(input: { taskId: string; workBlockId?: string | null }) {
  const selectedWorkBlockId = input.workBlockId ?? null;
  const currentExecution = await getCurrentExecution({ taskId: input.taskId, workBlockId: selectedWorkBlockId });
  const scopedEventWhere = selectedWorkBlockId !== null
    ? {
        OR: [
          { workBlockId: selectedWorkBlockId },
          ...(currentExecution.mainSessionId ? [{ workBlockId: null, taskSessionId: currentExecution.mainSessionId }] : []),
        ],
      }
    : {};
  const task = await db.task.findUnique({
    where: { id: input.taskId },
    select: {
      title: true,
      status: true,
      priority: true,
      dueAt: true,
      projection: { select: { scheduledStartAt: true, scheduledEndAt: true } },
      importedCalendarEvents: {
        take: 1,
        include: { calendarSource: { select: { name: true } } },
      },
      artifacts: { orderBy: { createdAt: "desc" }, take: 5 },
      timelineItems: {
        where: selectedWorkBlockId !== null ? { workBlockId: selectedWorkBlockId } : {},
        orderBy: [{ sortTime: "desc" }, { createdAt: "desc" }],
        take: 100,
      },
      events: {
        where: scopedEventWhere,
        orderBy: { ingestSequence: "desc" },
        take: 300,
      },
    },
  });
  if (!task) {
    throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Task not found");
  }

  const artifacts = task.artifacts.map((artifact) => ({
    id: artifact.id,
    title: artifact.title,
    type: artifact.type,
    uri: artifact.uri,
  }));
  const activityTimeline = task.timelineItems.length > 0
    ? orderActivityNewestFirst([
        ...task.timelineItems.map(mapTimelineItemToActivity),
        ...buildActivityTimeline([...task.events].reverse()),
      ]).slice(0, 100)
    : buildActivityTimeline([...task.events].reverse());

  const savedPlan = await getLatestTaskPlanReadModel(input.taskId, selectedWorkBlockId);
  const totalSteps = savedPlan?.effectivePlan.nodes.length ?? 0;
  const completedSteps = savedPlan?.effectivePlan.completedNodeIds.length ?? currentExecution.executedNodeIds.length;
  const progressPercent = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;
  const status = taskHeaderStatus({ taskStatus: task.status, executionStatus: currentExecution.status });
  const executionLabel = executionStatusLabel(currentExecution.status);
  const occurrenceWindow = formatOccurrenceWindow(
    task.projection?.scheduledStartAt ?? task.dueAt ?? null,
    task.projection?.scheduledEndAt ?? null,
  );
  const source = task.importedCalendarEvents[0] ?? null;
  const actions = headerActions({
    executionStatus: currentExecution.status,
    hasPlan: Boolean(savedPlan),
    hasAcceptedPlan: savedPlan?.status === "accepted",
    isRunnable: currentExecution.status !== "no_plan",
  });
  actions.push({ id: "edit", label: "Edit" }, { id: "delete", label: "Delete Task" });

  return {
    documents: {
      header: buildTaskHeaderSpec({
        title: task.title,
        status,
        statusLabel: taskStatusLabel(status),
        progressLabel: `${totalSteps} steps · ${completedSteps} accepted · ${progressPercent}%`,
        priorityLabel: task.priority,
        priorityTone: priorityTone(task.priority),
        occurrenceLabel: occurrenceWindow ? `Occurrence · ${occurrenceWindow}` : null,
        sourceLabel: source?.calendarSource.name ?? null,
        executionStatus: {
          status: currentExecution.status,
          label: executionLabel,
          message: currentExecution.message,
        },
        actions,
      }),
      now: buildCommandCenterNowSpec({
        title: nowTitle(currentExecution.status),
        description: currentExecution.message,
        statusLabel: currentExecution.status,
        tone: nowTone(currentExecution.status),
        currentOperationSpec: currentExecution.ui?.currentOperationSpec ?? null,
      }),
      output: buildCommandCenterArtifactsSpec({ artifacts }),
      trail: buildCommandCenterTrailSpec({
        activity: activityTimeline,
        savedCount: activityTimeline.length,
        toolLabels: {
          tool: "Tool",
          input: "Input",
          preview: "Preview",
          duration: "Duration",
          error: "Error",
        },
      }),
    },
  };
}
