import { describe, it, expect } from "vitest";
import { decomposeTask, decomposeTaskSmart } from "../task-decomposer";
import { suggestAutomation, suggestAutomationSmart } from "../automation-suggester";
import { analyzeConflicts, analyzeConflictsSmart } from "../conflict-analyzer";
import { suggestTimeslots } from "../timeslot-suggester";
import type {
  TaskDecompositionInput,
  TaskAutomationInput,
  ScheduledTaskInfo,
  TimeslotSuggestionInput,
} from "../types";

/**
 * Integration tests for the complete AI module pipeline.
 * These test the full flow from input to output for each AI feature,
 * verifying the output shape is correct and the logic produces sensible results.
 * 
 * All tests run without LLM (no AI_PROVIDER configured), so they exercise
 * the rule-based fallback path which should always work.
 */

describe("AI Integration: Task Decomposition Pipeline", () => {
  it("decomposes a multi-verb task into meaningful subtasks", async () => {
    const input: TaskDecompositionInput = {
      title: "Review and update the authentication module",
      description: "Check for security vulnerabilities and update dependencies",
      priority: "High",
      estimatedMinutes: 120,
    };

    const result = await decomposeTaskSmart(input);
    
    expect(result.subtasks.length).toBeGreaterThanOrEqual(2);
    expect(result.totalEstimatedMinutes).toBe(120);
    expect(result.feasibilityScore).toBeGreaterThan(0);
    expect(result.subtasks[0]).toHaveProperty("title");
    expect(result.subtasks[0]).toHaveProperty("estimatedMinutes");
    expect(result.subtasks[0]).toHaveProperty("priority");
    expect(result.subtasks[0]).toHaveProperty("order");
  });

  it("decomposes a task with Chinese conjunctions", async () => {
    const input: TaskDecompositionInput = {
      title: "整理文档然后更新测试用例",
      priority: "Medium",
    };

    const result = await decomposeTaskSmart(input);
    expect(result.subtasks.length).toBeGreaterThanOrEqual(2);
  });

  it("handles tasks that cannot be decomposed", async () => {
    const input: TaskDecompositionInput = {
      title: "Fix the bug",
      priority: "High",
    };

    const result = await decomposeTaskSmart(input);
    expect(result.subtasks.length).toBe(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("decomposes a task with bullet-point description", async () => {
    const input: TaskDecompositionInput = {
      title: "Setup project infrastructure",
      description: `- Configure CI/CD pipeline
- Set up monitoring
- Create deployment scripts
- Write documentation`,
      priority: "High",
      estimatedMinutes: 240,
    };

    const result = await decomposeTaskSmart(input);
    expect(result.subtasks.length).toBe(4);
    expect(result.totalEstimatedMinutes).toBe(240);
  });

  it("decomposes a long task by duration", async () => {
    const input: TaskDecompositionInput = {
      title: "Database migration project",
      priority: "High",
      estimatedMinutes: 480,
    };

    const result = await decomposeTaskSmart(input);
    expect(result.subtasks.length).toBeGreaterThanOrEqual(2);
  });

  it("rule-based and smart produce identical output when no LLM", async () => {
    const input: TaskDecompositionInput = {
      title: "Design and implement the new feature",
      priority: "Medium",
      estimatedMinutes: 90,
    };

    const ruleResult = decomposeTask(input);
    const smartResult = await decomposeTaskSmart(input);

    expect(smartResult.subtasks.length).toBe(ruleResult.subtasks.length);
    expect(smartResult.totalEstimatedMinutes).toBe(ruleResult.totalEstimatedMinutes);
  });
});

describe("AI Integration: Automation Suggestion Pipeline", () => {
  const baseTask: TaskAutomationInput = {
    taskId: "test-task-1",
    title: "Weekly team standup",
    description: "Regular weekly sync with the team",
    priority: "Medium",
    dueAt: null,
    scheduledStartAt: null,
    scheduledEndAt: null,
    isRunnable: false,
    runnabilityState: "not_runnable",
    ownerType: "human",
  };

  const nonRecurringBase: TaskAutomationInput = {
    ...baseTask,
    title: "One-off task",
    description: "A single task to complete",
  };

  it("detects recurring tasks from title keywords", async () => {
    const result = await suggestAutomationSmart(baseTask);
    expect(result.executionMode).toBe("recurring");
    expect(result.reminderStrategy.frequency).toBe("recurring");
    expect(result.confidence).toBeDefined();
  });

  it("suggests immediate execution for high-priority runnable tasks", async () => {
    const task: TaskAutomationInput = {
      ...nonRecurringBase,
      title: "Deploy hotfix to production",
      description: "Critical fix needed now",
      priority: "Urgent",
      isRunnable: true,
      runnabilityState: "runnable",
    };

    const result = await suggestAutomationSmart(task);
    expect(result.executionMode).toBe("immediate");
    expect(result.reminderStrategy.advanceMinutes).toBeLessThanOrEqual(15);
  });

  it("suggests scheduled execution for tasks with a schedule", async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);

    const task: TaskAutomationInput = {
      ...nonRecurringBase,
      title: "Prepare presentation slides",
      description: "Create slides for the meeting",
      scheduledStartAt: tomorrow,
      scheduledEndAt: new Date(tomorrow.getTime() + 60 * 60 * 1000),
    };

    const result = await suggestAutomationSmart(task);
    expect(result.executionMode).toBe("scheduled");
  });

  it("includes context sources and preparation steps", async () => {
    const task: TaskAutomationInput = {
      ...nonRecurringBase,
      title: "Review PR #42",
      description: "Code review for the new feature implementation",
      isRunnable: true,
      runnabilityState: "runnable",
    };

    const result = await suggestAutomationSmart(task);
    expect(result.preparationSteps.length).toBeGreaterThan(0);
    expect(result.contextSources.length).toBeGreaterThan(0);
    expect(result.confidence).toBeDefined();
  });

  it("rule-based and smart produce identical output when no LLM", async () => {
    const ruleResult = suggestAutomation(baseTask);
    const smartResult = await suggestAutomationSmart(baseTask);

    expect(smartResult.executionMode).toBe(ruleResult.executionMode);
    expect(smartResult.reminderStrategy).toEqual(ruleResult.reminderStrategy);
  });
});

describe("AI Integration: Conflict Analysis Pipeline", () => {
  const baseDate = new Date("2026-04-16T09:00:00Z");

  function createTask(id: string, startHour: number, endHour: number, priority = "Medium"): ScheduledTaskInfo {
    const start = new Date(baseDate);
    start.setUTCHours(startHour, 0, 0, 0);
    const end = new Date(baseDate);
    end.setUTCHours(endHour, 0, 0, 0);

    return {
      taskId: id,
      title: `Task ${id}`,
      priority,
      scheduledStartAt: start,
      scheduledEndAt: end,
      dueAt: null,
      estimatedMinutes: (endHour - startHour) * 60,
      dependencies: [],
    };
  }

  it("detects time overlap conflicts", async () => {
    const tasks = [
      createTask("A", 9, 11),  // 09:00 - 11:00
      createTask("B", 10, 12), // 10:00 - 12:00 (overlaps with A)
    ];

    const result = await analyzeConflictsSmart(tasks);
    expect(result.conflicts.length).toBeGreaterThanOrEqual(1);
    expect(result.conflicts.some((c) => c.type === "time_overlap")).toBe(true);
    expect(result.summary.totalConflicts).toBeGreaterThanOrEqual(1);
    expect(result.summary.affectedTaskCount).toBeGreaterThanOrEqual(2);
  });

  it("generates resolution suggestions for conflicts", async () => {
    const tasks = [
      createTask("A", 9, 11, "High"),
      createTask("B", 10, 12, "Low"),
    ];

    const result = await analyzeConflictsSmart(tasks);
    expect(result.suggestions.length).toBeGreaterThanOrEqual(1);
    expect(result.suggestions[0].changes.length).toBeGreaterThan(0);
  });

  it("returns no conflicts for non-overlapping schedule", async () => {
    const tasks = [
      createTask("A", 9, 10),  // 09:00 - 10:00
      createTask("B", 11, 12), // 11:00 - 12:00
    ];

    const result = await analyzeConflictsSmart(tasks);
    const overlaps = result.conflicts.filter((c) => c.type === "time_overlap");
    expect(overlaps.length).toBe(0);
  });

  it("detects overload when daily scheduled time exceeds 8 hours", async () => {
    const tasks = [
      createTask("A", 6, 10),
      createTask("B", 10, 14),
      createTask("C", 14, 18),
      createTask("D", 18, 22),
    ];

    const result = await analyzeConflictsSmart(tasks);
    const overloads = result.conflicts.filter((c) => c.type === "overload");
    expect(overloads.length).toBeGreaterThanOrEqual(1);
  });

  it("rule-based and smart produce same conflicts when no LLM", async () => {
    const tasks = [
      createTask("A", 9, 11, "High"),
      createTask("B", 10, 12, "Low"),
    ];

    const ruleResult = analyzeConflicts(tasks);
    const smartResult = await analyzeConflictsSmart(tasks);

    expect(smartResult.conflicts.length).toBe(ruleResult.conflicts.length);
    expect(smartResult.summary.totalConflicts).toBe(ruleResult.summary.totalConflicts);
  });
});

describe("AI Integration: Timeslot Suggestion Pipeline", () => {
  it("suggests timeslots avoiding existing schedule", () => {
    const baseDate = new Date("2026-04-16T00:00:00Z");
    
    const input: TimeslotSuggestionInput = {
      taskId: "task-1",
      title: "New meeting",
      priority: "Medium",
      estimatedMinutes: 60,
      currentSchedule: [
        {
          taskId: "existing-1",
          title: "Morning standup",
          startAt: new Date(baseDate.getTime() + 9 * 60 * 60 * 1000),
          endAt: new Date(baseDate.getTime() + 10 * 60 * 60 * 1000),
        },
        {
          taskId: "existing-2",
          title: "Lunch review",
          startAt: new Date(baseDate.getTime() + 12 * 60 * 60 * 1000),
          endAt: new Date(baseDate.getTime() + 13 * 60 * 60 * 1000),
        },
      ],
    };

    const result = suggestTimeslots(input);
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.suggestions[0]).toHaveProperty("startAt");
    expect(result.suggestions[0]).toHaveProperty("endAt");
    expect(result.suggestions[0]).toHaveProperty("score");
    expect(result.suggestions[0]).toHaveProperty("reasons");
    
    // Suggested slots should not overlap with existing schedule
    for (const suggestion of result.suggestions) {
      for (const existing of input.currentSchedule) {
        const suggestStart = new Date(suggestion.startAt).getTime();
        const suggestEnd = new Date(suggestion.endAt).getTime();
        const existStart = new Date(existing.startAt).getTime();
        const existEnd = new Date(existing.endAt).getTime();
        
        const overlaps = suggestStart < existEnd && suggestEnd > existStart;
        expect(overlaps).toBe(false);
      }
    }
  });

  it("suggests slots with appropriate scores", () => {
    const input: TimeslotSuggestionInput = {
      taskId: "task-1",
      title: "Deep work session",
      priority: "High",
      estimatedMinutes: 90,
      currentSchedule: [],
    };

    const result = suggestTimeslots(input);
    expect(result.suggestions.length).toBeGreaterThan(0);
    // Scores should be 0-100
    for (const s of result.suggestions) {
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(100);
    }
  });
});

