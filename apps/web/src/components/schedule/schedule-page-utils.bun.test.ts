import { describe, expect, it, mock } from "bun:test";

mock.module("@chrona/runtime/modules/tasks/derive-task-runnability", () => ({
  deriveTaskRunnability: () => ({ isRunnable: false, state: "not_configured", summary: "Not configured" }),
}));

import {
  addDays,
  buildCompressedTimeline,
  buildPlanningSummary,
  buildQuickCreateDraft,
  buildScheduleHref,
  buildScheduleViewHref,
  buildTimelinePlacementPreview,
  buildTodayFocusItems,
  buildWeekGroups,
  clampScheduledEndMinute,
  clampScheduledStartMinute,
  describeOwner,
  detectScheduleConflicts,
  formatDateKey,
  formatDateTime,
  formatDayHeading,
  formatDurationMinutes,
  formatShortDay,
  formatTime,
  formatTimeRange,
  formatWeekdayShort,
  getBlockDurationMinutes,
  getDayKey,
  getPriorityAccent,
  getPriorityTone,
  getRunTone,
  getRunnabilityTone,
  getScheduleTone,
  moveScheduledItem,
  normalizeScheduleView,
  parseDayKey,
  snapMinuteToGrid,
  sortScheduledItems,
  startOfDay,
  startOfWeek,
  toDate,
  toDateForDay,
  toTaskConfigInitialValues,
  toTimestamp,
  hydrateSchedulePageData,
} from "@/components/schedule/schedule-page-utils";
import type { ScheduledItem } from "@/components/schedule/schedule-page-types";

function createScheduledItem(overrides: Partial<ScheduledItem> = {}): ScheduledItem {
  return {
    taskId: overrides.taskId ?? "task-1",
    workspaceId: overrides.workspaceId ?? "workspace-1",
    title: overrides.title ?? "Task",
    description: overrides.description ?? null,
    priority: overrides.priority ?? "Medium",
    ownerType: overrides.ownerType ?? "human",
    assigneeAgentId: overrides.assigneeAgentId ?? null,
    persistedStatus: overrides.persistedStatus ?? "Ready",
    displayState: overrides.displayState ?? null,
    actionRequired: overrides.actionRequired ?? null,
    approvalPendingCount: overrides.approvalPendingCount ?? 0,
    scheduleStatus: overrides.scheduleStatus ?? "Scheduled",
    scheduleSource: overrides.scheduleSource ?? "human",
    dueAt: overrides.dueAt ?? null,
    scheduledStartAt: overrides.scheduledStartAt ?? new Date(2026, 3, 15, 9, 0, 0, 0),
    scheduledEndAt: overrides.scheduledEndAt ?? new Date(2026, 3, 15, 10, 0, 0, 0),
    latestRunStatus: overrides.latestRunStatus ?? null,
    scheduleProposalCount: overrides.scheduleProposalCount ?? 0,
    lastActivityAt: overrides.lastActivityAt ?? null,
    runtimeAdapterKey: overrides.runtimeAdapterKey ?? "mock",
    runtimeInput: overrides.runtimeInput ?? {},
    runtimeInputVersion: overrides.runtimeInputVersion ?? "1",
    runtimeModel: overrides.runtimeModel ?? null,
    prompt: overrides.prompt ?? null,
    runtimeConfig: overrides.runtimeConfig ?? null,
    isRunnable: overrides.isRunnable ?? true,
    runnabilityState: overrides.runnabilityState ?? "ready",
    runnabilitySummary: overrides.runnabilitySummary ?? "Ready",
    parentTaskId: null,
  };
}

