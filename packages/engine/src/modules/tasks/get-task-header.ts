import { db } from "@/lib/db";
import { buildTaskHeaderSpec, type TaskHeaderActionInput, type TaskHeaderOccurrenceOptionInput, type TaskHeaderSpecInput, type TaskHeaderTaskStatus } from "@chrona/ui-protocol";
import { deriveWorkStateView } from "@chrona/domain";
import type { PlanExecutionStatus } from "@chrona/contracts/ai";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";
import { getCurrentExecution } from "../plan-execution/use-cases/get-current-execution";
import { getLatestTaskPlanReadModel } from "@/modules/plans/task-plan-read-model";

type HeaderTaskView = NonNullable<Awaited<ReturnType<typeof loadHeaderTaskView>>>;

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

function taskStatusLabel(input: {
  status: TaskHeaderTaskStatus;
  executionStatus: PlanExecutionStatus;
  taskStatus: string;
}) {
  const workState = deriveWorkStateView({
    taskStatus: input.taskStatus,
    executionStatus: input.executionStatus,
  });
  if (input.status === "approval-needed" || input.status === "blocked" || input.status === "completed") return workState.label;
  return input.status.charAt(0).toUpperCase() + input.status.slice(1);
}

function workspaceStateGuidance(input: {
  status: TaskHeaderTaskStatus;
  executionStatus: PlanExecutionStatus;
  taskStatus: string;
  planStatus?: string | null;
  hasPlan?: boolean;
  hasAcceptedPlan?: boolean;
}) {
  const workState = deriveWorkStateView({
    taskStatus: input.taskStatus,
    executionStatus: input.executionStatus,
    planStatus: input.planStatus,
    hasPlan: input.hasPlan,
    hasAcceptedPlan: input.hasAcceptedPlan,
  });
  return workState.nextActionLabel;
}

const ACTIVE_EXECUTION_STATUSES = new Set<PlanExecutionStatus>([
  "running",
  "waiting_for_user",
  "waiting_for_approval",
  "blocked",
  "failed",
]);

function isActiveExecutionStatus(status: PlanExecutionStatus): boolean {
  return ACTIVE_EXECUTION_STATUSES.has(status);
}

export function taskHeaderStatus(input: {
  taskStatus: string;
  executionStatus: PlanExecutionStatus;
  hasActiveExecution: boolean;
}): TaskHeaderTaskStatus {
  if (input.executionStatus === "running") return "running";
  if (input.executionStatus === "waiting_for_user" || input.executionStatus === "waiting_for_approval") {
    return "approval-needed";
  }
  if (input.executionStatus === "blocked" || input.executionStatus === "failed") return "blocked";
  if (input.hasActiveExecution && input.taskStatus === "Blocked") return "blocked";
  if (
    input.executionStatus === "completed" ||
    input.taskStatus === "Completed" ||
    input.taskStatus === "Done"
  ) {
    return "completed";
  }
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
    ?? workBlocks[0];
}

function occurrenceValue(taskId: string, workBlockId: string | null) {
  return workBlockId ? `${taskId}:${workBlockId}` : taskId;
}

function occurrenceLabel(input: { title: string; status: string; start: Date | null; end: Date | null }) {
  const window = formatOccurrenceWindow(input.start, input.end);
  return window ? `${window} · ${input.status}` : `${input.title} · ${input.status}`;
}

export type HeaderExecutionState = {
  hasPlan: boolean;
  hasAcceptedPlan: boolean;
  isRunnable: boolean;
  executionStatus: string;
  canStart: boolean;
  canPause: boolean;
  canStop: boolean;
  showAcceptPlan: boolean;
  showGeneratePlan: boolean;
  startDisabled: boolean;
  startDisabledReason: string | null;
};

export function resolveHeaderExecutionState(input: {
  executionStatus: string;
  hasPlan: boolean;
  hasAcceptedPlan: boolean;
  isRunnable: boolean;
  startDisabledReason?: string | null;
}): HeaderExecutionState {
  const terminal = input.executionStatus === "completed" || input.executionStatus === "cancelled";
  const running = input.executionStatus === "running";
  const blockedOrFailed = input.executionStatus === "blocked" || input.executionStatus === "failed";
  const stoppable = running
    || input.executionStatus === "waiting_for_user"
    || input.executionStatus === "waiting_for_approval";
  const showStart = !terminal && !running && !stoppable && !blockedOrFailed && input.hasAcceptedPlan;
  return {
    hasPlan: input.hasPlan,
    hasAcceptedPlan: input.hasAcceptedPlan,
    isRunnable: input.isRunnable,
    executionStatus: input.executionStatus,
    canStart: showStart,
    canPause: running,
    canStop: stoppable,
    showAcceptPlan: input.hasPlan && !input.hasAcceptedPlan,
    showGeneratePlan: !input.hasPlan,
    startDisabled: !input.isRunnable,
    startDisabledReason: input.startDisabledReason ?? null,
  };
}

/**
 * Project a `HeaderExecutionState` onto the JSON Pointer paths the
 * header `UiDocument` reads from the client state store. The
 * `state.snapshot` SSE event pushes these on connect; subsequent
 * `state.update` events carry the same shape after every state
 * transition. The keys are kept in sync with the `$state` references
 * emitted by `buildTaskHeaderSpec`.
 */
