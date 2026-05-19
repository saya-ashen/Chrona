import { describe, expect, test } from "vitest";
import { formatContextSummary, formatPrimaryAction } from "./summarize-context";

describe("context summaries", () => {
  test("formats task and schedule highlights", () => {
    expect(formatContextSummary({
      type: "task",
      fingerprint: "task:1",
      title: "Task context",
      primaryObjectLabel: "Ship feature",
      capabilities: ["modify-plan"],
      highlights: [{ label: "Node", value: "Review" }],
      taskId: "1",
      taskTitle: "Ship feature",
    })).toContain("Node: Review");

    expect(formatPrimaryAction({
      type: "schedule",
      fingerprint: "schedule:1",
      title: "Schedule context",
      primaryObjectLabel: "Today",
      capabilities: ["smart-schedule"],
      highlights: [],
      workspaceId: "w1",
      selectedDate: "2026-05-18",
      unscheduledCount: 2,
      freeMinutes: 120,
      largestIdleWindowMinutes: 60,
      conflictCount: 0,
      activeView: "timeline",
      primaryAction: "Smart schedule",
    })).toBe("Smart schedule");
  });
});
