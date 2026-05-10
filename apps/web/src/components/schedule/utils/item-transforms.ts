import type { TaskConfigFormInput } from "@/components/schedule/task-config-form";
import { DEFAULT_SCHEDULE_BLOCK_MINUTES } from "@/components/schedule/schedule-page-copy";
import type {
  ListItem,
  QuickCreateDraft,
  ScheduleRecord,
  ScheduledItem,
  TimelineCreateInput,
  UnscheduledItem,
} from "@/components/schedule/schedule-page-types";
import {
  formatDateKey,
  parseDayKey,
  startOfDay,
} from "@/components/schedule/utils/date";

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
    persistedStatus: "Ready",
    displayState: null,
    actionRequired: null,
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
    isRunnable: false,
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
  const runnability = deriveTaskRunnability({
    executionRuntime: input.executionRuntime,
    executionConfig: input.executionConfig,
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
    isRunnable: runnability.isRunnable,
    runnabilityState: runnability.state,
    runnabilitySummary: runnability.summary,
    persistedStatus:
      item.persistedStatus === "Draft" || item.persistedStatus === "Ready"
        ? runnability.isRunnable
          ? "Ready"
          : "Draft"
        : item.persistedStatus,
    actionRequired: runnability.isRunnable
      ? item.actionRequired
      : runnability.summary,
  };
}

export function toTaskConfigInitialValues(item: {
  title: string;
  description?: string | null;
  priority: string;
  executionRuntime?: string | null;
  executionConfig?: unknown;
  dueAt?: Date | null;
  scheduledStartAt?: Date | null;
  scheduledEndAt?: Date | null;
}) {
  return {
    title: item.title,
    description: item.description ?? null,
    priority: item.priority as TaskConfigFormInput["priority"],
    scheduledStartAt: item.scheduledStartAt ?? null,
    scheduledEndAt: item.scheduledEndAt ?? null,
    executionRuntime: item.executionRuntime ?? null,
    executionConfig: item.executionConfig,
    dueAt: item.dueAt ?? null,
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
