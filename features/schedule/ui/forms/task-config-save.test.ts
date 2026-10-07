import { describe, expect, it } from "vitest";
import {
  buildScheduleTaskConfigSaveRequest,
  type ScheduleTaskConfigSaveContext,
} from "./task-config-save";
import type { TaskConfigFormInput } from "./task-config-form";

const input = (overrides: Partial<TaskConfigFormInput> = {}): TaskConfigFormInput => ({
  title: "Edited task",
  description: "Notes",
  priority: "High",
  dueAt: null,
  scheduledStartAt: null,
  scheduledEndAt: null,
  executionConfig: { suggestedDurationMinutes: 30 },
  aiClientId: "client-1",
  autoPlanGeneration: true,
  autoExecute: false,
  autoPlanGenerationTiming: "at_start",
  autoExecuteTiming: "at_start",
  recurrenceRule: "FREQ=WEEKLY",
  recurrenceAnchorStartAt: null,
  recurrenceAnchorEndAt: null,
  ...overrides,
});

const manual = (overrides: Partial<ScheduleTaskConfigSaveContext> = {}): ScheduleTaskConfigSaveContext => ({
  taskExecutionMode: "manual",
  dueAt: null,
  scheduledStartAt: null,
  scheduledEndAt: null,
  ...overrides,
});

describe("buildScheduleTaskConfigSaveRequest", () => {
  it.each([
    ["due-at only", manual(), input({ dueAt: new Date("2026-07-01T17:00:00.000Z") }), [{ type: "apply", dueAt: new Date("2026-07-01T17:00:00.000Z"), scheduledStartAt: null, scheduledEndAt: null }]],
    ["clear due-at", manual({ dueAt: new Date("2026-06-01T17:00:00.000Z") }), input(), [{ type: "apply", dueAt: null, scheduledStartAt: null, scheduledEndAt: null }]],
    ["clear block while retaining deadline", manual({ scheduledStartAt: new Date("2026-06-01T09:00:00.000Z"), scheduledEndAt: new Date("2026-06-01T10:00:00.000Z") }), input({ dueAt: new Date("2026-07-01T17:00:00.000Z") }), [{ type: "clear" }, { type: "apply", dueAt: new Date("2026-07-01T17:00:00.000Z"), scheduledStartAt: null, scheduledEndAt: null }]],
  ])("serializes manual %s without hidden AI keys", (_name, task, values, scheduleCommands) => {
    const save = buildScheduleTaskConfigSaveRequest(task, values);

    expect(save.taskBody).toEqual({ title: "Edited task", description: "Notes", priority: "High" });
    expect(save.scheduleCommands).toEqual(scheduleCommands);
  });

  it("preserves the existing AI update and scheduled-block transport", () => {
    const start = new Date("2026-07-01T09:00:00.000Z");
    const end = new Date("2026-07-01T10:00:00.000Z");
    const save = buildScheduleTaskConfigSaveRequest(
      { taskExecutionMode: "ai", dueAt: null, scheduledStartAt: null, scheduledEndAt: null },
      input({ scheduledStartAt: start, scheduledEndAt: end }),
    );

    expect(save.taskBody).toMatchObject({ aiClientId: "client-1", executionConfig: { suggestedDurationMinutes: 30 }, recurrenceRule: "FREQ=WEEKLY" });
    expect(save.scheduleCommands).toEqual([{ type: "apply", dueAt: null, scheduledStartAt: start, scheduledEndAt: end }]);
  });
});
