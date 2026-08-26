import { normalizeAutomationTiming } from "@chrona/contracts";
import { recurrencePresetFromRule, recurrenceRuleFromState } from "../recurrence-presets";
import type {
  ExecutionConfigInput,
  TaskConfigCopy,
  TaskConfigFormInput,
  TaskConfigFormState,
  TaskConfigInitialValues,
  TaskConfigPreset,
} from "./task-config-form-types";

function padDatePart(value: number) {
  return String(value).padStart(2, "0");
}

export function formatDateTimeInput(value?: Date | null) {
  if (!value) return "";
  return `${value.getFullYear()}-${padDatePart(value.getMonth() + 1)}-${padDatePart(value.getDate())}T${padDatePart(value.getHours())}:${padDatePart(value.getMinutes())}`;
}

export function formatLocalDateInput(value?: Date | null) {
  if (!value) return "";
  return `${value.getFullYear()}-${padDatePart(value.getMonth() + 1)}-${padDatePart(value.getDate())}`;
}

export function parseLocalDateInput(value: string) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if ([year, month, day].some((part) => !Number.isFinite(part))) return null;
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

export function formatLocalDateLabel(value: Date) {
  return value.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function formatLocalTimeInput(value?: Date | null) {
  if (!value) return "";
  return `${padDatePart(value.getHours())}:${padDatePart(value.getMinutes())}`;
}

export function buildDateTimeFromLocalParts(dateValue: string, timeValue: string) {
  if (!dateValue || !timeValue) return null;
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hours, minutes] = timeValue.split(":").map(Number);
  if ([year, month, day, hours, minutes].some((value) => !Number.isFinite(value))) return null;
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
}

export function formatDurationLabel(startAt: Date | null, endAt: Date | null) {
  if (!startAt || !endAt) return null;
  const durationMinutes = Math.round((endAt.getTime() - startAt.getTime()) / 60000);
  if (durationMinutes <= 0) return null;
  if (durationMinutes % 60 === 0) return `${durationMinutes / 60}h`;
  if (durationMinutes > 60) return `${Math.floor(durationMinutes / 60)}h ${durationMinutes % 60}m`;
  return `${durationMinutes}m`;
}

export const TIME_OPTIONS = Array.from({ length: 24 * 4 }, (_, index) => {
  const totalMinutes = index * 15;
  return `${padDatePart(Math.floor(totalMinutes / 60))}:${padDatePart(totalMinutes % 60)}`;
});

function isExecutionConfig(value: unknown): value is ExecutionConfigInput {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function formatExecutionConfig(value: unknown) {
  return isExecutionConfig(value) && Object.keys(value).length > 0
    ? JSON.stringify(value, null, 2)
    : "";
}

function parseExecutionConfig(
  value: string,
  copy: Pick<TaskConfigCopy, "errorInvalidJson" | "errorJsonObject">,
): ExecutionConfigInput | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(copy.errorInvalidJson);
  }
  if (!isExecutionConfig(parsed)) throw new Error(copy.errorJsonObject);
  return parsed;
}

export function cloneExecutionConfig(input: ExecutionConfigInput) {
  return structuredClone(input);
}

function buildInitialExecutionState(executionConfig: unknown) {
  const raw = isExecutionConfig(executionConfig)
    ? cloneExecutionConfig(executionConfig)
    : {};
  const fieldExecutionConfig: ExecutionConfigInput = {};
  for (const key of ["model", "contextStrategy"] as const) {
    if (raw[key] !== undefined) {
      fieldExecutionConfig[key] = raw[key];
      delete raw[key];
    }
  }
  return {
    fieldExecutionConfig,
    extraExecutionConfig: formatExecutionConfig(raw),
  };
}

