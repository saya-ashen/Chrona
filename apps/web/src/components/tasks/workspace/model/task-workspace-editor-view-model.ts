import type { TaskConfigFormInput } from "@/components/schedule/forms/task-config-form";
import type { EditableTask, TaskData } from "./task-workspace-types";

export function taskToEditableTask(task: TaskData): EditableTask {
  return {
    title: task.title,
    description: task.description,
    priority: task.priority,
    dueAt: task.dueAt,
    scheduledStartAt: task.scheduledStartAt,
    scheduledEndAt: task.scheduledEndAt,
    scheduleStatus: task.scheduleStatus,
    executionRuntime: task.executionRuntime,
    executionConfig: task.executionConfig,
    autoPlanGeneration: task.autoPlanGeneration,
    autoExecute: task.autoExecute,
    recurrenceRule: task.recurrenceRule ?? null,
  };
}

export function dateToIsoStringOrNull(value: Date | null) {
  return value ? value.toISOString() : null;
}

export function taskToTaskConfigInitialValues(task: TaskData) {
  return {
    title: task.title,
    description: task.description,
    priority: task.priority as TaskConfigFormInput["priority"],
    dueAt: task.dueAt ? new Date(task.dueAt) : null,
    scheduledStartAt: task.scheduledStartAt ? new Date(task.scheduledStartAt) : null,
    scheduledEndAt: task.scheduledEndAt ? new Date(task.scheduledEndAt) : null,
    executionRuntime: task.executionRuntime,
    executionConfig: task.executionConfig,
    autoPlanGeneration: task.autoPlanGeneration,
    autoExecute: task.autoExecute,
    autoPlanGenerationTiming: task.autoPlanGenerationTiming,
    autoExecuteTiming: task.autoExecuteTiming,
    recurrenceRule: task.recurrenceRule ?? null,
  };
}

export function taskConfigInputToEditableTask(input: TaskConfigFormInput, scheduleStatus: string): EditableTask {
  return {
    title: input.title,
    description: input.description || null,
    priority: input.priority,
    dueAt: dateToIsoStringOrNull(input.dueAt),
    scheduledStartAt: dateToIsoStringOrNull(input.scheduledStartAt),
    scheduledEndAt: dateToIsoStringOrNull(input.scheduledEndAt),
    scheduleStatus,
    executionRuntime: input.executionRuntime,
    executionConfig: input.executionConfig,
    autoPlanGeneration: input.autoPlanGeneration,
    autoExecute: input.autoExecute,
    recurrenceRule: input.recurrenceRule,
  };
}

export function editableTaskToPlanningDraft(task: EditableTask) {
  return {
    title: task.title,
    description: task.description ?? "",
    priority: task.priority as "Low" | "Medium" | "High" | "Urgent",
    dueAt: task.dueAt ? new Date(task.dueAt) : null,
    scheduledStartAt: task.scheduledStartAt ? new Date(task.scheduledStartAt) : null,
    scheduledEndAt: task.scheduledEndAt ? new Date(task.scheduledEndAt) : null,
  };
}

function formatTaskDate(iso: string | null) {
  if (!iso) return null;
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return null;
  return `${value.getMonth() + 1}/${value.getDate()}`;
}

function formatTaskTime(iso: string | null) {
  if (!iso) return null;
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return null;
  return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
}

export function editableTaskToEditSummary(task: EditableTask) {
  const scheduleDate = formatTaskDate(task.scheduledStartAt);
  const startTime = formatTaskTime(task.scheduledStartAt);
  const endTime = formatTaskTime(task.scheduledEndAt);
  const schedule = scheduleDate && startTime && endTime ? `${scheduleDate} ${startTime}-${endTime}` : "Unscheduled";
  const model = task.executionRuntime?.trim() || "Default runtime";
  const description = task.description?.trim()
    ? task.description.trim().length > 140
      ? `${task.description.trim().slice(0, 137)}...`
      : task.description.trim()
    : "No description";

  return {
    schedule,
    model,
    description,
  };
}
