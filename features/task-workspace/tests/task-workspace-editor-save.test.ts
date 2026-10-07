import { describe, expect, it } from "vitest";
import type { TaskConfigFormInput } from "@features/schedule";
import type { TaskData } from "../model/task-workspace-types";
import { buildTaskConfigSaveRequest } from "../hooks/use-task-workspace-editor-state";

function task(overrides: Partial<TaskData> = {}): TaskData {
  return {
    id: "task-1",
    workspaceId: "workspace-1",
    title: "Manual task",
    description: "Before",
    executionConfig: {},
    taskExecutionMode: "manual",
    aiClientId: null,
    autoPlanGeneration: false,
    autoExecute: false,
    autoPlanGenerationTiming: "immediate",
    autoExecuteTiming: "at_start",
    recurrenceRule: null,
    status: "Ready",
    priority: "Medium",
    dueAt: null,
    scheduledStartAt: null,
    scheduledEndAt: null,
    scheduleStatus: "Unscheduled",
    scheduleSource: null,
    isRunnable: true,
    runnabilitySummary: "Ready",
    blockReason: null,
    dependencies: [],
    ...overrides,
  };
}

function input(overrides: Partial<TaskConfigFormInput> = {}): TaskConfigFormInput {
  return {
    title: "Edited manual task",
    description: "",
    priority: "High",
    dueAt: new Date("2030-01-02T10:00:00.000Z"),
    scheduledStartAt: new Date("2030-01-02T09:00:00.000Z"),
    scheduledEndAt: new Date("2030-01-02T09:30:00.000Z"),
    executionConfig: { model: "never-send" },
    aiClientId: "ai-client",
    autoPlanGeneration: true,
    autoExecute: true,
    autoPlanGenerationTiming: "immediate",
    autoExecuteTiming: "at_start",
    recurrenceRule: "FREQ=DAILY",
    recurrenceAnchorStartAt: new Date("2030-01-02T09:00:00.000Z"),
    recurrenceAnchorEndAt: new Date("2030-01-02T09:30:00.000Z"),
    ...overrides,
  };
}

describe("buildTaskConfigSaveRequest", () => {
  it("serializes manual edits without AI, automation, execution, or recurrence fields", () => {
    const save = buildTaskConfigSaveRequest(task(), input());

    expect(save.taskBody).toEqual({
      title: "Edited manual task",
      description: null,
      priority: "High",
    });
    expect(save.scheduleCommands).toEqual([
      expect.objectContaining({ type: "apply", dueAt: new Date("2030-01-02T10:00:00.000Z") }),
    ]);
  });

  it("clears a manual one-off schedule while retaining its deadline", () => {
    const save = buildTaskConfigSaveRequest(
      task({
        dueAt: "2030-01-02T10:00:00.000Z",
        scheduledStartAt: "2030-01-02T09:00:00.000Z",
        scheduledEndAt: "2030-01-02T09:30:00.000Z",
      }),
      input({ scheduledStartAt: null, scheduledEndAt: null }),
    );

    expect(save.scheduleCommands).toEqual([
      { type: "clear" },
      expect.objectContaining({ type: "apply", scheduledStartAt: null, scheduledEndAt: null }),
    ]);
  });

  it("preserves the AI editor payload", () => {
    const save = buildTaskConfigSaveRequest(task({ taskExecutionMode: "ai" }), input());

    expect(save.taskBody).toMatchObject({
      executionConfig: { model: "never-send" },
      aiClientId: "ai-client",
      autoPlanGeneration: true,
      autoExecute: true,
      recurrenceRule: "FREQ=DAILY",
    });
  });
});
