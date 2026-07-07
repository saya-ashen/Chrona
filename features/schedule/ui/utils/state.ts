import type { SchedulePageCopy } from "../schedule-page-copy";
import type {
  ScheduleCardItem,
  SchedulePageData,
  ScheduleViewMode,
  ScheduledDayGroup,
  ScheduledItem,
  TodayFocusItem,
} from "../schedule-page-types";
import {
  addDays,
  buildPlanningSummary,
  formatDateKey,
  getDayKey,
  parseDayKey,
  startOfDay,
  startOfWeek,
  toTimestamp,
} from "@chrona/domain";
import { formatDayHeading } from "./format";
import type { SchedulePageProps } from "../schedule-page-types";

export { buildPlanningSummary };

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

    if (item.stateView?.state === "waiting_for_input") {
      push(item, copy.focusWaitingForInput, "warning");
      continue;
    }

    if (item.stateView?.state === "waiting_for_approval") {
      push(item, copy.focusWaitingForApproval, "warning");
      continue;
    }

    push(item, copy.focusAtRisk, "warning");
  }

  for (const item of activeGroup?.items ?? []) {
    const isHighPriority = item.priority === "High" || item.priority === "Urgent";
    const hasStarted = item.stateView
      ? !["ready", "scheduled", "unscheduled"].includes(item.stateView.state)
      : Boolean(item.latestRunStatus && item.latestRunStatus !== "Pending");

    if (!hasStarted && isHighPriority) {
      push(item, copy.focusReadyToday, "info");
    }
  }

  return Array.from(focus.values()).slice(0, 5);
}

export function buildScheduleHref(day: string, taskId?: string, workBlockId?: string) {
  const params = new URLSearchParams();
  params.set("day", day);

  const selectedId = workBlockId ?? taskId;
  if (selectedId) {
    params.set("task", selectedId);
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

