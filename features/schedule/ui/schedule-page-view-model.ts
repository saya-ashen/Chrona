import {
  addDays,
  buildTodayFocusItems,
  buildWeekGroups,
  formatDateKey,
  formatDayHeading,
  formatDurationMinutes,
  formatWeekdayShort,
  getTodayKey,
  parseDayKey,
  startOfDay,
  startOfWeek,
} from "./schedule-page-utils";
import type { SchedulePageCopy } from "./schedule-page-copy";
import type {
  SchedulePageData,
  ScheduleRecord,
  ScheduleViewMode,
  SecondaryPlanningView,
} from "./schedule-page-types";

type ScheduleCalendarDay = {
  key: string;
  label: string;
  shortLabel: string;
  dateNumber: string;
  isCurrentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  scheduledCount: number;
  riskCount: number;
};
export type ScheduleDisplayState = {
  day: {
    phase: "empty" | "scheduled";
    scheduledCount: number;
    scheduledMinutes: number;
    riskCount: number;
  };
  primaryAction: "schedule_task" | "create_task" | "review_attention";
  primarySurface: "timeline" | "agenda";
  planningDrawer: {
    readyCount: number;
    attentionCount: number;
    defaultTab: "queue" | "attention";
  };
};

function getScheduledMinutes(
  items: NonNullable<SchedulePageViewModel["activeGroup"]>["items"],
) {
  return items.reduce((total, item) => {
    if (!item.scheduledStartAt || !item.scheduledEndAt) return total;
    return total + Math.max(
      0,
      Math.round(
        (item.scheduledEndAt.getTime() - item.scheduledStartAt.getTime()) /
          60_000,
      ),
    );
  }, 0);
}

export function deriveScheduleDisplayState(input: {
  activeGroup: SchedulePageViewModel["activeGroup"];
  activeView: ScheduleViewMode;
  readyCount: number;
  attentionCount: number;
}): ScheduleDisplayState {
  const scheduledCount = input.activeGroup?.items.length ?? 0;
  const riskCount = input.activeGroup?.riskCount ?? input.attentionCount;

  return {
    day: {
      phase: scheduledCount > 0 ? "scheduled" : "empty",
      scheduledCount,
      scheduledMinutes: getScheduledMinutes(input.activeGroup?.items ?? []),
      riskCount,
    },
    primaryAction:
      riskCount > 0
        ? "review_attention"
        : input.readyCount > 0
          ? "schedule_task"
          : "create_task",
    primarySurface: input.activeView === "list" ? "agenda" : "timeline",
    planningDrawer: {
      readyCount: input.readyCount,
      attentionCount: input.attentionCount,
      defaultTab: input.attentionCount > 0 ? "attention" : "queue",
    },
  };
}

export type SchedulePageViewModel = {
  scheduledGroups: ReturnType<typeof buildWeekGroups>;
  todayKey: string;
  tomorrowKey: string;
  activeDay: string;
  activeDayDate: Date;
  activeGroup: ReturnType<typeof buildWeekGroups>[number] | null;
  activeSelectedTaskId: string | undefined;
  selectedItem: ScheduleRecord | null;
  todayFocusItems: ReturnType<typeof buildTodayFocusItems>;
  calendarMonthLabel: string;
  calendarDays: ScheduleCalendarDay[];
  cockpitSummary: string;
  activeRailLabel: string;
  conflictTaskIds: Set<string>;
  display: ScheduleDisplayState;
};

