import type { TaskConfigFormInput } from "./task-config-form";

export type TaskConfigScheduleCommand =
  | { type: "clear" }
  | {
      type: "apply";
      dueAt: Date | null;
      scheduledStartAt: Date | null;
      scheduledEndAt: Date | null;
    };

export type ScheduleTaskConfigSaveContext = {
  taskExecutionMode?: "ai" | "manual";
  dueAt: Date | null;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
};

export type ScheduleTaskConfigPatch = {
  title: string;
  description: string | null;
  priority: TaskConfigFormInput["priority"];
  executionConfig?: TaskConfigFormInput["executionConfig"];
  aiClientId?: string | null;
  autoPlanGeneration?: boolean;
  autoExecute?: boolean;
  autoPlanGenerationTiming?: TaskConfigFormInput["autoPlanGenerationTiming"];
  autoExecuteTiming?: TaskConfigFormInput["autoExecuteTiming"];
  recurrenceRule?: string | null;
  recurrenceAnchorStartAt?: string | null;
  recurrenceAnchorEndAt?: string | null;
};

function sameDateOrNull(value: Date | null, original: Date | null) {
  return value?.getTime() === original?.getTime();
}

/**
 * Converts shared task-config form data into the Schedule feature's ordered
 * persistence contract. Manual mode never serializes hidden AI fields.
 */
export function buildScheduleTaskConfigSaveRequest(
  task: ScheduleTaskConfigSaveContext,
  input: TaskConfigFormInput,
): {
  taskBody: ScheduleTaskConfigPatch;
  scheduleCommands: TaskConfigScheduleCommand[];
} {
  const taskBody: ScheduleTaskConfigPatch = {
    title: input.title,
    description: input.description.trim() || null,
    priority: input.priority,
  };

  if (task.taskExecutionMode !== "manual") {
    Object.assign(taskBody, {
      executionConfig: input.executionConfig,
      aiClientId: input.aiClientId,
      autoPlanGeneration: input.autoPlanGeneration,
      autoExecute: input.autoExecute,
      autoPlanGenerationTiming: input.autoPlanGenerationTiming,
      autoExecuteTiming: input.autoExecuteTiming,
      recurrenceRule: input.recurrenceRule,
      recurrenceAnchorStartAt: input.recurrenceAnchorStartAt?.toISOString() ?? null,
      recurrenceAnchorEndAt: input.recurrenceAnchorEndAt?.toISOString() ?? null,
    });

    return {
      taskBody,
      // Preserve the existing AI editor transport contract.
      scheduleCommands:
        input.scheduledStartAt && input.scheduledEndAt
          ? [{
              type: "apply",
              dueAt: input.dueAt,
              scheduledStartAt: input.scheduledStartAt,
              scheduledEndAt: input.scheduledEndAt,
            }]
          : [],
    };
  }

  const hadSchedule = Boolean(task.scheduledStartAt && task.scheduledEndAt);
  if (input.scheduledStartAt && input.scheduledEndAt) {
    return {
      taskBody,
      scheduleCommands: [{
        type: "apply",
        dueAt: input.dueAt,
        scheduledStartAt: input.scheduledStartAt,
        scheduledEndAt: input.scheduledEndAt,
      }],
    };
  }

  if (hadSchedule) {
    return {
      taskBody,
      scheduleCommands: [
        { type: "clear" },
        ...(input.dueAt
          ? [{ type: "apply" as const, dueAt: input.dueAt, scheduledStartAt: null, scheduledEndAt: null }]
          : []),
      ],
    };
  }

  return {
    taskBody,
    scheduleCommands: sameDateOrNull(input.dueAt, task.dueAt)
      ? []
      : [{ type: "apply", dueAt: input.dueAt, scheduledStartAt: null, scheduledEndAt: null }],
  };
}