describe("schedule-page-utils scheduling helpers", () => {
  it("detects overlapping scheduled windows while ignoring the current task", () => {
    const items = [
      createScheduledItem({
        taskId: "task-a",
        scheduledStartAt: new Date(2026, 3, 15, 9, 0, 0, 0),
        scheduledEndAt: new Date(2026, 3, 15, 10, 0, 0, 0),
      }),
      createScheduledItem({
        taskId: "task-b",
        scheduledStartAt: new Date(2026, 3, 15, 10, 30, 0, 0),
        scheduledEndAt: new Date(2026, 3, 15, 11, 30, 0, 0),
      }),
    ];

    expect(
      detectScheduleConflicts(items, {
        startAt: new Date(2026, 3, 15, 9, 30, 0, 0),
        endAt: new Date(2026, 3, 15, 10, 15, 0, 0),
      }),
    ).toEqual({ hasConflict: true, conflictingTaskIds: ["task-a"] });

    expect(
      detectScheduleConflicts(items, {
        taskId: "task-a",
        startAt: new Date(2026, 3, 15, 9, 15, 0, 0),
        endAt: new Date(2026, 3, 15, 9, 45, 0, 0),
      }),
    ).toEqual({ hasConflict: false, conflictingTaskIds: [] });
  });

  it("clamps resized end minute to minimum duration and day end", () => {
    expect(clampScheduledEndMinute(9 * 60, 9 * 60 + 10)).toBe(9 * 60 + 30);
    expect(clampScheduledEndMinute(23 * 60 + 30, 24 * 60 + 30)).toBe(24 * 60);
  });

  it("moves a scheduled item to a new window while keeping its identity", () => {
    const item = createScheduledItem({ taskId: "task-move" });
    const moved = moveScheduledItem(
      item,
      new Date(2026, 3, 15, 13, 0, 0, 0),
      new Date(2026, 3, 15, 14, 30, 0, 0),
    );

    expect(moved).toMatchObject({
      taskId: "task-move",
      scheduleStatus: "Scheduled",
      scheduleSource: "human",
      scheduledStartAt: new Date(2026, 3, 15, 13, 0, 0, 0),
      scheduledEndAt: new Date(2026, 3, 15, 14, 30, 0, 0),
    });
  });

  it("builds a placement preview with conflict metadata", () => {
    const items = [
      createScheduledItem({
        taskId: "task-a",
        scheduledStartAt: new Date(2026, 3, 15, 9, 0, 0, 0),
        scheduledEndAt: new Date(2026, 3, 15, 10, 0, 0, 0),
      }),
    ];
    const compressedTimeline = buildCompressedTimeline(items);

    const preview = buildTimelinePlacementPreview({
      selectedDay: "2026-04-15",
      startMinute: 9 * 60 + 30,
      endMinute: 10 * 60 + 30,
      compressedTimeline,
      items,
      source: "drag",
    });

    expect(preview).toMatchObject({
      startMinute: 9 * 60 + 30,
      endMinute: 10 * 60 + 30,
      hasConflict: true,
      conflictingTaskIds: ["task-a"],
      source: "drag",
    });
    expect(preview.height).toBeGreaterThan(0);
  });
});

describe("toTimestamp / toDate / getDayKey – string date handling", () => {
  it("toTimestamp handles Date objects", () => {
    const d = new Date(2026, 3, 15, 9, 0);
    expect(toTimestamp(d)).toBe(d.getTime());
  });

  it("toTimestamp handles ISO strings", () => {
    const d = new Date(2026, 3, 15, 9, 0);
    expect(toTimestamp(d.toISOString())).toBe(d.getTime());
  });

  it("toTimestamp returns null for null/undefined", () => {
    expect(toTimestamp(null)).toBeNull();
    expect(toTimestamp(undefined)).toBeNull();
  });

  it("toTimestamp returns null for invalid strings", () => {
    expect(toTimestamp("not-a-date")).toBeNull();
  });

  it("toDate converts ISO strings to Date objects", () => {
    const d = new Date(2026, 3, 15, 9, 0);
    const result = toDate(d.toISOString());
    expect(result).toBeInstanceOf(Date);
    expect(result!.getTime()).toBe(d.getTime());
  });

  it("toDate returns null for invalid input", () => {
    expect(toDate(null)).toBeNull();
    expect(toDate("garbage")).toBeNull();
  });

  it("getDayKey handles ISO strings", () => {
    const d = new Date(2026, 3, 15);
    expect(getDayKey(d.toISOString())).toBe(getDayKey(d));
  });
});

