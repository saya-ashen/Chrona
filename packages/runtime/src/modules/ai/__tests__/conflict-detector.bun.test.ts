import { describe, expect, test } from "bun:test";
import {
  detectTimeOverlaps,
  detectOverload,
  detectFragmentation,
  detectDependencyConflicts,
} from "../conflict-detector";
import type { ScheduledTaskInfo } from "../types";

describe("conflict-detector", () => {
  describe("detectTimeOverlaps", () => {
    test("detects overlapping tasks", () => {
      const tasks: ScheduledTaskInfo[] = [
        {
          taskId: "task1",
          title: "Task 1",
          priority: "High",
          scheduledStartAt: new Date("2026-04-15T09:00:00Z"),
          scheduledEndAt: new Date("2026-04-15T10:00:00Z"),
          dueAt: null,
          estimatedMinutes: 60,
          dependencies: [],
        },
        {
          taskId: "task2",
          title: "Task 2",
          priority: "Medium",
          scheduledStartAt: new Date("2026-04-15T09:30:00Z"),
          scheduledEndAt: new Date("2026-04-15T10:30:00Z"),
          dueAt: null,
          estimatedMinutes: 60,
          dependencies: [],
        },
      ];

      const conflicts = detectTimeOverlaps(tasks);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].type).toBe("time_overlap");
      expect(conflicts[0].taskIds).toEqual(["task1", "task2"]);
      expect(conflicts[0].severity).toBe("medium"); // 30 分钟重叠
      expect(conflicts[0].metadata?.overlapMinutes).toBe(30);
    });

    test("does not detect non-overlapping tasks", () => {
      const tasks: ScheduledTaskInfo[] = [
        {
          taskId: "task1",
          title: "Task 1",
          priority: "High",
          scheduledStartAt: new Date("2026-04-15T09:00:00Z"),
          scheduledEndAt: new Date("2026-04-15T10:00:00Z"),
          dueAt: null,
          estimatedMinutes: 60,
          dependencies: [],
        },
        {
          taskId: "task2",
          title: "Task 2",
          priority: "Medium",
          scheduledStartAt: new Date("2026-04-15T10:00:00Z"),
          scheduledEndAt: new Date("2026-04-15T11:00:00Z"),
          dueAt: null,
          estimatedMinutes: 60,
          dependencies: [],
        },
      ];

      const conflicts = detectTimeOverlaps(tasks);

      expect(conflicts).toHaveLength(0);
    });

    test("assigns high severity for large overlaps", () => {
      const tasks: ScheduledTaskInfo[] = [
        {
          taskId: "task1",
          title: "Task 1",
          priority: "High",
          scheduledStartAt: new Date("2026-04-15T09:00:00Z"),
          scheduledEndAt: new Date("2026-04-15T11:00:00Z"),
          dueAt: null,
          estimatedMinutes: 120,
          dependencies: [],
        },
        {
          taskId: "task2",
          title: "Task 2",
          priority: "Medium",
          scheduledStartAt: new Date("2026-04-15T09:30:00Z"),
          scheduledEndAt: new Date("2026-04-15T10:30:00Z"),
          dueAt: null,
          estimatedMinutes: 60,
          dependencies: [],
        },
      ];

      const conflicts = detectTimeOverlaps(tasks);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].severity).toBe("high"); // 60 分钟重叠
    });
  });

  describe("detectOverload", () => {
    test("detects daily overload", () => {
      const tasks: ScheduledTaskInfo[] = [
        {
          taskId: "task1",
          title: "Task 1",
          priority: "High",
          scheduledStartAt: new Date("2026-04-15T09:00:00Z"),
          scheduledEndAt: new Date("2026-04-15T14:00:00Z"),
          dueAt: null,
          estimatedMinutes: 300, // 5 hours
          dependencies: [],
        },
        {
          taskId: "task2",
          title: "Task 2",
          priority: "Medium",
          scheduledStartAt: new Date("2026-04-15T14:00:00Z"),
          scheduledEndAt: new Date("2026-04-15T19:00:00Z"),
          dueAt: null,
          estimatedMinutes: 300, // 5 hours
          dependencies: [],
        },
      ];

      const conflicts = detectOverload(tasks);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].type).toBe("overload");
      expect(conflicts[0].taskIds).toEqual(["task1", "task2"]);
      expect(conflicts[0].metadata?.overloadMinutes).toBe(120); // 10 hours - 8 hours
      expect(conflicts[0].severity).toBe("high"); // >= 120 minutes
    });

    test("does not detect overload for normal workload", () => {
      const tasks: ScheduledTaskInfo[] = [
        {
          taskId: "task1",
          title: "Task 1",
          priority: "High",
          scheduledStartAt: new Date("2026-04-15T09:00:00Z"),
          scheduledEndAt: new Date("2026-04-15T13:00:00Z"),
          dueAt: null,
          estimatedMinutes: 240, // 4 hours
          dependencies: [],
        },
      ];

      const conflicts = detectOverload(tasks);

      expect(conflicts).toHaveLength(0);
    });
  });

  describe("detectFragmentation", () => {
    test("detects fragmented schedule", () => {
      const tasks: ScheduledTaskInfo[] = [
        {
          taskId: "task1",
          title: "Task 1",
          priority: "High",
          scheduledStartAt: new Date("2026-04-15T09:00:00Z"),
          scheduledEndAt: new Date("2026-04-15T09:30:00Z"),
          dueAt: null,
          estimatedMinutes: 30,
          dependencies: [],
        },
        {
          taskId: "task2",
          title: "Task 2",
          priority: "Medium",
          scheduledStartAt: new Date("2026-04-15T10:00:00Z"),
          scheduledEndAt: new Date("2026-04-15T10:30:00Z"),
          dueAt: null,
          estimatedMinutes: 30,
          dependencies: [],
        },
        {
          taskId: "task3",
          title: "Task 3",
          priority: "Low",
          scheduledStartAt: new Date("2026-04-15T11:00:00Z"),
          scheduledEndAt: new Date("2026-04-15T11:30:00Z"),
          dueAt: null,
          estimatedMinutes: 30,
          dependencies: [],
        },
        {
          taskId: "task4",
          title: "Task 4",
          priority: "Low",
          scheduledStartAt: new Date("2026-04-15T12:00:00Z"),
          scheduledEndAt: new Date("2026-04-15T12:30:00Z"),
          dueAt: null,
          estimatedMinutes: 30,
          dependencies: [],
        },
      ];

      const conflicts = detectFragmentation(tasks);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].type).toBe("fragmentation");
      expect(conflicts[0].taskIds).toHaveLength(4);
      expect(conflicts[0].metadata?.fragmentedMinutes).toBe(120);
      expect(conflicts[0].severity).toBe("medium"); // 4 tasks, 120 minutes
    });

    test("does not detect fragmentation for focused schedule", () => {
      const tasks: ScheduledTaskInfo[] = [
        {
          taskId: "task1",
          title: "Task 1",
          priority: "High",
          scheduledStartAt: new Date("2026-04-15T09:00:00Z"),
          scheduledEndAt: new Date("2026-04-15T11:00:00Z"),
          dueAt: null,
          estimatedMinutes: 120,
          dependencies: [],
        },
      ];

      const conflicts = detectFragmentation(tasks);

      expect(conflicts).toHaveLength(0);
    });
  });

  describe("detectDependencyConflicts", () => {
    test("detects dependency order violation", () => {
      const tasks: ScheduledTaskInfo[] = [
        {
          taskId: "task1",
          title: "Task 1",
          priority: "High",
          scheduledStartAt: new Date("2026-04-15T09:00:00Z"),
          scheduledEndAt: new Date("2026-04-15T10:00:00Z"),
          dueAt: null,
          estimatedMinutes: 60,
          dependencies: ["task2"], // depends on task2
        },
        {
          taskId: "task2",
          title: "Task 2",
          priority: "Medium",
          scheduledStartAt: new Date("2026-04-15T10:00:00Z"),
          scheduledEndAt: new Date("2026-04-15T11:00:00Z"),
          dueAt: null,
          estimatedMinutes: 60,
          dependencies: [],
        },
      ];

      const conflicts = detectDependencyConflicts(tasks);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].type).toBe("dependency");
      expect(conflicts[0].taskIds).toEqual(["task1", "task2"]);
      expect(conflicts[0].severity).toBe("high");
    });

    test("does not detect conflict for correct dependency order", () => {
      const tasks: ScheduledTaskInfo[] = [
        {
          taskId: "task1",
          title: "Task 1",
          priority: "High",
          scheduledStartAt: new Date("2026-04-15T10:00:00Z"),
          scheduledEndAt: new Date("2026-04-15T11:00:00Z"),
          dueAt: null,
          estimatedMinutes: 60,
          dependencies: ["task2"], // depends on task2
        },
        {
          taskId: "task2",
          title: "Task 2",
          priority: "Medium",
          scheduledStartAt: new Date("2026-04-15T09:00:00Z"),
          scheduledEndAt: new Date("2026-04-15T10:00:00Z"),
          dueAt: null,
          estimatedMinutes: 60,
          dependencies: [],
        },
      ];

      const conflicts = detectDependencyConflicts(tasks);

      expect(conflicts).toHaveLength(0);
    });
  });
});