export function headerExecutionStateToStatePaths(state: HeaderExecutionState): Record<string, unknown> {
  return {
    "/execution/can-start": state.canStart,
    "/execution/can-pause": state.canPause,
    "/execution/can-stop": state.canStop,
    "/execution/show-accept-plan": state.showAcceptPlan,
    "/execution/show-generate-plan": state.showGeneratePlan,
    "/execution/start-disabled": state.startDisabled,
    "/execution/start-disabled-reason": state.startDisabledReason,
    "/execution/status": state.executionStatus,
    "/execution/has-plan": state.hasPlan,
    "/execution/has-accepted-plan": state.hasAcceptedPlan,
    "/execution/is-runnable": state.isRunnable,
  };
}

function headerActions(input: { executionStatus: string; hasPlan: boolean; hasAcceptedPlan: boolean; isRunnable: boolean }): TaskHeaderActionInput[] {
  if (!input.hasPlan) return [{ id: "generate-plan", label: "Generate plan" }];
  if (!input.hasAcceptedPlan) return [{ id: "accept-plan", label: "Accept plan" }];
  if (input.executionStatus === "completed" || input.executionStatus === "cancelled") return [];
  if (input.executionStatus === "running") return [
    { id: "pause", label: "Pause" },
    { id: "stop", label: "Stop" },
  ];
  if (["waiting_for_user", "waiting_for_approval"].includes(input.executionStatus)) return [{ id: "stop", label: "Stop" }];
  if (["blocked", "failed"].includes(input.executionStatus)) return [];
  return [{ id: "start", label: "Start", disabled: !input.isRunnable, disabledReason: input.isRunnable ? undefined : "Task is not runnable." }];
}
export type BuildHeaderSpecInput = {
  task: HeaderTaskView;
  recurrenceSeriesTasks: Array<Pick<HeaderTaskView, "id" | "title" | "status" | "workBlocks">>;
  currentExecution: Awaited<ReturnType<typeof getCurrentExecution>>;
  savedPlan: Awaited<ReturnType<typeof getLatestTaskPlanReadModel>>;
  workBlockId: string | null;
};

/**
 * Pure aggregation: task view + execution + plan → `TaskHeaderSpecInput` (ViewModel).
 * Accepts an optional `now` for deterministic testing; defaults to `new Date()`.
 * Called by `buildHeaderSpecFromTask` and directly in tests.
 */
export function resolveTaskHeaderViewModel(input: BuildHeaderSpecInput & { now?: Date }): TaskHeaderSpecInput {
  const { task, recurrenceSeriesTasks, currentExecution, savedPlan, workBlockId } = input;
  const now = input.now ?? new Date();
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
  // Scope the header status to the selected occurrence. The task row
  // (Task.status) is shared across the entire recurrence series, so its
  // "Blocked" / "Open" / "Completed" value does not change when the user
  // switches occurrences. The selected work block, in contrast, carries
  // the per-occurrence status that should drive the header badge —
  // matching the resolution used by `getTaskPage` for
  // `page.task.status` (see `currentWorkBlock?.status ?? task.status`).
  const scopedTaskStatus = currentWorkBlock?.status ?? task.status;
  const status = taskHeaderStatus({
    taskStatus: scopedTaskStatus,
    executionStatus: currentExecution.status,
    hasActiveExecution: isActiveExecutionStatus(currentExecution.status),
  });
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

  const hasPlan = Boolean(savedPlan);
  const hasAcceptedPlan = savedPlan?.status === "accepted";
  const workStateGuidance = workspaceStateGuidance({
    status,
    executionStatus: currentExecution.status,
    taskStatus: scopedTaskStatus,
    planStatus: savedPlan?.status ?? null,
    hasPlan,
    hasAcceptedPlan,
  });
  return {
    title: task.title,
    workspaceStateGuidance: workStateGuidance,
    status,
    statusLabel: taskStatusLabel({ status, executionStatus: currentExecution.status, taskStatus: scopedTaskStatus }),
    progressLabel: `${totalSteps} step${totalSteps === 1 ? "" : "s"} · ${completedSteps} accepted · ${progressPercent}%`,
    priorityLabel: task.priority,
    priorityTone: priorityTone(task.priority),
    occurrenceLabel: occurrenceWindow ? `Occurrence · ${occurrenceWindow}` : null,
    sourceLabel: source?.calendarSource.name ?? null,
    occurrenceValue: occurrenceValueCurrent,
    occurrenceOptions,
    actions,
  };
}

/** Pure transformer: raw inputs → header `UiDocument`. */
export function buildHeaderSpecFromTask(input: BuildHeaderSpecInput): ReturnType<typeof buildTaskHeaderSpec> {
  return buildTaskHeaderSpec(resolveTaskHeaderViewModel(input));
}

async function loadRecurrenceSeriesTasks(task: HeaderTaskView) {
  if (!task.seriesExternalUid) return [] as Array<Pick<HeaderTaskView, "id" | "title" | "status" | "workBlocks">>;
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
