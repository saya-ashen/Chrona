import { describe, expect, it } from "bun:test";

import { DEFAULT_SCHEDULE_PAGE_COPY } from "@/components/schedule/schedule-page-copy";
import type { SchedulePageData } from "@/components/schedule/schedule-page-types";
import { buildSchedulePageViewModel } from "@/components/schedule/schedule-page-view-model";

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
    defaultExecutionRuntime: "hermes",
    executionRuntimes: [],
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
        executionRuntime: "hermes",
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
});
