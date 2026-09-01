import { describe, expect, it } from "bun:test";

import { DEFAULT_SCHEDULE_PAGE_COPY } from "./schedule-page-copy";
import type { SchedulePageData } from "./schedule-page-types";
import {
  buildSchedulePageViewModel,
  deriveScheduleDisplayState,
} from "./schedule-page-view-model";

function formatDateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function startOfWeek(value: Date) {
  const day = value.getDay();
  const offset = (day + 6) % 7;
  const date = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  date.setDate(date.getDate() - offset);
  return date;
}

function addDays(value: Date, amount: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + amount);
  return date;
}

function createData(scheduledStartAt: Date): SchedulePageData {
  const scheduledEndAt = new Date(scheduledStartAt);
  scheduledEndAt.setHours(scheduledEndAt.getHours() + 1);

  return {
    summary: {
      scheduledCount: 1,
      unscheduledCount: 0,
      proposalCount: 0,
      riskCount: 0,
    },
    planningSummary: {
      scheduledMinutes: 60,
      runnableQueueCount: 0,
      conflictCount: 0,
      overloadedDayCount: 0,
      proposalCount: 0,
      riskCount: 0,
      todayLoadMinutes: 0,
      overdueCount: 0,
      atRiskCount: 0,
      readyToScheduleCount: 0,
      autoRunnableCount: 0,
      waitingOnUserCount: 0,
      dueSoonUnscheduledCount: 0,
      largestIdleWindowMinutes: 0,
      overloadedMinutes: 0,
    },
    focusZones: [],
    automationCandidates: [],
    scheduled: [
      {
        taskId: "task-1",
        workspaceId: "workspace-1",
        parentTaskId: null,
        title: "Earlier this week",
        description: null,
        priority: "Medium",
        persistedStatus: "Ready",
        displayState: null,
        actionRequired: null,
        approvalPendingCount: 0,
        scheduleStatus: "Scheduled",
        scheduleSource: "human",
        dueAt: null,
        scheduledStartAt,
        scheduledEndAt,
        latestRunStatus: null,
        scheduleProposalCount: 0,
        lastActivityAt: null,
        executionConfig: {},
        autoPlanGeneration: false,
        autoExecute: false,
        autoPlanGenerationTiming: "at_start",
        autoExecuteTiming: "at_start",
        isRunnable: true,
        runnabilityState: "ready",
        runnabilitySummary: "Ready",
      },
    ],
    unscheduled: [],
    proposals: [],
    risks: [],
    listItems: [],
    workBlocks: [],
  };
}

describe("buildSchedulePageViewModel", () => {
  it("defaults to today even when another day in the week has scheduled work", () => {
    const today = new Date();
    const weekStart = startOfWeek(today);
    const otherDay = formatDateKey(weekStart) === formatDateKey(today)
      ? addDays(weekStart, 1)
      : weekStart;
    otherDay.setHours(9, 0, 0, 0);

    const viewModel = buildSchedulePageViewModel({
      viewData: createData(otherDay),
      activeView: "timeline",
      secondaryView: "queue",
      locale: "en",
      copy: DEFAULT_SCHEDULE_PAGE_COPY,
    });

    expect(viewModel.activeDay).toBe(formatDateKey(today));
  });

  it("selects a scheduled occurrence by work block id", () => {
    const day = new Date("2026-06-04T22:00:00");
    const data = createData(day);
    data.scheduled = [
      { ...data.scheduled[0], workBlockId: "block-1", title: "First occurrence" },
      { ...data.scheduled[0], workBlockId: "block-2", title: "Second occurrence", scheduledStartAt: new Date("2026-06-04T23:00:00") },
    ];

    const viewModel = buildSchedulePageViewModel({
      viewData: data,
      selectedDay: "2026-06-04",
      localSelectedTaskId: "block-2",
      activeView: "timeline",
      secondaryView: "queue",
      locale: "en",
      copy: DEFAULT_SCHEDULE_PAGE_COPY,
    });

    expect(viewModel.selectedItem?.title).toBe("Second occurrence");
  });
});

describe("deriveScheduleDisplayState", () => {
  const cases = [
    {
      name: "empty day with ready work",
      readyCount: 4,
      attentionCount: 0,
      expectedAction: "schedule_task",
      expectedTab: "queue",
    },
    {
      name: "empty day requiring attention",
      readyCount: 4,
      attentionCount: 2,
      expectedAction: "review_attention",
      expectedTab: "attention",
    },
    {
      name: "clear day without work",
      readyCount: 0,
      attentionCount: 0,
      expectedAction: "create_task",
      expectedTab: "queue",
    },
  ] as const;

  for (const testCase of cases) {
    it(testCase.name, () => {
      const display = deriveScheduleDisplayState({
        activeGroup: null,
        activeView: "timeline",
        readyCount: testCase.readyCount,
        attentionCount: testCase.attentionCount,
      });

      expect(display.day.phase).toBe("empty");
      expect(display.primaryAction).toBe(testCase.expectedAction);
      expect(display.planningDrawer.defaultTab).toBe(testCase.expectedTab);
    });
  }

  it("keeps agenda and timeline on the selected day's scheduled items", () => {
    const scheduledStartAt = new Date("2026-06-04T09:00:00");
    const data = createData(scheduledStartAt);
    const model = buildSchedulePageViewModel({
      viewData: data,
      selectedDay: "2026-06-04",
      activeView: "list",
      secondaryView: "queue",
      locale: "en",
      copy: DEFAULT_SCHEDULE_PAGE_COPY,
    });

    expect(model.display.primarySurface).toBe("agenda");
    expect(model.display.day.phase).toBe("scheduled");
    expect(model.display.day.scheduledCount).toBe(1);
    expect(model.display.day.scheduledMinutes).toBe(60);
    expect(model.activeGroup?.items.map((item) => item.taskId)).toEqual([
      "task-1",
    ]);
  });
});
