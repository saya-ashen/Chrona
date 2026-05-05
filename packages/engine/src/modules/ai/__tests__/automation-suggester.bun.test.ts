import { describe, expect, test } from "bun:test";
import { suggestAutomation } from "../automation-suggester";
import type { TaskAutomationInput } from "@chrona/contracts/ai";

/**
 * Helper to create a full TaskAutomationInput with defaults
 */
function makeInput(overrides: Partial<TaskAutomationInput> = {}): TaskAutomationInput {
  return {
    taskId: "task-default",
    title: "Default Task",
    description: "",
    priority: "Medium",
    dueAt: null,
    scheduledStartAt: null,
    scheduledEndAt: null,
    isRunnable: false,
    runnabilityState: "",
    ownerType: "individual",
    ...overrides,
  };
}

describe("automation-suggester", () => {
  describe("suggestAutomation - execution mode", () => {
    test("high priority runnable task -> executionMode 'immediate', advanceMinutes 15", () => {
      const input = makeInput({
        taskId: "task-1",
        title: "Fix critical production bug",
        description: "Server is returning 500 errors on the main endpoint",
        priority: "High",
        isRunnable: true,
      });

      const result = suggestAutomation(input);

      expect(result.executionMode).toBe("immediate");
      expect(result.reminderStrategy.advanceMinutes).toBe(15);
      expect(result.reminderStrategy.frequency).toBe("once");
      expect(result.reminderStrategy.channels).toContain("push");
      expect(result.reminderStrategy.channels).toContain("email");
    });

    test("urgent priority runnable task -> executionMode 'immediate'", () => {
      const input = makeInput({
        taskId: "task-urgent",
        title: "Hotfix deployment",
        priority: "Urgent",
        isRunnable: true,
      });

      const result = suggestAutomation(input);

      expect(result.executionMode).toBe("immediate");
      expect(result.reminderStrategy.advanceMinutes).toBe(15);
    });

    test("medium priority scheduled task -> executionMode 'scheduled', advanceMinutes 30", () => {
      const input = makeInput({
        taskId: "task-2",
        title: "Code review for feature branch",
        description: "Review PR #123 before release",
        priority: "Medium",
        scheduledStartAt: new Date("2026-04-16T10:00:00Z"),
        scheduledEndAt: new Date("2026-04-16T11:00:00Z"),
      });

      const result = suggestAutomation(input);

      expect(result.executionMode).toBe("scheduled");
      expect(result.reminderStrategy.advanceMinutes).toBe(30);
      expect(result.reminderStrategy.channels).toContain("push");
    });

    test("low priority unscheduled task -> executionMode 'manual', advanceMinutes 60", () => {
      const input = makeInput({
        taskId: "task-3",
        title: "Update README documentation",
        priority: "Low",
      });

      const result = suggestAutomation(input);

      expect(result.executionMode).toBe("manual");
      expect(result.reminderStrategy.advanceMinutes).toBe(60);
      expect(result.reminderStrategy.channels).toContain("push");
    });

    test("high priority non-runnable task without schedule -> executionMode 'manual'", () => {
      const input = makeInput({
        taskId: "task-blocked",
        title: "Deploy new feature",
        priority: "High",
        isRunnable: false,
      });

      const result = suggestAutomation(input);

      expect(result.executionMode).toBe("manual");
    });

    test("high priority non-runnable task with schedule -> executionMode 'scheduled'", () => {
      const input = makeInput({
        taskId: "task-scheduled-high",
        title: "Release deployment",
        priority: "High",
        isRunnable: false,
        scheduledStartAt: new Date("2026-04-16T14:00:00Z"),
        scheduledEndAt: new Date("2026-04-16T15:00:00Z"),
      });

      const result = suggestAutomation(input);

      expect(result.executionMode).toBe("scheduled");
    });

    test("medium priority without schedule and not runnable -> executionMode 'manual'", () => {
      const input = makeInput({
        taskId: "task-mid-manual",
        title: "Research alternatives",
        priority: "Medium",
        isRunnable: false,
      });

      const result = suggestAutomation(input);

      expect(result.executionMode).toBe("manual");
    });
  });

  describe("suggestAutomation - recurring task detection", () => {
    test("title containing 'weekly' -> executionMode 'recurring'", () => {
      const input = makeInput({
        taskId: "task-weekly",
        title: "Weekly team meeting",
        priority: "Medium",
        scheduledStartAt: new Date("2026-04-16T09:00:00Z"),
      });

      const result = suggestAutomation(input);

      expect(result.executionMode).toBe("recurring");
      expect(result.reminderStrategy.frequency).toBe("recurring");
      expect(result.reminderStrategy.channels).toContain("calendar");
    });

    test("title containing 'daily' -> executionMode 'recurring'", () => {
      const input = makeInput({
        taskId: "task-daily",
        title: "Daily progress report",
        priority: "Medium",
      });

      const result = suggestAutomation(input);

      expect(result.executionMode).toBe("recurring");
    });

    test("title containing 'monthly' -> executionMode 'recurring'", () => {
      const input = makeInput({
        taskId: "task-monthly",
        title: "Monthly budget review",
        priority: "High",
        isRunnable: true,
      });

      const result = suggestAutomation(input);

      // Recurring detection takes precedence over immediate
      expect(result.executionMode).toBe("recurring");
    });

    test("description containing 'every week' -> executionMode 'recurring'", () => {
      const input = makeInput({
        taskId: "task-recurring-desc",
        title: "Team planning",
        description: "This meeting happens every week on Tuesday",
        priority: "Medium",
      });

      const result = suggestAutomation(input);

      expect(result.executionMode).toBe("recurring");
    });

    test("title containing 'standup' -> executionMode 'recurring'", () => {
      const input = makeInput({
        taskId: "task-standup",
        title: "Morning standup",
        priority: "Medium",
      });

      const result = suggestAutomation(input);

      expect(result.executionMode).toBe("recurring");
    });

    test("title containing 'retrospective' -> executionMode 'recurring'", () => {
      const input = makeInput({
        taskId: "task-retro",
        title: "Sprint retrospective",
        priority: "Medium",
      });

      const result = suggestAutomation(input);

      expect(result.executionMode).toBe("recurring");
    });

    test("title containing 'sync' -> executionMode 'recurring'", () => {
      const input = makeInput({
        taskId: "task-sync",
        title: "Engineering sync",
        priority: "Medium",
      });

      const result = suggestAutomation(input);

      expect(result.executionMode).toBe("recurring");
    });

    test("description containing 'routine' -> executionMode 'recurring'", () => {
      const input = makeInput({
        taskId: "task-routine",
        title: "System health check",
        description: "This is a routine maintenance task",
        priority: "Low",
      });

      const result = suggestAutomation(input);

      expect(result.executionMode).toBe("recurring");
    });

    test("non-recurring task title does not trigger recurring mode", () => {
      const input = makeInput({
        taskId: "task-normal",
        title: "Fix login page CSS",
        priority: "Medium",
        scheduledStartAt: new Date("2026-04-16T10:00:00Z"),
      });

      const result = suggestAutomation(input);

      expect(result.executionMode).not.toBe("recurring");
      expect(result.executionMode).toBe("scheduled");
    });

    test("recurring takes precedence over high-priority runnable", () => {
      const input = makeInput({
        taskId: "task-rec-high",
        title: "Daily security check",
        priority: "High",
        isRunnable: true,
      });

      const result = suggestAutomation(input);

      expect(result.executionMode).toBe("recurring");
    });
  });

  describe("suggestAutomation - confidence calculation", () => {
    test("task with full details -> high confidence", () => {
      const input = makeInput({
        taskId: "task-full",
        title: "Implement user authentication",
        description: "Add OAuth2 login flow with Google and GitHub providers.",
        priority: "High",
        scheduledStartAt: new Date("2026-04-16T09:00:00Z"),
        scheduledEndAt: new Date("2026-04-16T13:00:00Z"),
        dueAt: new Date("2026-04-17T17:00:00Z"),
        isRunnable: true,
        runnabilityState: "ready",
        tags: ["backend", "auth"],
      });

      const result = suggestAutomation(input);

      // With isRunnable, scheduledStartAt, description, dueAt, scheduledEndAt, tags = 6 -> "high"
      expect(result.confidence).toBe("high");
    });

    test("task with minimal details -> low confidence", () => {
      const input = makeInput({
        taskId: "task-minimal",
        title: "Something to do",
        priority: "Low",
        description: "",
        isRunnable: false,
        scheduledStartAt: null,
        scheduledEndAt: null,
        dueAt: null,
      });

      const result = suggestAutomation(input);

      // No optional info provided -> score 0 -> "low"
      expect(result.confidence).toBe("low");
    });

    test("task with moderate details -> medium confidence", () => {
      const input = makeInput({
        taskId: "task-moderate",
        title: "Review pull request",
        description: "Review PR #456 for the API refactor",
        priority: "Medium",
        isRunnable: true,
        scheduledStartAt: null,
      });

      const result = suggestAutomation(input);

      // isRunnable(1) + description(1) = 2 -> "medium"
      expect(result.confidence).toBe("medium");
    });

    test("exactly 4 info points -> high confidence", () => {
      const input = makeInput({
        taskId: "task-4points",
        title: "Important task",
        description: "Some description",
        priority: "High",
        isRunnable: true,
        scheduledStartAt: new Date("2026-04-16T10:00:00Z"),
        dueAt: new Date("2026-04-17T17:00:00Z"),
      });

      const result = suggestAutomation(input);

      // isRunnable(1) + scheduledStartAt(1) + description(1) + dueAt(1) = 4 -> "high"
      expect(result.confidence).toBe("high");
    });

    test("exactly 2 info points -> medium confidence", () => {
      const input = makeInput({
        taskId: "task-2points",
        title: "Task with two info",
        description: "Has a description",
        priority: "Medium",
        isRunnable: true,
      });

      const result = suggestAutomation(input);

      // isRunnable(1) + description(1) = 2 -> "medium"
      expect(result.confidence).toBe("medium");
    });

    test("1 info point -> low confidence", () => {
      const input = makeInput({
        taskId: "task-1point",
        title: "Task with one info",
        description: "Has only description",
        priority: "Low",
      });

      const result = suggestAutomation(input);

      // description(1) = 1 -> "low"
      expect(result.confidence).toBe("low");
    });
  });

  describe("suggestAutomation - preparation steps", () => {
    test("task with description includes review step", () => {
      const input = makeInput({
        taskId: "task-desc",
        title: "Plan the sprint",
        description: "Plan the next sprint based on backlog priorities",
        priority: "Medium",
      });

      const result = suggestAutomation(input);

      expect(result.preparationSteps).toContain("Review task description");
    });

    test("task without description does not include review description step", () => {
      const input = makeInput({
        taskId: "task-no-desc",
        title: "Quick thing",
        description: "",
        priority: "Low",
      });

      const result = suggestAutomation(input);

      expect(result.preparationSteps).not.toContain("Review task description");
    });

    test("runnable task includes runtime configuration step", () => {
      const input = makeInput({
        taskId: "task-runnable",
        title: "Deploy service",
        priority: "High",
        isRunnable: true,
      });

      const result = suggestAutomation(input);

      expect(result.preparationSteps).toContain("Check runtime configuration");
      expect(result.preparationSteps).toContain("Ensure dependencies are met");
    });

    test("runnable task with runnabilityState includes verification step", () => {
      const input = makeInput({
        taskId: "task-runstate",
        title: "Execute pipeline",
        priority: "High",
        isRunnable: true,
        runnabilityState: "ready",
      });

      const result = suggestAutomation(input);

      expect(result.preparationSteps.some((s) => s.includes("Verify runnability state"))).toBe(true);
      expect(result.preparationSteps.some((s) => s.includes("ready"))).toBe(true);
    });

    test("task with scheduled time window includes availability check", () => {
      const input = makeInput({
        taskId: "task-window",
        title: "Team meeting",
        priority: "Medium",
        scheduledStartAt: new Date("2026-04-16T10:00:00Z"),
        scheduledEndAt: new Date("2026-04-16T11:00:00Z"),
      });

      const result = suggestAutomation(input);

      expect(result.preparationSteps).toContain(
        "Verify availability for the scheduled time window",
      );
    });

    test("task with due date includes deadline review step", () => {
      const input = makeInput({
        taskId: "task-due",
        title: "Submit report",
        priority: "Medium",
        dueAt: new Date("2026-04-17T17:00:00Z"),
      });

      const result = suggestAutomation(input);

      expect(result.preparationSteps).toContain(
        "Review deadline and plan accordingly",
      );
    });

    test("high priority task includes blocker clearing step", () => {
      const input = makeInput({
        taskId: "task-high-prep",
        title: "Release v2.0",
        priority: "High",
      });

      const result = suggestAutomation(input);

      expect(result.preparationSteps).toContain(
        "Prioritize and clear blockers before execution",
      );
    });

    test("urgent priority task includes blocker clearing step", () => {
      const input = makeInput({
        taskId: "task-urgent-prep",
        title: "Emergency fix",
        priority: "Urgent",
      });

      const result = suggestAutomation(input);

      expect(result.preparationSteps).toContain(
        "Prioritize and clear blockers before execution",
      );
    });

    test("task with tags includes tag context review step", () => {
      const input = makeInput({
        taskId: "task-tags",
        title: "Update API docs",
        priority: "Low",
        tags: ["documentation", "api"],
      });

      const result = suggestAutomation(input);

      expect(
        result.preparationSteps.some((s) => s.includes("Review related context for tags")),
      ).toBe(true);
      expect(
        result.preparationSteps.some((s) => s.includes("documentation")),
      ).toBe(true);
    });

    test("team-owned task includes coordination step", () => {
      const input = makeInput({
        taskId: "task-team",
        title: "Team project update",
        priority: "Medium",
        ownerType: "team",
      });

      const result = suggestAutomation(input);

      expect(result.preparationSteps).toContain(
        "Coordinate with team members before starting",
      );
    });

    test("minimal task gets at least one generic preparation step", () => {
      const input = makeInput({
        taskId: "task-bare",
        title: "Quick thing",
        description: "",
        priority: "Low",
        isRunnable: false,
      });

      const result = suggestAutomation(input);

      expect(result.preparationSteps.length).toBeGreaterThanOrEqual(1);
      expect(result.preparationSteps).toContain(
        "Review task details before starting",
      );
    });

    test("task with many properties generates multiple preparation steps", () => {
      const input = makeInput({
        taskId: "task-full-steps",
        title: "Complex deployment task",
        description: "Deploy and validate the new version",
        priority: "High",
        isRunnable: true,
        runnabilityState: "ready",
        scheduledStartAt: new Date("2026-04-16T10:00:00Z"),
        scheduledEndAt: new Date("2026-04-16T12:00:00Z"),
        dueAt: new Date("2026-04-17T17:00:00Z"),
        tags: ["deploy", "prod"],
        ownerType: "team",
      });

      const result = suggestAutomation(input);

      // Should have: description review, runtime config, ensure deps, runnability state,
      // scheduled window, deadline review, priority blockers, tag context, team coordination
      expect(result.preparationSteps.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe("suggestAutomation - reminder strategy", () => {
    test("immediate mode uses push+email channels with 15 min advance", () => {
      const input = makeInput({
        taskId: "task-imm",
        title: "Urgent fix",
        priority: "High",
        isRunnable: true,
      });

      const result = suggestAutomation(input);

      expect(result.reminderStrategy.advanceMinutes).toBe(15);
      expect(result.reminderStrategy.frequency).toBe("once");
      expect(result.reminderStrategy.channels).toContain("push");
      expect(result.reminderStrategy.channels).toContain("email");
    });

    test("scheduled mode uses push channel with 30 min advance", () => {
      const input = makeInput({
        taskId: "task-sched",
        title: "Planned review",
        priority: "Medium",
        scheduledStartAt: new Date("2026-04-16T10:00:00Z"),
      });

      const result = suggestAutomation(input);

      expect(result.reminderStrategy.advanceMinutes).toBe(30);
      expect(result.reminderStrategy.frequency).toBe("once");
      expect(result.reminderStrategy.channels).toContain("push");
    });

    test("recurring mode uses recurring frequency with calendar", () => {
      const input = makeInput({
        taskId: "task-rec",
        title: "Daily standup",
        priority: "Medium",
      });

      const result = suggestAutomation(input);

      expect(result.executionMode).toBe("recurring");
      expect(result.reminderStrategy.frequency).toBe("recurring");
      expect(result.reminderStrategy.advanceMinutes).toBe(30);
      expect(result.reminderStrategy.channels).toContain("push");
      expect(result.reminderStrategy.channels).toContain("calendar");
    });

    test("manual mode uses push channel with 60 min advance", () => {
      const input = makeInput({
        taskId: "task-man",
        title: "Clean up old branches",
        priority: "Low",
      });

      const result = suggestAutomation(input);

      expect(result.executionMode).toBe("manual");
      expect(result.reminderStrategy.advanceMinutes).toBe(60);
      expect(result.reminderStrategy.frequency).toBe("once");
      expect(result.reminderStrategy.channels).toContain("push");
    });
  });

  describe("suggestAutomation - context sources", () => {
    test("task with description includes task_description source", () => {
      const input = makeInput({
        taskId: "task-ctx-desc",
        title: "Plan sprint",
        description: "Plan the next sprint based on priorities",
      });

      const result = suggestAutomation(input);

      expect(result.contextSources.some((s) => s.type === "task_description")).toBe(true);
    });

    test("runnable task includes runtime_config source", () => {
      const input = makeInput({
        taskId: "task-ctx-run",
        title: "Execute job",
        isRunnable: true,
      });

      const result = suggestAutomation(input);

      expect(result.contextSources.some((s) => s.type === "runtime_config")).toBe(true);
    });

    test("task with tags includes tag_context source", () => {
      const input = makeInput({
        taskId: "task-ctx-tags",
        title: "Update docs",
        tags: ["documentation"],
      });

      const result = suggestAutomation(input);

      expect(result.contextSources.some((s) => s.type === "tag_context")).toBe(true);
    });

    test("scheduled task includes schedule source", () => {
      const input = makeInput({
        taskId: "task-ctx-sched",
        title: "Planned meeting",
        scheduledStartAt: new Date("2026-04-16T10:00:00Z"),
      });

      const result = suggestAutomation(input);

      expect(result.contextSources.some((s) => s.type === "schedule")).toBe(true);
    });

    test("task with due date includes deadline source", () => {
      const input = makeInput({
        taskId: "task-ctx-due",
        title: "Submit report",
        dueAt: new Date("2026-04-17T17:00:00Z"),
      });

      const result = suggestAutomation(input);

      expect(result.contextSources.some((s) => s.type === "deadline")).toBe(true);
    });

    test("task with ownerType includes ownership source", () => {
      const input = makeInput({
        taskId: "task-ctx-owner",
        title: "Team task",
        ownerType: "team",
      });

      const result = suggestAutomation(input);

      expect(result.contextSources.some((s) => s.type === "ownership")).toBe(true);
    });

    test("minimal task has no context sources", () => {
      const input = makeInput({
        taskId: "task-ctx-min",
        title: "Bare task",
        description: "",
        isRunnable: false,
        scheduledStartAt: null,
        dueAt: null,
        ownerType: "",
      });

      const result = suggestAutomation(input);

      expect(result.contextSources).toHaveLength(0);
    });
  });

  describe("suggestAutomation - output structure", () => {
    test("returns all required fields", () => {
      const input = makeInput({
        taskId: "task-struct",
        title: "Test task",
        priority: "Medium",
      });

      const result = suggestAutomation(input);

      expect(result).toHaveProperty("executionMode");
      expect(result).toHaveProperty("confidence");
      expect(result).toHaveProperty("reminderStrategy");
      expect(result).toHaveProperty("preparationSteps");
      expect(result).toHaveProperty("contextSources");

      // Nested structure checks
      expect(result.reminderStrategy).toHaveProperty("advanceMinutes");
      expect(result.reminderStrategy).toHaveProperty("frequency");
      expect(result.reminderStrategy).toHaveProperty("channels");

      expect(Array.isArray(result.preparationSteps)).toBe(true);
      expect(Array.isArray(result.contextSources)).toBe(true);
      expect(Array.isArray(result.reminderStrategy.channels)).toBe(true);
    });

    test("executionMode is a valid mode", () => {
      const validModes = ["immediate", "scheduled", "recurring", "manual"];

      const inputs = [
        makeInput({ title: "Task 1", priority: "High", isRunnable: true }),
        makeInput({ title: "Task 2", priority: "Medium", scheduledStartAt: new Date() }),
        makeInput({ title: "Weekly task", priority: "Medium" }),
        makeInput({ title: "Task 4", priority: "Low" }),
      ];

      for (const input of inputs) {
        const result = suggestAutomation(input);
        expect(validModes).toContain(result.executionMode);
      }
    });

    test("confidence is a valid level", () => {
      const validLevels = ["low", "medium", "high"];

      const inputs = [
        makeInput({ title: "Minimal", priority: "Low" }),
        makeInput({ title: "Moderate", description: "desc", isRunnable: true }),
        makeInput({
          title: "Full",
          description: "desc",
          isRunnable: true,
          scheduledStartAt: new Date(),
          scheduledEndAt: new Date(),
          dueAt: new Date(),
          tags: ["tag"],
        }),
      ];

      for (const input of inputs) {
        const result = suggestAutomation(input);
        expect(validLevels).toContain(result.confidence);
      }
    });

    test("frequency is a valid value", () => {
      const validFrequencies = ["once", "recurring"];

      const inputs = [
        makeInput({ title: "Normal task", priority: "Medium" }),
        makeInput({ title: "Daily standup", priority: "Medium" }),
      ];

      for (const input of inputs) {
        const result = suggestAutomation(input);
        expect(validFrequencies).toContain(result.reminderStrategy.frequency);
      }
    });
  });
});