function initialTextValues(initialValues: TaskConfigInitialValues | undefined): Pick<TaskConfigFormState, "title" | "description" | "priority" | "dueAt" | "aiClientId"> {
  return {
    title: initialValues?.title ?? "",
    description: initialValues?.description ?? "",
    priority: initialValues?.priority ?? "Medium",
    dueAt: formatDateTimeInput(initialValues?.dueAt),
    aiClientId: initialValues?.aiClientId ?? "",
  };
}

function initialScheduleValues(initialValues: TaskConfigInitialValues | undefined): Pick<TaskConfigFormState, "scheduledDate" | "scheduledStartTime" | "scheduledEndTime"> {
  return {
    scheduledDate: formatLocalDateInput(initialValues?.scheduledStartAt),
    scheduledStartTime: formatLocalTimeInput(initialValues?.scheduledStartAt),
    scheduledEndTime: formatLocalTimeInput(initialValues?.scheduledEndAt),
  };
}

function initialAutomationValues(initialValues: TaskConfigInitialValues | undefined): Pick<TaskConfigFormState, "autoPlanGeneration" | "autoExecute" | "autoPlanGenerationTiming" | "autoExecuteTiming"> {
  const autoExecute = initialValues?.autoExecute ?? false;
  return {
    autoPlanGeneration: autoExecute || (initialValues?.autoPlanGeneration ?? false),
    autoExecute,
    autoPlanGenerationTiming: normalizeAutomationTiming(initialValues?.autoPlanGenerationTiming),
    autoExecuteTiming: normalizeAutomationTiming(initialValues?.autoExecuteTiming),
  };
}

function initialRecurrenceFieldValues(initialValues: TaskConfigInitialValues | undefined): Pick<TaskConfigFormState, "recurrenceMode" | "recurrenceCustomRule"> {
  const recurrenceMode = recurrencePresetFromRule(initialValues?.recurrenceRule);
  return {
    recurrenceMode,
    recurrenceCustomRule: recurrenceMode === "custom" ? (initialValues?.recurrenceRule ?? "") : "",
  };
}

export function toFormState(initialValues: TaskConfigInitialValues | undefined): TaskConfigFormState {
  return {
    ...initialTextValues(initialValues),
    ...initialScheduleValues(initialValues),
    ...initialAutomationValues(initialValues),
    ...initialRecurrenceFieldValues(initialValues),
    ...buildInitialExecutionState(initialValues?.executionConfig),
  };
}

function parseExtraExecutionConfig(
  formState: TaskConfigFormState,
  copy: Pick<TaskConfigCopy, "errorInvalidJson" | "errorJsonObject">,
  throwOnInvalidJson: boolean,
) {
  try {
    return parseExecutionConfig(formState.extraExecutionConfig, copy);
  } catch (error) {
    if (throwOnInvalidJson) throw error;
    return undefined;
  }
}

function validateSchedule(
  formState: TaskConfigFormState,
  throwOnInvalidJson: boolean,
  copy: Pick<TaskConfigCopy, "errorIncompleteSchedule" | "errorInvalidScheduleRange">,
) {
  const hasPartialSchedule = !!formState.scheduledDate || !!formState.scheduledStartTime || !!formState.scheduledEndTime;
  const scheduledStartAt = buildDateTimeFromLocalParts(formState.scheduledDate, formState.scheduledStartTime);
  const scheduledEndAt = buildDateTimeFromLocalParts(formState.scheduledDate, formState.scheduledEndTime);
  const error = hasPartialSchedule && (!scheduledStartAt || !scheduledEndAt)
    ? copy.errorIncompleteSchedule
    : scheduledStartAt && scheduledEndAt && scheduledEndAt <= scheduledStartAt
      ? copy.errorInvalidScheduleRange
      : null;
  if (error) {
    if (throwOnInvalidJson) throw new Error(error);
    return null;
  }
  return { scheduledStartAt, scheduledEndAt };
}