export function buildSchedulePageViewModel({
  viewData,
  selectedDay,
  selectedTaskId,
  localSelectedTaskId,
  activeView,
  secondaryView,
  locale,
  copy,
}: {
  viewData: SchedulePageData;
  selectedDay?: string;
  selectedTaskId?: string;
  localSelectedTaskId?: string;
  activeView: ScheduleViewMode;
  secondaryView: SecondaryPlanningView;
  locale: string;
  copy: SchedulePageCopy;
}): SchedulePageViewModel {
  const scheduledGroups = buildWeekGroups(
    viewData.scheduled,
    viewData.proposals,
    viewData.risks,
    selectedDay,
    locale,
    copy,
  );

  const todayKey = getTodayKey();
  const tomorrowKey = formatDateKey(
    addDays(parseDayKey(todayKey) ?? startOfDay(new Date()), 1),
  );
  const selectedDayDate = parseDayKey(selectedDay);
  const selectedGroupKey = selectedDayDate ? formatDateKey(selectedDayDate) : undefined;
  const todayGroupKey = scheduledGroups.find(
    (group) => group.key === todayKey,
  )?.key;
  const activeDay =
    selectedGroupKey ??
    todayGroupKey ??
    todayKey;
  const activeGroup =
    scheduledGroups.find((group) => group.key === activeDay) ?? null;
  const activeSelectedTaskId = localSelectedTaskId ?? selectedTaskId;
  const selectedItem =
    activeGroup?.items.find((item) => (item.workBlockId ?? item.taskId) === activeSelectedTaskId || item.taskId === activeSelectedTaskId) ??
    viewData.unscheduled.find((item) => item.taskId === activeSelectedTaskId) ??
    null;
  const todayFocusItems = buildTodayFocusItems(viewData, activeGroup, copy);
  const conflictTaskIds = new Set<string>();

  const activeRailLabel =
    secondaryView === "risks"
      ? copy.conflictsTitle
      : secondaryView === "proposals"
        ? copy.aiProposalsTitle
        : copy.unscheduledQueue;

  const activeDayDate = selectedDayDate ?? parseDayKey(activeDay) ?? startOfDay(new Date());
  const calendarMonthDate = startOfDay(
    new Date(activeDayDate.getFullYear(), activeDayDate.getMonth(), 1),
  );
  const calendarGridStart = startOfWeek(calendarMonthDate);
  const calendarDays = Array.from({ length: 35 }, (_, index) => {
    const date = addDays(calendarGridStart, index);
    const dayKey = formatDateKey(date);
    const dayGroup = scheduledGroups.find((group) => group.key === dayKey);

    return {
      key: dayKey,
      label: formatDayHeading(date, locale, copy),
      shortLabel: formatWeekdayShort(date, locale),
      dateNumber: String(date.getDate()),
      isCurrentMonth: date.getMonth() === activeDayDate.getMonth(),
      isToday: dayKey === todayKey,
      isSelected: dayKey === activeDay,
      scheduledCount: dayGroup?.items.length ?? 0,
      riskCount: dayGroup?.riskCount ?? 0,
    };
  });

  const calendarMonthLabel = new Intl.DateTimeFormat(
    locale === "zh" ? "zh-CN" : "en",
    {
      month: "long",
      year: "numeric",
    },
  ).format(activeDayDate);

  const cockpitSummary = copy.cockpitSummaryTemplate
    .replace(
      "{scheduled}",
      formatDurationMinutes(viewData.planningSummary.todayLoadMinutes),
    )
    .replace("{queue}", String(viewData.planningSummary.readyToScheduleCount))
    .replace("{risks}", String(viewData.planningSummary.riskCount))
    .replace("{automation}", String(viewData.automationCandidates.length));

  void activeView;

  const display = deriveScheduleDisplayState({
    activeGroup,
    activeView,
    readyCount: viewData.planningSummary.readyToScheduleCount,
    attentionCount: viewData.summary.riskCount,
  });

  return {
    scheduledGroups,
    todayKey,
    tomorrowKey,
    activeDay,
    activeDayDate,
    activeGroup,
    activeSelectedTaskId,
    selectedItem,
    todayFocusItems,
    calendarMonthLabel,
    calendarDays,
    cockpitSummary,
    activeRailLabel,
    conflictTaskIds,
    display,
  };
}
