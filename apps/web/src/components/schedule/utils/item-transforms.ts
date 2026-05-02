import type { TaskConfigFormInput } from "@/components/schedule/task-config-form";
import {
  DEFAULT_SCHEDULE_BLOCK_MINUTES,
} from "@/components/schedule/schedule-page-copy";
import type {
  ListItem,
  QuickCreateDraft,
  ScheduleRecord,
  ScheduledItem,
  TimelineCreateInput,
  UnscheduledItem,
} from "@/components/schedule/schedule-page-types";
import { deriveTaskRunnability } from "@chrona/runtime/modules/tasks/derive-task-runnability";
import { formatDateKey, parseDayKey, startOfDay } from "@/components/schedule/utils/date";

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
    ownerType: item.ownerType,
    assigneeAgentId: item.assigneeAgentId,
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
    runtimeAdapterKey: item.runtimeAdapterKey,
    runtimeInput: item.runtimeInput,
    runtimeInputVersion: item.runtimeInputVersion,
    runtimeModel: item.runtimeModel,
    prompt: item.prompt,
    runtimeConfig: item.runtimeConfig,
    isRunnable: item.isRunnable,
    runnabilityState: item.runnabilityState,
    runnabilitySummary: item.runnabilitySummary,
    parentTaskId: item.parentTaskId ?? null,
  };
}

export function createScheduledItemFromCreateInput(
  taskId: string,
  workspaceId: string,
  workspaceDefaultRuntime: string,
  input: TimelineCreateInput,
): ScheduledItem {
  const runnability = deriveTaskRunnability({
    workspaceDefaultRuntime,
    runtimeAdapterKey: input.runtimeAdapterKey,
    runtimeInput: input.runtimeInput,
    runtimeModel: input.runtimeModel,
    prompt: input.prompt,
    runtimeConfig: input.runtimeConfig,
  });

  return {
    taskId,
    workspaceId,
    title: input.title,
    description: input.description || null,
    priority: input.priority,
    ownerType: "human",
    assigneeAgentId: null,
    persistedStatus: runnability.isRunnable ? "Ready" : "Draft",
    displayState: null,
    actionRequired: runnability.isRunnable ? null : runnability.summary,
    approvalPendingCount: 0,
    scheduleStatus: "Scheduled",
    scheduleSource: "human",
    dueAt: input.dueAt,
    scheduledStartAt: input.scheduledStartAt,
    scheduledEndAt: input.scheduledEndAt,
    latestRunStatus: null,
    scheduleProposalCount: 0,
    lastActivityAt: new Date(),
    runtimeAdapterKey: input.runtimeAdapterKey,
    runtimeInput: input.runtimeInput,
    runtimeInputVersion: input.runtimeInputVersion,
    runtimeModel: input.runtimeModel,
    prompt: input.prompt,
    runtimeConfig: input.runtimeConfig,
    isRunnable: runnability.isRunnable,
    runnabilityState: runnability.state,
    runnabilitySummary: runnability.summary,
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
  const runtimeConfig = input.runtimeConfig ?? null;
  const runnability = deriveTaskRunnability({
    runtimeAdapterKey: input.runtimeAdapterKey,
    runtimeInput: input.runtimeInput,
    runtimeModel: input.runtimeModel,
    prompt: input.prompt,
    runtimeConfig,
  });

  return {
    ...item,
    title: input.title,
    description: input.description || null,
    priority: input.priority,
    dueAt: input.dueAt,
    runtimeAdapterKey: input.runtimeAdapterKey,
    runtimeInput: input.runtimeInput,
    runtimeInputVersion: input.runtimeInputVersion,
    runtimeModel: input.runtimeModel,
    prompt: input.prompt,
    runtimeConfig,
    isRunnable: runnability.isRunnable,
    runnabilityState: runnability.state,
    runnabilitySummary: runnability.summary,
    persistedStatus:
      item.persistedStatus === "Draft" || item.persistedStatus === "Ready"
        ? runnability.isRunnable
          ? "Ready"
          : "Draft"
        : item.persistedStatus,
    actionRequired: runnability.isRunnable ? item.actionRequired : runnability.summary,
  };
}

export function toTaskConfigInitialValues(item: {
  title: string;
  description?: string | null;
  priority: string;
  runtimeAdapterKey?: string | null;
  runtimeInput?: unknown;
  runtimeInputVersion?: string | null;
  runtimeModel?: string | null;
  prompt?: string | null;
  dueAt?: Date | null;
  runtimeConfig?: unknown;
}) {
  return {
    title: item.title,
    description: item.description ?? null,
    priority: item.priority as TaskConfigFormInput["priority"],
    runtimeAdapterKey: item.runtimeAdapterKey ?? null,
    runtimeInput: item.runtimeInput,
    runtimeInputVersion: item.runtimeInputVersion ?? null,
    runtimeModel: item.runtimeModel ?? null,
    prompt: item.prompt ?? null,
    dueAt: item.dueAt ?? null,
    runtimeConfig: item.runtimeConfig,
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
    scheduledEndAt.getMinutes() + (args.durationMinutes ?? DEFAULT_SCHEDULE_BLOCK_MINUTES),
  );

  return {
    title: args.title.trim(),
    dueAt: null,
    scheduledStartAt,
    scheduledEndAt,
    priority: args.priority ?? "Medium",
  };
}


