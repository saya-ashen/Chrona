import { addDays, getDayKey, getTodayKey, startOfDay, toTimestamp } from "./date";

const DEFAULT_SCHEDULE_BLOCK_MINUTES = 60;
const TIMELINE_SLOT_MINUTES = 30;

type ScheduledSummaryItem = {
  scheduledStartAt?: Date | string | null;
  scheduledEndAt?: Date | string | null;
  scheduleStatus?: string | null;
};

type UnscheduledSummaryItem = ScheduledSummaryItem & {
  dueAt?: Date | string | null;
  isRunnable?: boolean;
  persistedStatus?: string | null;
  latestRunStatus?: string | null;
};

type RiskSummaryItem = ScheduledSummaryItem & {
  actionRequired?: string | null;
  latestRunStatus?: string | null;
  displayState?: string | null;
};

export type SchedulePlanningSummary = {
  scheduledMinutes: number;
  runnableQueueCount: number;
  conflictCount: number;
  overloadedDayCount: number;
  proposalCount: number;
  riskCount: number;
  todayLoadMinutes: number;
  overdueCount: number;
  atRiskCount: number;
  readyToScheduleCount: number;
  autoRunnableCount: number;
  waitingOnUserCount: number;
  dueSoonUnscheduledCount: number;
  largestIdleWindowMinutes: number;
  overloadedMinutes: number;
};

function getScheduledMinutesForItem(item: ScheduledSummaryItem) {
  if (!item.scheduledStartAt || !item.scheduledEndAt) {
    return DEFAULT_SCHEDULE_BLOCK_MINUTES;
  }

  return Math.max(
    Math.round(((toTimestamp(item.scheduledEndAt) ?? 0) - (toTimestamp(item.scheduledStartAt) ?? 0)) / 60000),
    TIMELINE_SLOT_MINUTES,
  );
}

function countOverloadedDays(items: ScheduledSummaryItem[]) {
  const minutesByDay = new Map<string, number>();

  for (const item of items) {
    const key = getDayKey(item.scheduledStartAt);
    minutesByDay.set(
      key,
      (minutesByDay.get(key) ?? 0) + getScheduledMinutesForItem(item),
    );
  }

  return Array.from(minutesByDay.values()).filter((minutes) => minutes > 8 * 60)
    .length;
}

function countOverloadedMinutes(items: ScheduledSummaryItem[]) {
  const minutesByDay = new Map<string, number>();

  for (const item of items) {
    const key = getDayKey(item.scheduledStartAt);
    minutesByDay.set(
      key,
      (minutesByDay.get(key) ?? 0) + getScheduledMinutesForItem(item),
    );
  }

  return Array.from(minutesByDay.values()).reduce(
    (total, minutes) => total + Math.max(0, minutes - 8 * 60),
    0,
  );
}

function getLargestIdleWindowMinutes(items: ScheduledSummaryItem[]) {
  const byDay = new Map<string, ScheduledSummaryItem[]>();

  for (const item of items) {
    const dayKey = getDayKey(item.scheduledStartAt);
    const group = byDay.get(dayKey) ?? [];
    group.push(item);
    byDay.set(dayKey, group);
  }

  let largestGap = 0;

  for (const dayItems of byDay.values()) {
    const sorted = [...dayItems].sort((left, right) => {
      const leftStart = toTimestamp(left.scheduledStartAt) ?? Number.MAX_SAFE_INTEGER;
      const rightStart = toTimestamp(right.scheduledStartAt) ?? Number.MAX_SAFE_INTEGER;
      return leftStart - rightStart;
    });

    for (let index = 1; index < sorted.length; index += 1) {
      const previousEnd = toTimestamp(sorted[index - 1].scheduledEndAt) ?? 0;
      const currentStart = toTimestamp(sorted[index].scheduledStartAt) ?? previousEnd;
      largestGap = Math.max(largestGap, Math.round((currentStart - previousEnd) / 60000));
    }
  }

  return largestGap;
}

function countDueSoonUnscheduledItems(items: UnscheduledSummaryItem[]) {
  const today = startOfDay(new Date());
  const tomorrow = addDays(today, 1).getTime();

  return items.filter((item) => {
    const dueAt = toTimestamp(item.dueAt);
    if (dueAt === null) return false;
    return dueAt >= today.getTime() && dueAt < tomorrow;
  }).length;
}

function isReadyToScheduleQueueItem(item: UnscheduledSummaryItem) {
  return (
    item.scheduleStatus === "Unscheduled" &&
    item.persistedStatus !== "Running" &&
    item.latestRunStatus !== "Running" &&
    item.latestRunStatus !== "Pending"
  );
}

export function buildPlanningSummary(input: {
  scheduled: ScheduledSummaryItem[];
  unscheduled: UnscheduledSummaryItem[];
  proposals: unknown[];
  risks: RiskSummaryItem[];
}): SchedulePlanningSummary {
  const todayKey = getTodayKey();

  return {
    scheduledMinutes: input.scheduled.reduce(
      (total, item) => total + getScheduledMinutesForItem(item),
      0,
    ),
    runnableQueueCount: input.unscheduled.filter((item) => item.isRunnable).length,
    conflictCount: 0,
    overloadedDayCount: countOverloadedDays(input.scheduled),
    proposalCount: input.proposals.length,
    riskCount: input.risks.length,
    todayLoadMinutes: input.scheduled.reduce((total, item) => {
      const key = getDayKey(item.scheduledStartAt);
      return key === todayKey ? total + getScheduledMinutesForItem(item) : total;
    }, 0),
    overdueCount: input.scheduled.filter((item) => item.scheduleStatus === "Overdue").length,
    atRiskCount: input.scheduled.filter((item) => item.scheduleStatus === "AtRisk").length,
    readyToScheduleCount: input.unscheduled.filter(isReadyToScheduleQueueItem).length,
    autoRunnableCount: input.unscheduled.filter((item) => item.isRunnable).length,
    waitingOnUserCount: input.risks.filter(
      (item) =>
        item.actionRequired === "Schedule task" ||
        item.actionRequired === "Reschedule task" ||
        item.latestRunStatus === "WaitingForInput" ||
        item.displayState === "WaitingForInput" ||
        item.latestRunStatus === "WaitingForApproval" ||
        item.displayState === "WaitingForApproval",
    ).length,
    dueSoonUnscheduledCount: countDueSoonUnscheduledItems(input.unscheduled),
    largestIdleWindowMinutes: getLargestIdleWindowMinutes(input.scheduled),
    overloadedMinutes: countOverloadedMinutes(input.scheduled),
  };
}