describe("sortScheduledItems – with string dates", () => {
  it("sorts items with ISO string dates correctly", () => {
    const early = createScheduledItem({
      taskId: "early",
      scheduledStartAt: "2026-04-15T09:00:00.000Z" as unknown as Date,
    });
    const late = createScheduledItem({
      taskId: "late",
      scheduledStartAt: "2026-04-15T14:00:00.000Z" as unknown as Date,
    });

    const sorted = sortScheduledItems([late, early]);
    expect(sorted[0].taskId).toBe("early");
    expect(sorted[1].taskId).toBe("late");
  });

  it("hydrates schedule page data so string scheduled dates become real Date objects", () => {
    const hydrated = hydrateSchedulePageData({
      defaultRuntimeAdapterKey: "openclaw",
      runtimeAdapters: [],
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
        todayLoadMinutes: 60,
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
          ...createScheduledItem({ taskId: "task-string-dates" }),
          scheduledStartAt: "2026-04-15T09:00:00.000Z",
          scheduledEndAt: "2026-04-15T10:00:00.000Z",
          dueAt: "2026-04-15T12:00:00.000Z",
        },
      ],
      unscheduled: [],
      proposals: [],
      risks: [],
      listItems: [],
      conflicts: [],
      suggestions: [],
    } as unknown as Parameters<typeof hydrateSchedulePageData>[0]);

    expect(hydrated.scheduled[0]?.scheduledStartAt).toBeInstanceOf(Date);
    expect(hydrated.scheduled[0]?.scheduledEndAt).toBeInstanceOf(Date);
    expect(hydrated.scheduled[0]?.dueAt).toBeInstanceOf(Date);
    expect(hydrated.scheduled[0]?.scheduledStartAt?.getHours()).toBeTypeOf("number");
  });

  it("sorts mixed Date and string dates", () => {
    const dateItem = createScheduledItem({
      taskId: "date-item",
      scheduledStartAt: new Date("2026-04-15T14:00:00.000Z"),
    });
    const stringItem = createScheduledItem({
      taskId: "string-item",
      scheduledStartAt: "2026-04-15T08:00:00.000Z" as unknown as Date,
    });

    const sorted = sortScheduledItems([dateItem, stringItem]);
    expect(sorted[0].taskId).toBe("string-item");
    expect(sorted[1].taskId).toBe("date-item");
  });
});

describe("buildWeekGroups – with string dates", () => {
  it("handles items with ISO string scheduledStartAt", () => {
    const item = createScheduledItem({
      taskId: "string-date-task",
      scheduledStartAt: "2026-04-15T09:00:00.000Z" as unknown as Date,
      scheduledEndAt: "2026-04-15T10:00:00.000Z" as unknown as Date,
    });

    const groups = buildWeekGroups(
      [item],
      [],
      [],
      "2026-04-15",
      "en",
      {} as Parameters<typeof buildWeekGroups>[5],
    );

    // Should produce 7 day groups (one week)
    expect(groups.length).toBe(7);

    // Find the group containing our item
    const groupWithItem = groups.find((g) => g.items.length > 0);
    expect(groupWithItem).toBeTruthy();
    expect(groupWithItem!.items[0].taskId).toBe("string-date-task");
  });
});

