import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock database and query dependencies
vi.mock("@/lib/db", () => ({
  db: {
    taskProjection: { findMany: vi.fn().mockResolvedValue([]) },
    task: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock("@/modules/queries/get-schedule-page", () => ({
  getSchedulePage: vi.fn().mockResolvedValue({
    listItems: [],
    planningSummary: {
      totalCount: 0,
      scheduledCount: 0,
      scheduledMinutes: 0,
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
    conflicts: [],
    suggestions: [],
    proposals: [],
    risks: [],
    automationCandidates: [],
    defaultRuntimeAdapterKey: "openclaw",
    runtimeAdapters: [],
  }),
}));

vi.mock("@/modules/queries/get-task-center", () => ({
  getTaskCenter: vi.fn().mockResolvedValue([]),
}));

// We need to mock the runtime sync module
vi.mock("@/modules/runtime/openclaw/sync-run", () => ({
  syncStaleWorkspaceRunsForRead: vi.fn().mockResolvedValue(undefined),
}));

import { executeScheduleTool } from "../schedule-suggest-plugin";
import { getSchedulePage } from "@/modules/queries/get-schedule-page";
import { getTaskCenter } from "@/modules/queries/get-task-center";

describe("schedule-suggest-plugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("executeScheduleTool", () => {
    it("returns error for unknown tool", async () => {
      const result = await executeScheduleTool({
        name: "unknown.tool",
        arguments: {},
        workspaceId: "ws_test",
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("Unknown tool");
    });

    it("executes schedule.list_tasks", async () => {
      const mockTasks = [
        {
          taskId: "t1",
          title: "Test task",
          persistedStatus: "Ready",
          displayState: "Ready",
          scheduleStatus: "Unscheduled",
          dueAt: null,
          latestRunStatus: null,
          actionRequired: null,
          updatedAt: new Date(),
          workspaceId: "ws_test",
        },
      ];
      vi.mocked(getTaskCenter).mockResolvedValue(mockTasks as never);

      const result = await executeScheduleTool({
        name: "schedule.list_tasks",
        arguments: { limit: 5 },
        workspaceId: "ws_test",
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        tasks: [
          {
            taskId: "t1",
            title: "Test task",
            status: "Ready",
            displayState: "Ready",
            scheduleStatus: "Unscheduled",
            dueAt: null,
          },
        ],
        total: 1,
      });
    });

    it("executes schedule.get_health", async () => {
      const result = await executeScheduleTool({
        name: "schedule.get_health",
        arguments: {},
        workspaceId: "ws_test",
      });

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty("summary");
      expect(result.data).toHaveProperty("conflictCount");
    });

    it("executes schedule.check_conflicts with no overlaps", async () => {
      vi.mocked(getSchedulePage).mockResolvedValue({
        listItems: [],
        planningSummary: {} as never,
        focusZones: [],
        conflicts: [],
        suggestions: [],
        proposals: [],
        risks: [],
        automationCandidates: [],
        defaultRuntimeAdapterKey: "openclaw",
        runtimeAdapters: [],
      } as never);

      const result = await executeScheduleTool({
        name: "schedule.check_conflicts",
        arguments: {
          start_time: "2026-04-16T09:00:00Z",
          end_time: "2026-04-16T10:00:00Z",
        },
        workspaceId: "ws_test",
      });

      expect(result.success).toBe(true);
      expect((result.data as { hasConflicts: boolean }).hasConflicts).toBe(false);
    });

    it("detects conflicts in schedule.check_conflicts", async () => {
      vi.mocked(getSchedulePage).mockResolvedValue({
        listItems: [
          {
            taskId: "t1",
            title: "Existing task",
            scheduledStartAt: new Date("2026-04-16T09:30:00Z"),
            scheduledEndAt: new Date("2026-04-16T10:30:00Z"),
          },
        ],
        planningSummary: {} as never,
        focusZones: [],
        conflicts: [],
        suggestions: [],
        proposals: [],
        risks: [],
        automationCandidates: [],
        defaultRuntimeAdapterKey: "openclaw",
        runtimeAdapters: [],
      } as never);

      const result = await executeScheduleTool({
        name: "schedule.check_conflicts",
        arguments: {
          start_time: "2026-04-16T09:00:00Z",
          end_time: "2026-04-16T10:00:00Z",
        },
        workspaceId: "ws_test",
      });

      expect(result.success).toBe(true);
      const data = result.data as {
        hasConflicts: boolean;
        conflictingTasks: Array<{ taskId: string }>;
      };
      expect(data.hasConflicts).toBe(true);
      expect(data.conflictingTasks).toHaveLength(1);
      expect(data.conflictingTasks[0].taskId).toBe("t1");
    });

    it("returns error when check_conflicts missing times", async () => {
      const result = await executeScheduleTool({
        name: "schedule.check_conflicts",
        arguments: {},
        workspaceId: "ws_test",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("start_time and end_time are required");
    });
  });
});
