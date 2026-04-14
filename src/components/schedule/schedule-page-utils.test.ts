import { describe, expect, it } from "vitest";
import {
  buildCompressedTimeline,
  buildTimelinePlacementPreview,
  clampScheduledEndMinute,
  detectScheduleConflicts,
  moveScheduledItem,
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
