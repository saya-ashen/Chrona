import type { SchedulePageCopy } from "@/components/schedule/schedule-page-copy";
import {
  DEFAULT_SCHEDULE_BLOCK_MINUTES,
  TIMELINE_SLOT_MINUTES,
} from "@/components/schedule/schedule-page-copy";
import type {
  ScheduleCardItem,
  SchedulePageData,
  SchedulePlanningSummary,
  ScheduleViewMode,
  ScheduledDayGroup,
  ScheduledItem,
  TodayFocusItem,
  UnscheduledItem,
} from "@/components/schedule/schedule-page-types";
import {
  addDays,
  formatDateKey,
  getDayKey,
  getTodayKey,
  parseDayKey,
  startOfDay,
  startOfWeek,
  toTimestamp,
} from "@/components/schedule/utils/date";
import { formatDayHeading } from "@/components/schedule/utils/format";
import type { SchedulePageProps } from "@/components/schedule/schedule-page-types";

export function buildWeekGroups(
  items: SchedulePageProps["data"]["scheduled"],
  proposals: SchedulePageProps["data"]["proposals"],
  risks: SchedulePageProps["data"]["risks"],
  referenceDay: string | undefined,
  locale: string,
  copy: SchedulePageCopy,
) {
  const anchorDate = parseDayKey(referenceDay) ?? startOfDay(new Date());
  const weekStart = startOfWeek(anchorDate);
  const groups: ScheduledDayGroup[] = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(weekStart, index);

    return {
      key: formatDateKey(date),
      date,
      label: formatDayHeading(date, locale, copy),
      items: [],
      proposalCount: 0,
      riskCount: 0,
    };
  });

  const groupMap = new Map(groups.map((group) => [group.key, group]));

  for (const proposal of proposals) {
    const group = groupMap.get(getDayKey(proposal.scheduledStartAt));
    if (group) {
      group.proposalCount += 1;
    }
  }

  for (const risk of risks) {
    const group = groupMap.get(getDayKey(risk.scheduledStartAt));
    if (group) {
      group.riskCount += 1;
    }
  }

  for (const item of items) {
    const group = groupMap.get(getDayKey(item.scheduledStartAt));
    if (group) {
      group.items.push(item);
    }
  }

  return groups.map((group) => ({
    ...group,
    items: [...group.items].sort((a, b) => {
      const aTime = toTimestamp(a.scheduledStartAt) ?? Number.MAX_SAFE_INTEGER;
      const bTime = toTimestamp(b.scheduledStartAt) ?? Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    }),
  }));
}

export function sortScheduledItems(items: ScheduledItem[]) {
  return [...items].sort((a, b) => {
    const aTime = toTimestamp(a.scheduledStartAt) ?? Number.MAX_SAFE_INTEGER;
    const bTime = toTimestamp(b.scheduledStartAt) ?? Number.MAX_SAFE_INTEGER;
    return aTime - bTime;
  });
}

export function buildTodayFocusItems(
  data: SchedulePageData,
  activeGroup: ScheduledDayGroup | null,
  copy: Pick<
    SchedulePageCopy,
    | "focusOverdue"
    | "focusWaitingForInput"
    | "focusWaitingForApproval"
    | "focusAtRisk"
    | "focusReadyToday"
  >,
): TodayFocusItem[] {
  const focus = new Map<string, TodayFocusItem>();

  function push(
    item: ScheduleCardItem,
    reason: string,
    tone: TodayFocusItem["tone"],
  ) {
    if (focus.has(item.taskId)) {
      return;
    }

    focus.set(item.taskId, {
      taskId: item.taskId,
      workspaceId: item.workspaceId,
      title: item.title,
      reason,
      tone,
    });
  }

  for (const item of data.risks) {
    if (item.scheduleStatus === "Overdue") {
      push(item, copy.focusOverdue, "critical");
      continue;
    }

    if (
      item.latestRunStatus === "WaitingForInput" ||
      item.displayState === "WaitingForInput"
    ) {
      push(item, copy.focusWaitingForInput, "warning");
      continue;
    }

    if (
      item.latestRunStatus === "WaitingForApproval" ||
      item.displayState === "WaitingForApproval"
    ) {
      push(item, copy.focusWaitingForApproval, "warning");
      continue;
    }

    push(item, copy.focusAtRisk, "warning");
  }

  for (const item of activeGroup?.items ?? []) {
    const isHighPriority = item.priority === "High" || item.priority === "Urgent";
    const hasStarted = Boolean(
      item.latestRunStatus && item.latestRunStatus !== "Pending",
    );

    if (!hasStarted && isHighPriority) {
      push(item, copy.focusReadyToday, "info");
    }
  }

  return Array.from(focus.values()).slice(0, 5);
}

