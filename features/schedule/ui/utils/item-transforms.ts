import type { TaskConfigFormInput } from "../forms/task-config-form";
import { DEFAULT_SCHEDULE_BLOCK_MINUTES } from "../schedule-page-copy";
import type {
  ListItem,
  QuickCreateDraft,
  ScheduleRecord,
  ScheduledItem,
  TimelineCreateInput,
  UnscheduledItem,
} from "../schedule-page-types";
import {
  formatDateKey,
  parseDayKey,
  startOfDay,
} from "./date";

function deriveLocalRunnability(input: {
  executionRuntime?: string | null;
  executionConfig?: unknown;
  hasAcceptedPlan: boolean;
}) {
  if (!input.hasAcceptedPlan) {
    return {
      isRunnable: false,
      state: "missing_accepted_plan",
      summary: "Generate and accept a plan",
    };
  }

  return {
    isRunnable: true,
    state: "ready_to_run",
    summary: "Ready to run",
  };
}

function hasAcceptedSavedPlan(item: object): boolean {
  if (!("savedPlan" in item)) {
    return false;
  }

  const savedPlan = (item as { savedPlan?: { status?: string } | null }).savedPlan;
  return savedPlan?.status === "accepted";
}

function roundUpToQuarterHour(value: Date) {
  const next = new Date(value);
  next.setSeconds(0, 0);
  const minutes = next.getMinutes();
  const rounded = Math.ceil(minutes / 15) * 15;

  if (rounded === 60) {
    next.setHours(next.getHours() + 1, 0, 0, 0);
    return next;
  }

  next.setMinutes(rounded, 0, 0);
  return next;
}

export function moveScheduledItem(
  item: ScheduledItem,
  startAt: Date,
  endAt: Date,
): ScheduledItem {
  return {
    ...item,
    dueAt: item.dueAt,
    scheduledStartAt: startAt,
    scheduledEndAt: endAt,
    scheduleStatus: "Scheduled",
    scheduleSource: "human",
  };
}

export function createScheduledItemFromQueueItem(
  item: UnscheduledItem,
  startAt: Date,
  endAt: Date,
): ScheduledItem {
  return {
    taskId: item.taskId,
    workspaceId: item.workspaceId,
    title: item.title,
    priority: item.priority,
    persistedStatus: item.persistedStatus,
    displayState: item.displayState,
    actionRequired: item.isRunnable ? null : item.runnabilitySummary,
    approvalPendingCount: item.approvalPendingCount,
    scheduleStatus: "Scheduled",
    scheduleSource: "human",
    dueAt: item.dueAt,
    scheduledStartAt: startAt,
    scheduledEndAt: endAt,
    latestRunStatus: item.latestRunStatus,
    scheduleProposalCount: item.scheduleProposalCount,
    lastActivityAt: item.lastActivityAt,
    description: item.description,
    executionRuntime: item.executionRuntime,
    executionConfig: item.executionConfig,
    autoPlanGeneration: item.autoPlanGeneration,
    autoExecute: item.autoExecute,
    autoPlanGenerationTiming: item.autoPlanGenerationTiming,
    autoExecuteTiming: item.autoExecuteTiming,
    isRunnable: item.isRunnable,
    runnabilityState: item.runnabilityState,
    runnabilitySummary: item.runnabilitySummary,
    parentTaskId: item.parentTaskId ?? null,
  };
}

export function createScheduledItemFromCreateInput(
  taskId: string,
  workspaceId: string,
  input: TimelineCreateInput,
): ScheduledItem {
  return {
    taskId,
    workspaceId,
    title: input.title,
    description: input.description || null,
    priority: input.priority,
    persistedStatus: "Draft",
    displayState: null,
    actionRequired: "Generate and accept a plan",
    approvalPendingCount: 0,
    scheduleStatus: "Scheduled",
    scheduleSource: "human",
    dueAt: input.dueAt,
    scheduledStartAt: input.scheduledStartAt,
    scheduledEndAt: input.scheduledEndAt,
    latestRunStatus: null,
    scheduleProposalCount: 0,
    lastActivityAt: new Date(),
    executionRuntime: input.executionRuntime,
    executionConfig: input.executionConfig,
    autoPlanGeneration: input.autoExecute || input.autoPlanGenerationEnabled,
    autoExecute: input.autoExecute,
    autoPlanGenerationTiming: input.autoPlanGenerationTiming,
    autoExecuteTiming: input.autoExecuteTiming,
    isRunnable: false,
    runnabilityState: "missing_accepted_plan",
    runnabilitySummary: "Generate and accept a plan",
    parentTaskId: null,
  };
}