export function buildTaskConfigFormInput(
  formState: TaskConfigFormState,
  copy: Pick<TaskConfigCopy, "errorInvalidJson" | "errorJsonObject" | "errorIncompleteSchedule" | "errorInvalidScheduleRange">,
  options?: { throwOnInvalidJson?: boolean },
): TaskConfigFormInput | null {
  const throwOnInvalidJson = options?.throwOnInvalidJson ?? false;
  const extraExecutionConfig = parseExtraExecutionConfig(formState, copy, throwOnInvalidJson);
  if (extraExecutionConfig === undefined) return null;
  const schedule = validateSchedule(formState, throwOnInvalidJson, copy);
  if (!schedule) return null;
  const recurrenceRule = recurrenceRuleFromState(formState.recurrenceMode, formState.recurrenceCustomRule);
  return {
    title: formState.title,
    description: formState.description,
    priority: formState.priority,
    dueAt: formState.dueAt ? new Date(formState.dueAt) : null,
    ...schedule,
    executionConfig: {
      ...(extraExecutionConfig ?? {}),
      ...cloneExecutionConfig(formState.fieldExecutionConfig),
    },
    aiClientId: formState.aiClientId || null,
    autoPlanGeneration: formState.autoExecute || formState.autoPlanGeneration,
    autoExecute: formState.autoExecute,
    autoPlanGenerationTiming: normalizeAutomationTiming(formState.autoPlanGenerationTiming),
    autoExecuteTiming: normalizeAutomationTiming(formState.autoExecuteTiming),
    recurrenceRule,
    recurrenceAnchorStartAt: recurrenceRule ? schedule.scheduledStartAt : null,
    recurrenceAnchorEndAt: recurrenceRule ? schedule.scheduledEndAt : null,
  };
}

export function applyPresetValues(
  current: TaskConfigFormState,
  values: TaskConfigPreset["values"],
) {
  const next = applyPrimitivePresetValues(current, values);
  const withSchedule = applySchedulePresetValues(next, values);
  return "executionConfig" in values
    ? { ...withSchedule, ...buildInitialExecutionState(values.executionConfig) }
    : withSchedule;
}

function presetValue<Key extends keyof TaskConfigFormInput, Value>(
  values: TaskConfigPreset["values"],
  key: Key,
  current: Value,
  transform: (value: TaskConfigFormInput[Key] | undefined) => Value,
): Value {
  if (!(key in values)) return current;
  return transform(values[key]);
}

function applyPrimitivePresetValues(current: TaskConfigFormState, values: TaskConfigPreset["values"]) {
  const autoExecute = presetValue(values, "autoExecute", current.autoExecute, (value) => value ?? false);
  return {
    ...current,
    title: presetValue(values, "title", current.title, (value) => value ?? ""),
    description: presetValue(values, "description", current.description, (value) => value ?? ""),
    priority: presetValue(values, "priority", current.priority, (value) => value || current.priority),
    dueAt: presetValue(values, "dueAt", current.dueAt, (value) => formatDateTimeInput(value as Date | null)),
    aiClientId: presetValue(values, "aiClientId", current.aiClientId, (value) => value ?? ""),
    autoExecute,
    autoPlanGeneration: autoExecute || presetValue(values, "autoPlanGeneration", current.autoPlanGeneration, (value) => value ?? false),
    autoPlanGenerationTiming: presetValue(values, "autoPlanGenerationTiming", current.autoPlanGenerationTiming, normalizeAutomationTiming),
    autoExecuteTiming: presetValue(values, "autoExecuteTiming", current.autoExecuteTiming, normalizeAutomationTiming),
  };
}

function applySchedulePresetValues(current: TaskConfigFormState, values: TaskConfigPreset["values"]) {
  if (!("scheduledStartAt" in values || "scheduledEndAt" in values)) return current;
  return {
    ...current,
    scheduledDate: formatLocalDateInput(values.scheduledStartAt ?? null),
    scheduledStartTime: formatLocalTimeInput(values.scheduledStartAt ?? null),
    scheduledEndTime: formatLocalTimeInput(values.scheduledEndAt ?? null),
  };
}
