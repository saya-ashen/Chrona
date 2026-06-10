import { db } from "@/lib/db";
import { buildTaskHeaderSpec, type TaskHeaderActionInput, type TaskHeaderOccurrenceOptionInput, type TaskHeaderTaskStatus } from "@chrona/ui-protocol";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";
import { getCurrentExecution } from "../plan-execution/use-cases/get-current-execution";
import { getLatestTaskPlanReadModel } from "@/modules/plans/task-plan-read-model";

// Shared header builder. Both `getTaskCommandCenter` and the dedicated
// `getTaskHeaderSpec` use case call this so the header document stays
// byte-identical regardless of which endpoint serves it.
export type HeaderTaskView = NonNullable<Awaited<ReturnType<typeof loadHeaderTaskView>>>;

async function loadHeaderTaskView(taskId: string) {
  return db.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      workspaceId: true,
      seriesExternalUid: true,
      title: true,
      status: true,
      priority: true,
      dueAt: true,
      projection: { select: { scheduledStartAt: true, scheduledEndAt: true } },
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
        include: { calendarSource: { select: { name: true } } },
      },
    },
  });
}

function taskStatusLabel(status: TaskHeaderTaskStatus) {
  if (status === "approval-needed") return "Approval needed";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function taskHeaderStatus(input: { taskStatus: string; executionStatus: string }): TaskHeaderTaskStatus {
  if (input.executionStatus === "running") return "running";
  if (input.executionStatus === "waiting_for_user" || input.executionStatus === "waiting_for_approval") return "approval-needed";
  if (input.executionStatus === "blocked" || input.taskStatus === "Blocked") return "blocked";
  if (input.executionStatus === "failed") return "blocked";
  if (input.executionStatus === "completed" || input.taskStatus === "Completed" || input.taskStatus === "Done") return "completed";
  if (input.taskStatus === "Running") return "running";
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

type HeaderWorkBlock = {
  id: string;
  status: string;
  scheduledStartAt: Date;
  scheduledEndAt: Date;
};

type HeaderOccurrenceSortOption = {
  option: TaskHeaderOccurrenceOptionInput;
  sortTime: number;
};

function pickHeaderWorkBlock(workBlocks: HeaderWorkBlock[], selectedWorkBlockId: string | null, now: Date) {
  if (selectedWorkBlockId) {
    const selected = workBlocks.find((block) => block.id === selectedWorkBlockId);
    if (selected) return selected;
  }
  const active = workBlocks.find((block) => block.status === "Active");
  if (active) return active;
  return workBlocks.find((block) => block.scheduledStartAt.getTime() <= now.getTime() && block.scheduledEndAt.getTime() > now.getTime())
    ?? workBlocks.find((block) => block.scheduledStartAt.getTime() > now.getTime())
    ?? workBlocks[0]
    ?? null;
}

function occurrenceValue(taskId: string, workBlockId: string | null) {
  return workBlockId ? `${taskId}:${workBlockId}` : taskId;
}

function occurrenceLabel(input: { title: string; status: string; start: Date | null; end: Date | null }) {
  const window = formatOccurrenceWindow(input.start, input.end);
  return window ? `${window} · ${input.status}` : `${input.title} · ${input.status}`;
}

function headerActions(input: { executionStatus: string; hasPlan: boolean; hasAcceptedPlan: boolean; isRunnable: boolean }): TaskHeaderActionInput[] {
  if (!input.hasPlan) return [{ id: "generate-plan", label: "Generate plan" }];
  if (!input.hasAcceptedPlan) return [{ id: "accept-plan", label: "Accept plan" }];
  if (input.executionStatus === "completed" || input.executionStatus === "cancelled") return [];
  if (input.executionStatus === "running") return [
    { id: "pause", label: "Pause" },
    { id: "stop", label: "Stop" },
  ];
  if (["waiting_for_user", "waiting_for_approval", "blocked", "failed"].includes(input.executionStatus)) return [{ id: "stop", label: "Stop" }];
  return [{ id: "start", label: "Start", disabled: !input.isRunnable, disabledReason: input.isRunnable ? undefined : "Task is not runnable." }];
}

export type BuildHeaderSpecInput = {
  task: NonNullable<Awaited<ReturnType<typeof loadHeaderTaskView>>>;
  recurrenceSeriesTasks: Array<Pick<NonNullable<Awaited<ReturnType<typeof loadHeaderTaskView>>>, "id" | "title" | "status" | "workBlocks">>;
  currentExecution: Awaited<ReturnType<typeof getCurrentExecution>>;
  savedPlan: Awaited<ReturnType<typeof getLatestTaskPlanReadModel>>;
  workBlockId: string | null;
};

/**
 * Pure transformer: header task view + current execution + saved plan →
 * header `UiDocument`. Used by `getTaskHeaderSpec` (the dedicated use case)
 * and by `getTaskCommandCenter` (which now returns `now / output / trail`
 * only — header lives on its own endpoint).
 */
export function buildHeaderSpecFromTask(input: BuildHeaderSpecInput) {
  const { task, recurrenceSeriesTasks, currentExecution, savedPlan, workBlockId } = input;
  const now = new Date();
  const currentWorkBlock = pickHeaderWorkBlock(task.workBlocks, workBlockId, now);
  const recurrenceOccurrences = [
    { id: task.id, title: task.title, status: task.status, workBlocks: task.workBlocks },
    ...recurrenceSeriesTasks,
  ];
  const occurrenceOptions = recurrenceOccurrences
    .flatMap<HeaderOccurrenceSortOption>((occurrence) => {
      if (occurrence.workBlocks.length === 0) {
        return [{
          option: {
            value: occurrenceValue(occurrence.id, null),
            label: occurrenceLabel({ title: occurrence.title, status: occurrence.status, start: null, end: null }),
            taskId: occurrence.id,
            date: null,
            workBlockId: null,
          },
          sortTime: Number.MAX_SAFE_INTEGER,
        }];
      }
      return occurrence.workBlocks.map((workBlock) => ({
        option: {
          value: occurrenceValue(occurrence.id, workBlock.id),
          label: occurrenceLabel({ title: occurrence.title, status: workBlock.status, start: workBlock.scheduledStartAt, end: workBlock.scheduledEndAt }),
          taskId: occurrence.id,
          date: workBlock.scheduledStartAt.toISOString().slice(0, 10),
          workBlockId: workBlock.id,
        },
        sortTime: workBlock.scheduledStartAt.getTime(),
      }));
    })
    .sort((left, right) => left.sortTime - right.sortTime)
    .map(({ option }) => option satisfies TaskHeaderOccurrenceOptionInput);
  const occurrenceValueCurrent = occurrenceValue(task.id, currentWorkBlock?.id ?? null);
  const totalSteps = savedPlan?.effectivePlan.nodes.length ?? 0;
  const completedSteps = savedPlan?.effectivePlan.completedNodeIds.length ?? currentExecution.executedNodeIds.length;
  const progressPercent = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;
  const status = taskHeaderStatus({ taskStatus: task.status, executionStatus: currentExecution.status });
  const occurrenceWindow = formatOccurrenceWindow(
    currentWorkBlock?.scheduledStartAt ?? task.projection?.scheduledStartAt ?? task.dueAt ?? null,
    currentWorkBlock?.scheduledEndAt ?? task.projection?.scheduledEndAt ?? null,
  );
  const source = task.importedCalendarEvents[0] ?? null;
  const actions = headerActions({
    executionStatus: currentExecution.status,
    hasPlan: Boolean(savedPlan),
    hasAcceptedPlan: savedPlan?.status === "accepted",
    isRunnable: currentExecution.status !== "no_plan",
  });
  actions.push({ id: "edit", label: "Edit" }, { id: "delete", label: "Delete Task" });

  return buildTaskHeaderSpec({
    title: task.title,
    status,
    statusLabel: taskStatusLabel(status),
    progressLabel: `${totalSteps} steps · ${completedSteps} accepted · ${progressPercent}%`,
    priorityLabel: task.priority,
    priorityTone: priorityTone(task.priority),
    occurrenceLabel: occurrenceWindow ? `Occurrence · ${occurrenceWindow}` : null,
    sourceLabel: source?.calendarSource.name ?? null,
    occurrenceValue: occurrenceValueCurrent,
    occurrenceOptions,
    actions,
  });
}

async function loadRecurrenceSeriesTasks(task: NonNullable<Awaited<ReturnType<typeof loadHeaderTaskView>>>) {
  if (!task.seriesExternalUid) return [] as Array<Pick<typeof task, "id" | "title" | "status" | "workBlocks">>;
  return db.task.findMany({
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
  });
}

/**
 * Dedicated header use case for `GET /api/tasks/:taskId/workspace/header`.
 * Loads the same task + execution + plan view used by command-center, but
 * returns only the header `UiDocument` so the frontend can keep the
 * header spec on its own cache key and independent invalidation.
 */
export async function getTaskHeaderSpec(input: { taskId: string; workBlockId?: string | null }) {
  const selectedWorkBlockId = input.workBlockId ?? null;
  const task = await loadHeaderTaskView(input.taskId);
  if (!task) {
    throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Task not found");
  }
  const [currentExecution, savedPlan, recurrenceSeriesTasks] = await Promise.all([
    getCurrentExecution({ taskId: input.taskId, workBlockId: selectedWorkBlockId }),
    getLatestTaskPlanReadModel(input.taskId, selectedWorkBlockId),
    loadRecurrenceSeriesTasks(task),
  ]);
  const spec = buildHeaderSpecFromTask({
    task,
    recurrenceSeriesTasks,
    currentExecution,
    savedPlan,
    workBlockId: selectedWorkBlockId,
  });
  return { spec };
}
