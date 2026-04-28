import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { aiChat } from "../ai-service";
import { analyzeConflictsSmart, analyzeConflicts } from "../conflict-analyzer";
import type { ScheduledTaskInfo } from "../types";

vi.mock("../ai-service", () => ({
  aiChat: vi.fn(),
}));

function d(hour: number, minute = 0): Date {
  return new Date(
    `2026-04-15T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`,
  );
}

function makeTask(
  overrides: Partial<ScheduledTaskInfo> & { taskId: string },
): ScheduledTaskInfo {
  return {
    title: `Task ${overrides.taskId}`,
    priority: "Medium",
    scheduledStartAt: d(9, 0),
    scheduledEndAt: d(10, 0),
    dueAt: null,
    estimatedMinutes: 60,
    dependencies: [],
    ...overrides,
  };
}

// ---------- Tests ----------

describe("analyzeConflictsSmart", () => {
  const aiChatMock = vi.mocked(aiChat);

  beforeEach(() => {
    aiChatMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Always uses rule-based detection for conflicts ───

  describe("always uses rule-based conflict detection", () => {
    it("detects time overlap conflicts using rules", async () => {
      const tasks: ScheduledTaskInfo[] = [
        makeTask({
          taskId: "t1",
          title: "Meeting A",
          scheduledStartAt: d(9, 0),
          scheduledEndAt: d(10, 0),
        }),
        makeTask({
          taskId: "t2",
          title: "Meeting B",
          scheduledStartAt: d(9, 30),
          scheduledEndAt: d(10, 30),
        }),
      ];

      const result = await analyzeConflictsSmart(tasks);

      expect(result.conflicts.length).toBeGreaterThan(0);
      expect(result.conflicts[0].type).toBe("time_overlap");
      expect(result.conflicts[0].taskIds).toContain("t1");
      expect(result.conflicts[0].taskIds).toContain("t2");
    });

    it("detects dependency conflicts using rules", async () => {
      const tasks: ScheduledTaskInfo[] = [
        makeTask({
          taskId: "t1",
          title: "Prerequisite task",
          scheduledStartAt: d(11, 0),
          scheduledEndAt: d(12, 0),
        }),
        makeTask({
          taskId: "t2",
          title: "Dependent task",
          scheduledStartAt: d(9, 0),
          scheduledEndAt: d(10, 0),
          dependencies: ["t1"],
        }),
      ];

      const result = await analyzeConflictsSmart(tasks);

      const depConflict = result.conflicts.find(
        (c) => c.type === "dependency",
      );
      expect(depConflict).toBeDefined();
      expect(depConflict!.severity).toBe("high");
    });

    it("returns empty conflicts and suggestions when no conflicts exist", async () => {
      // Use tasks with estimatedMinutes >= 90 to avoid fragmentation detection
      const tasks: ScheduledTaskInfo[] = [
        makeTask({
          taskId: "t1",
          scheduledStartAt: d(9, 0),
          scheduledEndAt: d(10, 30),
          estimatedMinutes: 90,
        }),
        makeTask({
          taskId: "t2",
          scheduledStartAt: d(11, 0),
          scheduledEndAt: d(12, 30),
          estimatedMinutes: 90,
        }),
      ];

      const result = await analyzeConflictsSmart(tasks);

      expect(result.conflicts.length).toBe(0);
      expect(result.suggestions.length).toBe(0);
      expect(result.summary.totalConflicts).toBe(0);
    });

    it("produces correct summary counts", async () => {
      // Create an overlap (severity depends on overlap duration)
      const tasks: ScheduledTaskInfo[] = [
        makeTask({
          taskId: "t1",
          title: "Long task",
          priority: "High",
          scheduledStartAt: d(9, 0),
          scheduledEndAt: d(12, 0),
          estimatedMinutes: 180,
        }),
        makeTask({
          taskId: "t2",
          title: "Overlapping task",
          priority: "Low",
          scheduledStartAt: d(10, 0),
          scheduledEndAt: d(11, 0),
          estimatedMinutes: 60,
        }),
      ];

      const result = await analyzeConflictsSmart(tasks);

      expect(result.summary.totalConflicts).toBeGreaterThan(0);
      expect(result.summary.affectedTaskCount).toBeGreaterThan(0);
    });

    it("conflicts from smart analyzer match rule-based analyzer", async () => {
      const tasks: ScheduledTaskInfo[] = [
        makeTask({
          taskId: "t1",
          scheduledStartAt: d(9, 0),
          scheduledEndAt: d(10, 30),
          estimatedMinutes: 90,
        }),
        makeTask({
          taskId: "t2",
          scheduledStartAt: d(10, 0),
          scheduledEndAt: d(11, 0),
          estimatedMinutes: 60,
        }),
      ];

      const smartResult = await analyzeConflictsSmart(tasks);
      const ruleResult = analyzeConflicts(tasks);

      // Conflicts should be identical (both use rule-based detection)
      expect(smartResult.conflicts.length).toBe(ruleResult.conflicts.length);
      expect(smartResult.conflicts.map((c) => c.id)).toEqual(
        ruleResult.conflicts.map((c) => c.id),
      );
    });
  });

  // ─── Uses LLM for suggestions when available ─────────

  describe("uses LLM for suggestions when available", () => {
    it("returns LLM-generated suggestions for conflicts", async () => {
      // Two overlapping tasks
      const tasks: ScheduledTaskInfo[] = [
        makeTask({
          taskId: "t1",
          title: "Important meeting",
          priority: "High",
          scheduledStartAt: d(9, 0),
          scheduledEndAt: d(10, 0),
          estimatedMinutes: 60,
        }),
        makeTask({
          taskId: "t2",
          title: "Code review",
          priority: "Medium",
          scheduledStartAt: d(9, 30),
          scheduledEndAt: d(10, 30),
          estimatedMinutes: 60,
        }),
      ];

      const conflictId = "overlap_t1_t2";

      const llmResult = {
        suggestions: [
          {
            conflictId,
            type: "reschedule",
            description: "Move code review to after the meeting",
            reason: "Meeting has higher priority",
            changes: [
              {
                taskId: "t2",
                scheduledStartAt: "2026-04-15T10:00:00.000Z",
                scheduledEndAt: "2026-04-15T11:00:00.000Z",
              },
            ],
            estimatedImpact: {
              resolvedConflicts: 1,
              movedTasks: 1,
              timeShiftMinutes: 30,
            },
          },
        ],
      };

      aiChatMock.mockResolvedValue({ parsed: llmResult } as Awaited<ReturnType<typeof aiChat>>);

      const result = await analyzeConflictsSmart(tasks);

      // Conflicts should still be detected by rules
      expect(result.conflicts.length).toBeGreaterThan(0);

      // Suggestions should come from LLM
      expect(result.suggestions.length).toBe(1);
      expect(result.suggestions[0].type).toBe("reschedule");
      expect(result.suggestions[0].description).toContain("code review");
      expect(result.suggestions[0].conflictId).toBe(conflictId);
      expect(result.suggestions[0].id).toContain("sugg_llm_");
    });

    it("sends schedule context to LLM", async () => {
      const tasks: ScheduledTaskInfo[] = [
        makeTask({
          taskId: "t1",
          title: "Task Alpha",
          priority: "High",
          scheduledStartAt: d(9, 0),
          scheduledEndAt: d(10, 30),
          estimatedMinutes: 90,
        }),
        makeTask({
          taskId: "t2",
          title: "Task Beta",
          priority: "Low",
          scheduledStartAt: d(10, 0),
          scheduledEndAt: d(11, 0),
          estimatedMinutes: 60,
        }),
      ];

      const llmResult = {
        suggestions: [
          {
            conflictId: "overlap_t1_t2",
            type: "reschedule",
            description: "Move Task Beta",
            reason: "Lower priority",
            changes: [
              {
                taskId: "t2",
                scheduledStartAt: "2026-04-15T10:30:00.000Z",
                scheduledEndAt: "2026-04-15T11:30:00.000Z",
              },
            ],
            estimatedImpact: {
              resolvedConflicts: 1,
              movedTasks: 1,
              timeShiftMinutes: 30,
            },
          },
        ],
      };

      aiChatMock.mockResolvedValue({ parsed: llmResult } as Awaited<ReturnType<typeof aiChat>>);

      await analyzeConflictsSmart(tasks);

      expect(aiChatMock).toHaveBeenCalledOnce();
      const request = aiChatMock.mock.calls[0][0];
      expect(request.messages[0].role).toBe("system");
      expect(request.messages[1].role).toBe("user");

      const userContent = request.messages[1].content;
      expect(userContent).toContain("Task Alpha");
      expect(userContent).toContain("Task Beta");
      expect(userContent).toContain("overlap");
    });

    it("does not call LLM when there are no conflicts", async () => {
      // Use tasks with estimatedMinutes >= 90 to avoid fragmentation detection
      const tasks: ScheduledTaskInfo[] = [
        makeTask({
          taskId: "t1",
          scheduledStartAt: d(9, 0),
          scheduledEndAt: d(10, 30),
          estimatedMinutes: 90,
        }),
        makeTask({
          taskId: "t2",
          scheduledStartAt: d(11, 0),
          scheduledEndAt: d(12, 30),
          estimatedMinutes: 90,
        }),
      ];

      const result = await analyzeConflictsSmart(tasks);

      expect(aiChatMock).not.toHaveBeenCalled();
      expect(result.conflicts.length).toBe(0);
      expect(result.suggestions.length).toBe(0);
    });

    it("filters out LLM suggestions with invalid conflict IDs", async () => {
      const tasks: ScheduledTaskInfo[] = [
        makeTask({
          taskId: "t1",
          scheduledStartAt: d(9, 0),
          scheduledEndAt: d(10, 0),
          estimatedMinutes: 60,
        }),
        makeTask({
          taskId: "t2",
          scheduledStartAt: d(9, 30),
          scheduledEndAt: d(10, 30),
          estimatedMinutes: 60,
        }),
      ];

      const llmResult = {
        suggestions: [
          {
            conflictId: "nonexistent_conflict_id",
            type: "reschedule",
            description: "Invalid suggestion",
            reason: "Test",
            changes: [],
            estimatedImpact: {
              resolvedConflicts: 1,
              movedTasks: 0,
              timeShiftMinutes: 0,
            },
          },
        ],
      };

      aiChatMock.mockResolvedValue({ parsed: llmResult } as Awaited<ReturnType<typeof aiChat>>);

      const result = await analyzeConflictsSmart(tasks);

      // LLM suggestions should be filtered out (invalid conflictId)
      // Should fall back to rule-based suggestions
      expect(result.conflicts.length).toBeGreaterThan(0);
      // The suggestions should come from rule-based fallback since LLM suggestions
      // were all filtered out (0 valid)
      expect(result.suggestions.length).toBeGreaterThan(0);
      // Rule-based suggestions have IDs starting with "sugg_"
      expect(result.suggestions[0].id).toMatch(/^sugg_/);
      expect(result.suggestions[0].id).not.toContain("llm");
    });
  });

  // ─── Falls back to rule-based suggestions when LLM fails ─

  describe("falls back to rule-based suggestions when LLM fails", () => {
    it("falls back on network error", async () => {
      aiChatMock.mockRejectedValue(new Error("Network error"));

      const tasks: ScheduledTaskInfo[] = [
        makeTask({
          taskId: "t1",
          title: "High priority task",
          priority: "High",
          scheduledStartAt: d(9, 0),
          scheduledEndAt: d(10, 0),
        }),
        makeTask({
          taskId: "t2",
          title: "Low priority task",
          priority: "Low",
          scheduledStartAt: d(9, 30),
          scheduledEndAt: d(10, 30),
        }),
      ];

      const result = await analyzeConflictsSmart(tasks);
      const ruleResult = analyzeConflicts(tasks);

      // Conflicts should still be detected
      expect(result.conflicts.length).toBeGreaterThan(0);

      // Suggestions should match rule-based
      expect(result.suggestions.length).toBe(ruleResult.suggestions.length);
      expect(result.suggestions[0].type).toBe(ruleResult.suggestions[0].type);
    });

    it("falls back on HTTP 500 error", async () => {
      aiChatMock.mockRejectedValue(new Error("HTTP 500"));

      const tasks: ScheduledTaskInfo[] = [
        makeTask({
          taskId: "t1",
          scheduledStartAt: d(9, 0),
          scheduledEndAt: d(10, 0),
        }),
        makeTask({
          taskId: "t2",
          scheduledStartAt: d(9, 30),
          scheduledEndAt: d(10, 30),
        }),
      ];

      const result = await analyzeConflictsSmart(tasks);

      expect(result.conflicts.length).toBeGreaterThan(0);
      expect(result.suggestions.length).toBeGreaterThan(0);
      // Rule-based suggestion
      expect(result.suggestions[0].id).toMatch(/^sugg_/);
    });

    it("falls back on malformed JSON from LLM", async () => {
      aiChatMock.mockResolvedValue({ parsed: "This is not JSON at all {{{" } as Awaited<ReturnType<typeof aiChat>>);

      const tasks: ScheduledTaskInfo[] = [
        makeTask({
          taskId: "t1",
          scheduledStartAt: d(9, 0),
          scheduledEndAt: d(10, 0),
        }),
        makeTask({
          taskId: "t2",
          scheduledStartAt: d(9, 30),
          scheduledEndAt: d(10, 30),
        }),
      ];

      const result = await analyzeConflictsSmart(tasks);

      // Should still have conflicts and rule-based suggestions
      expect(result.conflicts.length).toBeGreaterThan(0);
      expect(result.suggestions.length).toBeGreaterThan(0);
    });

    it("falls back when LLM returns empty suggestions array", async () => {
      const llmResult = { suggestions: [] };

      aiChatMock.mockResolvedValue({ parsed: llmResult } as Awaited<ReturnType<typeof aiChat>>);

      const tasks: ScheduledTaskInfo[] = [
        makeTask({
          taskId: "t1",
          scheduledStartAt: d(9, 0),
          scheduledEndAt: d(10, 0),
        }),
        makeTask({
          taskId: "t2",
          scheduledStartAt: d(9, 30),
          scheduledEndAt: d(10, 30),
        }),
      ];

      const result = await analyzeConflictsSmart(tasks);

      // Should fall back to rule-based suggestions
      expect(result.conflicts.length).toBeGreaterThan(0);
      expect(result.suggestions.length).toBeGreaterThan(0);
      expect(result.suggestions[0].id).not.toContain("llm");
    });

    it("falls back when LLM returns null", async () => {
      aiChatMock.mockResolvedValue(null);

      const tasks: ScheduledTaskInfo[] = [
        makeTask({
          taskId: "t1",
          scheduledStartAt: d(9, 0),
          scheduledEndAt: d(10, 0),
        }),
        makeTask({
          taskId: "t2",
          scheduledStartAt: d(9, 30),
          scheduledEndAt: d(10, 30),
        }),
      ];

      const result = await analyzeConflictsSmart(tasks);

      expect(result.conflicts.length).toBeGreaterThan(0);
      expect(result.suggestions.length).toBeGreaterThan(0);
    });
  });

  // ─── Summary always correct ───────────────────────────

  describe("summary is always correct", () => {
    it("summary reflects conflict counts accurately", async () => {
      // Create multiple types of conflicts
      const tasks: ScheduledTaskInfo[] = [
        makeTask({
          taskId: "t1",
          title: "Task 1",
          priority: "High",
          scheduledStartAt: d(9, 0),
          scheduledEndAt: d(11, 0),
          estimatedMinutes: 120,
        }),
        makeTask({
          taskId: "t2",
          title: "Task 2",
          priority: "Medium",
          scheduledStartAt: d(10, 0),
          scheduledEndAt: d(12, 0),
          estimatedMinutes: 120,
        }),
      ];

      const result = await analyzeConflictsSmart(tasks);

      expect(result.summary.totalConflicts).toBe(result.conflicts.length);
      expect(
        result.summary.highSeverityCount +
          result.summary.mediumSeverityCount +
          result.summary.lowSeverityCount,
      ).toBe(result.summary.totalConflicts);
    });

    it("affectedTaskCount is correct", async () => {
      // t1 and t2 overlap; t3 is on a different day and non-fragmented (>= 90 min)
      const tasks: ScheduledTaskInfo[] = [
        makeTask({
          taskId: "t1",
          scheduledStartAt: d(9, 0),
          scheduledEndAt: d(10, 0),
        }),
        makeTask({
          taskId: "t2",
          scheduledStartAt: d(9, 30),
          scheduledEndAt: d(10, 30),
        }),
        makeTask({
          taskId: "t3",
          scheduledStartAt: new Date("2026-04-16T14:00:00.000Z"),
          scheduledEndAt: new Date("2026-04-16T15:30:00.000Z"),
          estimatedMinutes: 90,
        }),
      ];

      const result = await analyzeConflictsSmart(tasks);

      // t1 and t2 overlap (and may also be fragmented), t3 should not be affected
      // Collect all affected task IDs
      const affectedIds = new Set<string>();
      for (const c of result.conflicts) {
        for (const id of c.taskIds) affectedIds.add(id);
      }
      expect(affectedIds.has("t1")).toBe(true);
      expect(affectedIds.has("t2")).toBe(true);
      expect(result.summary.affectedTaskCount).toBe(affectedIds.size);
    });
  });
});