export function createListItemFromScheduledItem(item: ScheduledItem): ListItem {
  return {
    ...item,
    displayState: item.displayState,
    scheduleProposalCount: item.scheduleProposalCount,
    lastActivityAt: item.lastActivityAt,
  };
}

export function applyScheduleToListItem(
  item: ListItem,
  startAt: Date,
  endAt: Date,
): ListItem {
  return {
    ...item,
    dueAt: item.dueAt,
    scheduledStartAt: startAt,
    scheduledEndAt: endAt,
    scheduleStatus: "Scheduled",
    scheduleSource: "human",
    actionRequired: item.isRunnable ? null : item.runnabilitySummary,
  };
}

export function applyTaskConfigToItem<
  T extends ScheduledItem | UnscheduledItem | ListItem | ScheduleRecord,
>(item: T, input: TaskConfigFormInput): T {
  const hasAcceptedPlan = hasAcceptedSavedPlan(item);
  const runnability = deriveLocalRunnability({
    executionRuntime: input.executionRuntime,
    executionConfig: input.executionConfig,
    hasAcceptedPlan,
  });

  return {
    ...item,
    title: input.title,
    description: input.description || null,
    priority: input.priority,
    dueAt: input.dueAt,
    scheduledStartAt: input.scheduledStartAt,
    scheduledEndAt: input.scheduledEndAt,
    executionRuntime: input.executionRuntime,
    executionConfig: input.executionConfig,
    aiClientId: input.aiClientId,
    autoPlanGeneration: input.autoPlanGeneration,
    autoExecute: input.autoExecute,
    isRunnable: runnability.isRunnable,
    runnabilityState: runnability.state,
    runnabilitySummary: runnability.summary,
    persistedStatus:
      item.persistedStatus === "Draft" || item.persistedStatus === "Ready"
        ? runnability.isRunnable
          ? "Ready"
          : "Draft"
        : item.persistedStatus,
    actionRequired: runnability.isRunnable ? null : runnability.summary,
  };
}

export function toTaskConfigInitialValues(item: {
  title: string;
  description?: string | null;
  priority: string;
  executionRuntime?: string | null;
  executionConfig?: unknown;
  aiClientId?: string | null;
  dueAt?: Date | null;
  scheduledStartAt?: Date | null;
  scheduledEndAt?: Date | null;
  autoExecute?: boolean;
  autoPlanGeneration?: boolean;
}) {
  return {
    title: item.title,
    description: item.description ?? null,
    priority: item.priority as TaskConfigFormInput["priority"],
    scheduledStartAt: item.scheduledStartAt ?? null,
    scheduledEndAt: item.scheduledEndAt ?? null,
    executionRuntime: item.executionRuntime ?? null,
    executionConfig: item.executionConfig,
    aiClientId: item.aiClientId ?? null,
    dueAt: item.dueAt ?? null,
    autoPlanGeneration: item.autoPlanGeneration ?? false,
    autoExecute: item.autoExecute ?? false,
  };
}

export function buildQuickCreateDraft(args: {
  title: string;
  selectedDay: string;
  now?: Date;
  priority?: QuickCreateDraft["priority"];
  durationMinutes?: number;
}): QuickCreateDraft {
  const now = args.now ?? new Date();
  const selectedDate = parseDayKey(args.selectedDay) ?? startOfDay(now);
  const sameDay = formatDateKey(selectedDate) === formatDateKey(now);
  const scheduledStartAt = sameDay
    ? roundUpToQuarterHour(now)
    : new Date(
        selectedDate.getFullYear(),
        selectedDate.getMonth(),
        selectedDate.getDate(),
        9,
        0,
        0,
        0,
      );
  const scheduledEndAt = new Date(scheduledStartAt.getTime());
  scheduledEndAt.setMinutes(
    scheduledEndAt.getMinutes() +
      (args.durationMinutes ?? DEFAULT_SCHEDULE_BLOCK_MINUTES),
  );

  return {
    title: args.title.trim(),
    dueAt: null,
    scheduledStartAt,
    scheduledEndAt,
    priority: args.priority ?? "Medium",
  };
}