// ---------------------------------------------------------------------------
// 1. Formatting functions
// ---------------------------------------------------------------------------
describe("formatting functions", () => {
  describe("formatDateTime", () => {
    it("returns '-' for null", () => {
      expect(formatDateTime(null, "en")).toBe("-");
    });

    it("returns '-' for undefined", () => {
      expect(formatDateTime(undefined, "en")).toBe("-");
    });

    it("formats a Date for en locale", () => {
      const d = new Date(2026, 3, 15, 14, 30);
      const result = formatDateTime(d, "en");
      expect(result).toContain("Apr");
      expect(result).toContain("15");
    });

    it("formats a Date for zh locale", () => {
      const d = new Date(2026, 3, 15, 14, 30);
      const result = formatDateTime(d, "zh");
      expect(typeof result).toBe("string");
      expect(result).not.toBe("-");
    });
  });

  describe("formatTime", () => {
    it("returns '--' for null", () => {
      expect(formatTime(null, "en")).toBe("--");
    });

    it("returns '--' for undefined", () => {
      expect(formatTime(undefined, "en")).toBe("--");
    });

    it("formats a time", () => {
      const d = new Date(2026, 3, 15, 14, 30);
      const result = formatTime(d, "en");
      expect(result).toContain("30");
    });
  });

  describe("formatDayHeading", () => {
    it("returns copy.noScheduledStart for null", () => {
      expect(formatDayHeading(null)).toBe("No scheduled start");
    });

    it("formats a date with weekday", () => {
      const d = new Date(2026, 3, 15); // Wednesday
      const result = formatDayHeading(d, "en");
      expect(result).toContain("Wed");
      expect(result).toContain("Apr");
    });
  });

  describe("formatWeekdayShort", () => {
    it("returns abbreviated weekday", () => {
      const d = new Date(2026, 3, 13); // Monday
      expect(formatWeekdayShort(d, "en")).toBe("Mon");
    });
  });

  describe("describeOwner", () => {
    const copy = { agentPrefix: "Agent", agentAssigned: "Agent-assigned", humanOwned: "Human-owned" };

    it("returns humanOwned for human owner", () => {
      expect(describeOwner("human", null, copy)).toBe("Human-owned");
    });

    it("returns agent prefix with id", () => {
      expect(describeOwner("agent", "bot-1", copy)).toBe("Agent · bot-1");
    });

    it("returns agentAssigned when no assigneeAgentId", () => {
      expect(describeOwner("agent", null, copy)).toBe("Agent-assigned");
    });
  });

  describe("formatShortDay", () => {
    it("returns copy.unscheduled for null", () => {
      expect(formatShortDay(null, "en", { unscheduled: "Unscheduled" })).toBe("Unscheduled");
    });

    it("formats a date", () => {
      const d = new Date(2026, 3, 15);
      const result = formatShortDay(d, "en", { unscheduled: "Unscheduled" });
      expect(result).toContain("15");
    });
  });

  describe("formatTimeRange", () => {
    it("returns copy.timeNotSet when both null", () => {
      expect(formatTimeRange(null, null, "en", { timeNotSet: "Time not set" })).toBe("Time not set");
    });

    it("formats start → end", () => {
      const s = new Date(2026, 3, 15, 9, 0);
      const e = new Date(2026, 3, 15, 10, 0);
      const result = formatTimeRange(s, e, "en", { timeNotSet: "Time not set" });
      expect(result).toContain("→");
    });

    it("formats with one null side", () => {
      const s = new Date(2026, 3, 15, 9, 0);
      const result = formatTimeRange(s, null, "en", { timeNotSet: "Time not set" });
      expect(result).toContain("→");
      expect(result).toContain("--");
    });
  });

  describe("formatDurationMinutes", () => {
    it("returns minutes only for < 60", () => {
      expect(formatDurationMinutes(30)).toBe("30m");
    });

    it("returns hours only for exact hours", () => {
      expect(formatDurationMinutes(60)).toBe("1h");
      expect(formatDurationMinutes(120)).toBe("2h");
    });

    it("returns hours and minutes", () => {
      expect(formatDurationMinutes(90)).toBe("1h 30m");
    });
  });

  describe("formatDateKey", () => {
    it("returns YYYY-MM-DD", () => {
      expect(formatDateKey(new Date(2026, 0, 5))).toBe("2026-01-05");
      expect(formatDateKey(new Date(2026, 11, 25))).toBe("2026-12-25");
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Tone / accent helpers
// ---------------------------------------------------------------------------
describe("tone and accent helpers", () => {
  describe("getPriorityAccent", () => {
    it("returns correct classes", () => {
      expect(getPriorityAccent("Urgent")).toBe("bg-red-500");
      expect(getPriorityAccent("High")).toBe("bg-amber-500");
      expect(getPriorityAccent("Medium")).toBe("bg-amber-400");
      expect(getPriorityAccent("Low")).toBe("bg-emerald-500");
      expect(getPriorityAccent("unknown")).toBe("bg-emerald-500");
    });
  });

  describe("getPriorityTone", () => {
    it("returns correct tones", () => {
      expect(getPriorityTone("Urgent")).toBe("critical");
      expect(getPriorityTone("High")).toBe("warning");
      expect(getPriorityTone("Medium")).toBe("warning");
      expect(getPriorityTone("Low")).toBe("success");
    });
  });

  describe("getScheduleTone", () => {
    it("returns neutral for null/undefined", () => {
      expect(getScheduleTone(null)).toBe("neutral");
      expect(getScheduleTone(undefined)).toBe("neutral");
    });

    it("returns critical for overdue/blocked", () => {
      expect(getScheduleTone("Overdue")).toBe("critical");
      expect(getScheduleTone("Blocked")).toBe("critical");
    });

    it("returns warning for at risk", () => {
      expect(getScheduleTone("AtRisk")).toBe("warning");
      expect(getScheduleTone("At Risk")).toBe("warning");
    });

    it("returns info for scheduled/inprogress", () => {
      expect(getScheduleTone("Scheduled")).toBe("info");
      expect(getScheduleTone("InProgress")).toBe("info");
    });

    it("returns neutral for unknown", () => {
      expect(getScheduleTone("Done")).toBe("neutral");
    });
  });

  describe("getRunTone", () => {
    it("returns neutral for null", () => {
      expect(getRunTone(null)).toBe("neutral");
    });

    it("returns success for completed", () => {
      expect(getRunTone("Completed")).toBe("success");
    });

    it("returns warning for waiting statuses", () => {
      expect(getRunTone("WaitingForApproval")).toBe("warning");
      expect(getRunTone("WaitingForInput")).toBe("warning");
    });

    it("returns critical for failed/cancelled", () => {
      expect(getRunTone("Failed")).toBe("critical");
      expect(getRunTone("Cancelled")).toBe("critical");
    });

    it("returns info for other statuses", () => {
      expect(getRunTone("Running")).toBe("info");
    });
  });

  describe("getRunnabilityTone", () => {
    it("returns success when runnable", () => {
      expect(getRunnabilityTone(true)).toBe("success");
    });

    it("returns warning when not runnable", () => {
      expect(getRunnabilityTone(false)).toBe("warning");
      expect(getRunnabilityTone(undefined)).toBe("warning");
    });
  });
});

// ---------------------------------------------------------------------------
// 3. Date helpers
// ---------------------------------------------------------------------------
describe("date helpers", () => {
  describe("startOfDay", () => {
    it("zeroes time components", () => {
      const d = startOfDay(new Date(2026, 3, 15, 14, 30, 45, 123));
      expect(d.getHours()).toBe(0);
      expect(d.getMinutes()).toBe(0);
      expect(d.getSeconds()).toBe(0);
      expect(d.getMilliseconds()).toBe(0);
      expect(d.getDate()).toBe(15);
    });
  });

  describe("addDays", () => {
    it("adds positive days", () => {
      const d = addDays(new Date(2026, 3, 15), 3);
      expect(d.getDate()).toBe(18);
    });

    it("subtracts with negative days", () => {
      const d = addDays(new Date(2026, 3, 15), -5);
      expect(d.getDate()).toBe(10);
    });

    it("crosses month boundary", () => {
      const d = addDays(new Date(2026, 3, 29), 5);
      expect(d.getMonth()).toBe(4); // May
      expect(d.getDate()).toBe(4);
    });
  });

  describe("startOfWeek", () => {
    it("returns Monday for a Wednesday", () => {
      const wed = new Date(2026, 3, 15); // Wed Apr 15
      const mon = startOfWeek(wed);
      expect(mon.getDay()).toBe(1); // Monday
      expect(mon.getDate()).toBe(13);
    });

    it("returns same day for Monday", () => {
      const mon = new Date(2026, 3, 13);
      const result = startOfWeek(mon);
      expect(result.getDate()).toBe(13);
    });

    it("returns previous Monday for Sunday", () => {
      const sun = new Date(2026, 3, 19); // Sunday
      const result = startOfWeek(sun);
      expect(result.getDay()).toBe(1);
      expect(result.getDate()).toBe(13);
    });
  });

  describe("parseDayKey", () => {
    it("parses valid YYYY-MM-DD", () => {
      const d = parseDayKey("2026-04-15");
      expect(d).not.toBeNull();
      expect(d!.getFullYear()).toBe(2026);
      expect(d!.getMonth()).toBe(3);
      expect(d!.getDate()).toBe(15);
    });

    it("returns null for undefined", () => {
      expect(parseDayKey(undefined)).toBeNull();
    });

    it("returns null for invalid format", () => {
      expect(parseDayKey("not-a-date")).toBeNull();
      expect(parseDayKey("2026-13")).toBeNull();
    });
  });

  describe("toDateForDay", () => {
    it("combines dayKey and minute offset", () => {
      const d = toDateForDay("2026-04-15", 9 * 60 + 30);
      expect(d.getFullYear()).toBe(2026);
      expect(d.getMonth()).toBe(3);
      expect(d.getDate()).toBe(15);
      expect(d.getHours()).toBe(9);
      expect(d.getMinutes()).toBe(30);
    });
  });

  describe("snapMinuteToGrid", () => {
    it("snaps to nearest 30-min slot", () => {
      expect(snapMinuteToGrid(0)).toBe(0);
      expect(snapMinuteToGrid(14)).toBe(0);
      expect(snapMinuteToGrid(15)).toBe(30);
      expect(snapMinuteToGrid(29)).toBe(30);
      expect(snapMinuteToGrid(45)).toBe(60);
    });
  });

  describe("clampScheduledStartMinute", () => {
    it("clamps to 0 minimum", () => {
      expect(clampScheduledStartMinute(-10)).toBe(0);
    });

    it("clamps to max (1380 = 23:00)", () => {
      expect(clampScheduledStartMinute(1500)).toBe(1380);
    });

    it("passes through valid values", () => {
      expect(clampScheduledStartMinute(540)).toBe(540);
    });
  });

  describe("getBlockDurationMinutes", () => {
    it("returns duration from start/end", () => {
      const result = getBlockDurationMinutes({
        scheduledStartAt: new Date(2026, 3, 15, 9, 0),
        scheduledEndAt: new Date(2026, 3, 15, 10, 30),
      });
      expect(result).toBe(90);
    });

    it("returns default when start is null", () => {
      expect(getBlockDurationMinutes({ scheduledStartAt: null, scheduledEndAt: null })).toBe(60);
    });

    it("enforces minimum of TIMELINE_SLOT_MINUTES (30)", () => {
      const result = getBlockDurationMinutes({
        scheduledStartAt: new Date(2026, 3, 15, 9, 0),
        scheduledEndAt: new Date(2026, 3, 15, 9, 10),
      });
      expect(result).toBe(30);
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Quick create
// ---------------------------------------------------------------------------
describe("buildQuickCreateDraft", () => {
  it("preserves a long Chinese title without truncation", () => {
    const result = buildQuickCreateDraft({
      title: "参加美国总统竞选",
      selectedDay: "2026-04-15",
      now: new Date(2026, 3, 15, 10, 0, 0, 0),
    });

    expect(result.title).toBe("参加美国总统竞选");
    expect(result.priority).toBe("Medium");
  });

  it("builds draft with defaults", () => {
    const draft = buildQuickCreateDraft({
      title: " My task ",
      selectedDay: "2026-04-20",
      now: new Date(2026, 3, 15, 10, 0),
    });
    expect(draft.title).toBe("My task");
    expect(draft.priority).toBe("Medium");
    expect(draft.dueAt).toBeNull();
    // Different day → starts at 9:00
    expect(draft.scheduledStartAt!.getHours()).toBe(9);
  });

  it("uses rounded-up current time for same day", () => {
    const now = new Date(2026, 3, 15, 10, 7);
    const draft = buildQuickCreateDraft({
      title: "Task",
      selectedDay: "2026-04-15",
      now,
    });
    expect(draft.scheduledStartAt!.getMinutes()).toBe(15);
  });

  it("applies custom priority and duration", () => {
    const draft = buildQuickCreateDraft({
      title: "Task",
      selectedDay: "2026-04-20",
      now: new Date(2026, 3, 15),
      priority: "High",
      durationMinutes: 120,
    });
    expect(draft.priority).toBe("High");
    const durationMs = draft.scheduledEndAt!.getTime() - draft.scheduledStartAt!.getTime();
    expect(durationMs).toBe(120 * 60000);
  });
});

// ---------------------------------------------------------------------------
// 5. Compressed timeline
// ---------------------------------------------------------------------------
describe("buildCompressedTimeline", () => {
  it("returns 24 hours with no items", () => {
    const timeline = buildCompressedTimeline([]);
    expect(timeline.hours.length).toBe(24);
    expect(timeline.totalVisualHeight).toBeGreaterThanOrEqual(320);
  });

  it("marks active hours based on items", () => {
    const items = [
      createScheduledItem({
        scheduledStartAt: new Date(2026, 3, 15, 9, 0),
        scheduledEndAt: new Date(2026, 3, 15, 10, 0),
      }),
    ];
    const timeline = buildCompressedTimeline(items);
    expect(timeline.hours[9].active).toBe(true);
    expect(timeline.hours[0].active).toBe(false);
  });

  it("mapMinuteToY and mapYToMinute roundtrip", () => {
    const items = [
      createScheduledItem({
        scheduledStartAt: new Date(2026, 3, 15, 9, 0),
        scheduledEndAt: new Date(2026, 3, 15, 11, 0),
      }),
    ];
    const timeline = buildCompressedTimeline(items);

    // Test roundtrip for several minutes
    for (const minute of [0, 60, 9 * 60, 9 * 60 + 30, 12 * 60, 23 * 60 + 59, 24 * 60]) {
      const y = timeline.mapMinuteToY(minute);
      const back = timeline.mapYToMinute(y);
      expect(back).toBeCloseTo(minute, 0);
    }
  });

  it("mapMinuteToY clamps out-of-range values", () => {
    const timeline = buildCompressedTimeline([]);
    expect(timeline.mapMinuteToY(-100)).toBe(timeline.mapMinuteToY(0));
    expect(timeline.mapMinuteToY(2000)).toBe(timeline.mapMinuteToY(24 * 60));
  });
});

// ---------------------------------------------------------------------------
// 6. Navigation helpers
// ---------------------------------------------------------------------------
describe("navigation helpers", () => {
  describe("normalizeScheduleView", () => {
    it("returns 'list' for 'list'", () => {
      expect(normalizeScheduleView("list")).toBe("list");
    });

    it("returns 'timeline' for anything else", () => {
      expect(normalizeScheduleView("timeline")).toBe("timeline");
      expect(normalizeScheduleView(undefined)).toBe("timeline");
      expect(normalizeScheduleView("foo")).toBe("timeline");
    });
  });

  describe("buildScheduleHref", () => {
    it("builds href with day only", () => {
      expect(buildScheduleHref("2026-04-15")).toBe("/schedule?day=2026-04-15");
    });

    it("builds href with day and taskId", () => {
      const href = buildScheduleHref("2026-04-15", "task-1");
      expect(href).toContain("day=2026-04-15");
      expect(href).toContain("task=task-1");
    });
  });

  describe("buildScheduleViewHref", () => {
    it("includes view param for list", () => {
      const href = buildScheduleViewHref("2026-04-15", "list");
      expect(href).toContain("view=list");
    });

    it("omits view param for timeline", () => {
      const href = buildScheduleViewHref("2026-04-15", "timeline");
      expect(href).not.toContain("view=");
    });

    it("includes taskId when provided", () => {
      const href = buildScheduleViewHref("2026-04-15", "list", "task-1");
      expect(href).toContain("task=task-1");
    });
  });
});

// ---------------------------------------------------------------------------
// 7. Config / summary helpers
// ---------------------------------------------------------------------------
describe("toTaskConfigInitialValues", () => {
  it("extracts config fields with defaults for missing values", () => {
    const result = toTaskConfigInitialValues({
      title: "My Task",
      priority: "High",
    });
    expect(result.title).toBe("My Task");
    expect(result.priority).toBe("High");
    expect(result.description).toBeNull();
    expect(result.runtimeAdapterKey).toBeNull();
    expect(result.runtimeModel).toBeNull();
    expect(result.prompt).toBeNull();
    expect(result.dueAt).toBeNull();
  });

  it("passes through provided values", () => {
    const due = new Date(2026, 3, 20);
    const result = toTaskConfigInitialValues({
      title: "Task",
      description: "Desc",
      priority: "Low",
      runtimeAdapterKey: "openai",
      runtimeModel: "gpt-4",
      prompt: "Do stuff",
      dueAt: due,
      runtimeInput: { key: "val" },
      runtimeInputVersion: "2",
      runtimeConfig: { temp: 0.5 },
    });
    expect(result.description).toBe("Desc");
    expect(result.runtimeAdapterKey).toBe("openai");
    expect(result.dueAt).toBe(due);
    expect(result.runtimeInput).toEqual({ key: "val" });
  });
});

describe("buildPlanningSummary", () => {
  it("computes summary metrics for empty input", () => {
    const summary = buildPlanningSummary({
      scheduled: [],
      unscheduled: [],
      proposals: [],
      risks: [],
    });
    expect(summary.scheduledMinutes).toBe(0);
    expect(summary.conflictCount).toBe(0);
    expect(summary.proposalCount).toBe(0);
    expect(summary.riskCount).toBe(0);
    expect(summary.overdueCount).toBe(0);
  });

  it("counts scheduled minutes", () => {
    const items = [
      createScheduledItem({
        scheduledStartAt: new Date(2026, 3, 15, 9, 0),
        scheduledEndAt: new Date(2026, 3, 15, 10, 30),
      }),
    ];
    const summary = buildPlanningSummary({
      scheduled: items,
      unscheduled: [],
      proposals: [],
      risks: [],
    });
    expect(summary.scheduledMinutes).toBe(90);
  });

  it("counts risks and proposals", () => {
    const summary = buildPlanningSummary({
      scheduled: [],
      unscheduled: [],
      proposals: [{ proposalId: "p1", taskId: "t1", workspaceId: "w1", title: "P", priority: "Medium", ownerType: "human", assigneeAgentId: null, source: "ai", proposedBy: "planner", summary: "s", dueAt: null, scheduledStartAt: null, scheduledEndAt: null }],
      risks: [createScheduledItem({ taskId: "r1" })],
    });
    expect(summary.proposalCount).toBe(1);
    expect(summary.riskCount).toBe(1);
  });
});

describe("buildTodayFocusItems", () => {
  const copy = {
    focusOverdue: "Overdue",
    focusWaitingForInput: "Waiting for input",
    focusWaitingForApproval: "Waiting for approval",
    focusAtRisk: "At risk",
    focusReadyToday: "Ready to start today",
  };

  function makeRisk(overrides: Partial<ReturnType<typeof createScheduledItem>> = {}) {
    return {
      taskId: overrides.taskId ?? "risk-1",
      workspaceId: "w1",
      title: overrides.title ?? "Risk Task",
      description: null,
      priority: overrides.priority ?? "High",
      ownerType: "human",
      assigneeAgentId: null,
      persistedStatus: "Ready",
      displayState: overrides.displayState ?? null,
      actionRequired: null,
      approvalPendingCount: 0,
      scheduleStatus: overrides.scheduleStatus ?? "AtRisk",
      scheduleSource: "human",
      dueAt: null,
      scheduledStartAt: null,
      scheduledEndAt: null,
      latestRunStatus: overrides.latestRunStatus ?? null,
      scheduleProposalCount: 0,
      lastActivityAt: null,
      runtimeAdapterKey: "mock",
      runtimeInput: {},
      runtimeInputVersion: "1",
      runtimeModel: null,
      prompt: null,
      runtimeConfig: null,
      isRunnable: true,
      runnabilityState: "ready_to_run",
    runnabilitySummary: "Ready",
    parentTaskId: null,
  };
  }

  it("returns empty for no risks and no group", () => {
    const data = { scheduled: [], unscheduled: [], proposals: [], risks: [], defaultRuntimeAdapterKey: "", runtimeAdapters: [], summary: {} as any, planningSummary: {} as any, focusZones: [], automationCandidates: [], listItems: [], conflicts: [], suggestions: [] };
    const items = buildTodayFocusItems(data, null, copy);
    expect(items).toEqual([]);
  });

  it("includes overdue risks", () => {
    const risk = makeRisk({ taskId: "t1", scheduleStatus: "Overdue" });
    const data = { scheduled: [], unscheduled: [], proposals: [], risks: [risk], defaultRuntimeAdapterKey: "", runtimeAdapters: [], summary: {} as any, planningSummary: {} as any, focusZones: [], automationCandidates: [], listItems: [], conflicts: [], suggestions: [] };
    const items = buildTodayFocusItems(data, null, copy);
    expect(items.length).toBe(1);
    expect(items[0].reason).toBe("Overdue");
    expect(items[0].tone).toBe("critical");
  });

  it("includes high-priority unstarted items from active group", () => {
    const data = { scheduled: [], unscheduled: [], proposals: [], risks: [], defaultRuntimeAdapterKey: "", runtimeAdapters: [], summary: {} as any, planningSummary: {} as any, focusZones: [], automationCandidates: [], listItems: [], conflicts: [], suggestions: [] };
    const group = {
      key: "2026-04-15",
      date: new Date(2026, 3, 15),
      label: "Wed",
      items: [createScheduledItem({ taskId: "hp-1", priority: "High", latestRunStatus: null })],
      proposalCount: 0,
      riskCount: 0,
    };
    const items = buildTodayFocusItems(data, group, copy);
    expect(items.length).toBe(1);
    expect(items[0].reason).toBe("Ready to start today");
  });

  it("limits to 5 items", () => {
    const risks = Array.from({ length: 8 }, (_, i) =>
      makeRisk({ taskId: `risk-${i}`, scheduleStatus: "Overdue" }),
    );
    const data = { scheduled: [], unscheduled: [], proposals: [], risks, defaultRuntimeAdapterKey: "", runtimeAdapters: [], summary: {} as any, planningSummary: {} as any, focusZones: [], automationCandidates: [], listItems: [], conflicts: [], suggestions: [] };
    const items = buildTodayFocusItems(data, null, copy);
    expect(items.length).toBe(5);
  });
});
