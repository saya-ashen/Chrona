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
} from "@/components/schedule/schedule-page-utils";
import type {
  SchedulePageCopy,
} from "@/components/schedule/schedule-page-copy";
import type {
  SchedulePageData,
  ScheduleViewMode,
  SecondaryPlanningView,
} from "@/components/schedule/schedule-page-types";

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

export type SchedulePageViewModel = {
  scheduledGroups: ReturnType<typeof buildWeekGroups>;
  todayKey: string;
  tomorrowKey: string;
  activeDay: string;
  activeDayDate: Date;
  activeGroup: ReturnType<typeof buildWeekGroups>[number] | null;
  activeSelectedTaskId: string | undefined;
  selectedItem: SchedulePageData["scheduled"][number] | null;
  todayFocusItems: ReturnType<typeof buildTodayFocusItems>;
  calendarMonthLabel: string;
  calendarDays: ScheduleCalendarDay[];
  conflictTaskIds: Set<string>;
  cockpitSummary: string;
  activeRailLabel: string;
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
  const selectedGroupKey = scheduledGroups.find(
    (group) => group.key === selectedDay,
  )?.key;
  const todayGroupKey = scheduledGroups.find(
    (group) => group.key === todayKey,
  )?.key;
  const todayGroup =
    scheduledGroups.find((group) => group.key === todayGroupKey) ?? null;
  const firstPopulatedGroup =
    scheduledGroups.find(
      (group) =>
        group.items.length > 0 ||
        group.proposalCount > 0 ||
        group.riskCount > 0,
    )?.key ?? null;
  const activeDay =
    selectedGroupKey ??
    (todayGroup &&
    (todayGroup.items.length > 0 ||
      todayGroup.proposalCount > 0 ||
      todayGroup.riskCount > 0)
      ? todayGroup.key
      : null) ??
    firstPopulatedGroup ??
    todayKey ??
    scheduledGroups[0]?.key;
  const activeGroup =
    scheduledGroups.find((group) => group.key === activeDay) ?? null;
  const activeSelectedTaskId = localSelectedTaskId ?? selectedTaskId;
  const selectedItem =
    activeGroup?.items.find((item) => item.taskId === activeSelectedTaskId) ??
    null;
  const todayFocusItems = buildTodayFocusItems(viewData, activeGroup, copy);

  const activeRailLabel =
    secondaryView === "risks"
      ? copy.conflictsTitle
      : secondaryView === "proposals"
        ? copy.aiProposalsTitle
        : secondaryView === "conflicts"
          ? copy.conflictDetectionTitle
          : copy.unscheduledQueue;

  const activeDayDate = parseDayKey(activeDay) ?? startOfDay(new Date());
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

  const conflictTaskIds = new Set<string>();
  for (const conflict of viewData.conflicts) {
    for (const taskId of conflict.taskIds) {
      conflictTaskIds.add(taskId);
    }
  }

  const cockpitSummary = copy.cockpitSummaryTemplate
    .replace(
      "{scheduled}",
      formatDurationMinutes(viewData.planningSummary.todayLoadMinutes),
    )
    .replace("{queue}", String(viewData.planningSummary.readyToScheduleCount))
    .replace("{risks}", String(viewData.planningSummary.riskCount))
    .replace("{automation}", String(viewData.automationCandidates.length));

  void activeView;

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
    conflictTaskIds,
    cockpitSummary,
    activeRailLabel,
  };
}