describe("AI Integration: Full Workflow Scenario", () => {
  it("can decompose, suggest automation, and find timeslots for the same task", async () => {
    // Step 1: Create a complex task
    const decompInput: TaskDecompositionInput = {
      title: "Build user dashboard with analytics",
      description: `1. Set up project structure
2. Create API endpoints
3. Build frontend components
4. Add analytics integration
5. Write tests`,
      priority: "High",
      estimatedMinutes: 480,
    };

    // Step 2: Decompose
    const decomposed = await decomposeTaskSmart(decompInput);
    expect(decomposed.subtasks.length).toBe(5);

    // Step 3: Get automation suggestion for first subtask
    const automationInput: TaskAutomationInput = {
      taskId: "subtask-1",
      title: decomposed.subtasks[0].title,
      description: "",
      priority: decomposed.subtasks[0].priority,
      dueAt: null,
      scheduledStartAt: null,
      scheduledEndAt: null,
      isRunnable: true,
      runnabilityState: "runnable",
      ownerType: "agent",
    };

    const automation = await suggestAutomationSmart(automationInput);
    expect(automation.executionMode).toBeDefined();
    expect(automation.reminderStrategy).toBeDefined();

    // Step 4: Find a timeslot for the first subtask
    const timeslotInput: TimeslotSuggestionInput = {
      taskId: "subtask-1",
      title: decomposed.subtasks[0].title,
      priority: decomposed.subtasks[0].priority,
      estimatedMinutes: decomposed.subtasks[0].estimatedMinutes,
      currentSchedule: [],
    };

    const timeslots = suggestTimeslots(timeslotInput);
    expect(timeslots.suggestions.length).toBeGreaterThan(0);
  });
});