export function buildScheduleHref(day: string, taskId?: string) {
  const params = new URLSearchParams();
  params.set("day", day);

  if (taskId) {
    params.set("task", taskId);
  }

  return `/schedule?${params.toString()}`;
}

export function buildScheduleViewHref(
  day: string,
  view: ScheduleViewMode,
  taskId?: string,
) {
  const params = new URLSearchParams();
  params.set("day", day);

  if (taskId) {
    params.set("task", taskId);
  }

  if (view === "list") {
    params.set("view", view);
  }

  return `/schedule?${params.toString()}`;
}

export function normalizeScheduleView(view: string | undefined): ScheduleViewMode {
  return view === "list" ? "list" : "timeline";
}

function getScheduledMinutesForItem(item: {
  scheduledStartAt?: Date | null;
  scheduledEndAt?: Date | null;
}) {
  if (!item.scheduledStartAt || !item.scheduledEndAt) {
    return DEFAULT_SCHEDULE_BLOCK_MINUTES;
  }

  return Math.max(
    Math.round(((toTimestamp(item.scheduledEndAt) ?? 0) - (toTimestamp(item.scheduledStartAt) ?? 0)) / 60000),
    TIMELINE_SLOT_MINUTES,
  );
}

function countScheduleConflicts(items: ScheduledItem[]) {
  const byDay = new Map<string, ScheduledItem[]>();

  for (const item of items) {
    const dayKey = getDayKey(item.scheduledStartAt);
    const group = byDay.get(dayKey) ?? [];
    group.push(item);
    byDay.set(dayKey, group);
  }

  let conflicts = 0;

  for (const dayItems of byDay.values()) {
    const sorted = [...dayItems].sort((left, right) => {
      const leftStart = toTimestamp(left.scheduledStartAt) ?? Number.MAX_SAFE_INTEGER;
      const rightStart = toTimestamp(right.scheduledStartAt) ?? Number.MAX_SAFE_INTEGER;
      return leftStart - rightStart;
    });

    for (let index = 1; index < sorted.length; index += 1) {
      const previousEnd = toTimestamp(sorted[index - 1].scheduledEndAt) ?? 0;
      const currentStart = toTimestamp(sorted[index].scheduledStartAt) ?? Number.MAX_SAFE_INTEGER;

      if (currentStart < previousEnd) {
        conflicts += 1;
      }
    }
  }

  return conflicts;
}

function countOverloadedDays(items: ScheduledItem[]) {
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

function countOverloadedMinutes(items: ScheduledItem[]) {
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

function getLargestIdleWindowMinutes(items: ScheduledItem[]) {
  const byDay = new Map<string, ScheduledItem[]>();

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

function countDueSoonUnscheduledItems(items: UnscheduledItem[]) {
  const today = startOfDay(new Date());
  const tomorrow = addDays(today, 1).getTime();

  return items.filter((item) => {
    if (!item.dueAt) {
      return false;
    }

    const dueAt = toTimestamp(item.dueAt);
    if (dueAt === null) return false;
    return dueAt >= today.getTime() && dueAt < tomorrow;
  }).length;
}

export function buildPlanningSummary(input: {
  scheduled: ScheduledItem[];
  unscheduled: UnscheduledItem[];
  proposals: SchedulePageData["proposals"];
  risks: SchedulePageData["risks"];
}): SchedulePlanningSummary {
  const todayKey = getTodayKey();

  return {
    scheduledMinutes: input.scheduled.reduce(
      (total, item) => total + getScheduledMinutesForItem(item),
      0,
    ),
    runnableQueueCount: input.unscheduled.filter((item) => item.isRunnable).length,
    conflictCount: countScheduleConflicts(input.scheduled),
    overloadedDayCount: countOverloadedDays(input.scheduled),
    proposalCount: input.proposals.length,
    riskCount: input.risks.length,
    todayLoadMinutes: input.scheduled.reduce((total, item) => {
      const key = getDayKey(item.scheduledStartAt);
      return key === todayKey ? total + getScheduledMinutesForItem(item) : total;
    }, 0),
    overdueCount: input.scheduled.filter((item) => item.scheduleStatus === "Overdue").length,
    atRiskCount: input.scheduled.filter((item) => item.scheduleStatus === "AtRisk").length,
    readyToScheduleCount: input.unscheduled.filter(
      (item) => item.scheduleStatus === "Unscheduled",
    ).length,
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
