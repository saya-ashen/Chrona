import {
  deleteValueAtPath,
  getValueAtPath,
  setValueAtPath,
  validateTaskConfigAgainstSpec,
} from "@chrona/runtime-core";
import type { RuntimeInput, RuntimeTaskConfigField, RuntimeTaskConfigSpec } from "@chrona/runtime-core";
import { normalizeAutomationTiming } from "@chrona/contracts";
import type { TaskConfigExecutionRuntime } from "@features/task-workspace/public/workspace-integration";
import { recurrencePresetFromRule, recurrenceRuleFromState } from "../recurrence-presets";
import type {
  TaskConfigCopy,
  TaskConfigFormInput,
  TaskConfigFormState,
  TaskConfigInitialValues,
  TaskConfigPreset,
} from "./task-config-form-types";

export function formatDateTimeInput(value?: Date | null) {
  return value ? value.toISOString().slice(0, 16) : "";
}

function padDatePart(value: number) {
  return String(value).padStart(2, "0");
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

function isRuntimeInputObject(value: unknown): value is RuntimeInput {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function formatRuntimeConfig(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? JSON.stringify(value, null, 2) : "";
}

function parseRuntimeConfig(value: string, copy: Pick<TaskConfigCopy, "errorInvalidJson" | "errorJsonObject">): RuntimeInput | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(copy.errorInvalidJson);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(copy.errorJsonObject);
  return parsed as RuntimeInput;
}

export function cloneRuntimeInput(input: RuntimeInput) {
  return structuredClone(input);
}

export function resolveExecutionRuntime(
  executionRuntimes: TaskConfigExecutionRuntime[],
  executionRuntime: string | null | undefined,
  defaultExecutionRuntime: string,
) {
  const normalizedKey = executionRuntime?.trim() || defaultExecutionRuntime;
  return executionRuntimes.find((runtime) => runtime.key === normalizedKey) ?? executionRuntimes[0];
}

function pickSpecFieldRuntimeInput(spec: RuntimeTaskConfigSpec, runtimeInput: RuntimeInput) {
  const picked: RuntimeInput = {};
  for (const field of spec.fields) {
    const value = getValueAtPath(runtimeInput, field.path);
    if (value !== undefined) setValueAtPath(picked, field.path, structuredClone(value));
  }
  return picked;
}

function pickExtraRuntimeInput(spec: RuntimeTaskConfigSpec, runtimeInput: RuntimeInput) {
  const extra = cloneRuntimeInput(runtimeInput);
  for (const field of spec.fields) deleteValueAtPath(extra, field.path);
  return Object.keys(extra).length > 0 ? extra : null;
}

function stripDefaultRuntimeFieldValues(spec: RuntimeTaskConfigSpec, runtimeInput: RuntimeInput) {
  const strippedRuntimeInput = cloneRuntimeInput(runtimeInput);
  for (const field of spec.fields) {
    const value = getValueAtPath(strippedRuntimeInput, field.path);
    if (field.defaultValue !== undefined && value !== undefined && JSON.stringify(value) === JSON.stringify(field.defaultValue)) {
      deleteValueAtPath(strippedRuntimeInput, field.path);
    }
  }
  return strippedRuntimeInput;
}

function buildInitialRuntimeState(input: {
  executionRuntimes: TaskConfigExecutionRuntime[];
  defaultExecutionRuntime: string;
  executionRuntime?: string | null;
  executionConfig?: unknown;
}) {
  const runtime = resolveExecutionRuntime(input.executionRuntimes, input.executionRuntime, input.defaultExecutionRuntime);
  const rawExecutionConfig = isRuntimeInputObject(input.executionConfig) ? input.executionConfig : {};
  const explicitExecutionConfig = validateTaskConfigAgainstSpec(runtime.spec, rawExecutionConfig, { applyDefaults: false });
  const hydratedExecutionConfig = stripDefaultRuntimeFieldValues(runtime.spec, explicitExecutionConfig);
  return {
    executionRuntime: runtime.key,
    fieldExecutionConfig: pickSpecFieldRuntimeInput(runtime.spec, hydratedExecutionConfig),
    extraExecutionConfig: formatRuntimeConfig(pickExtraRuntimeInput(runtime.spec, hydratedExecutionConfig)),
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

export function toFormState(
  initialValues: TaskConfigInitialValues | undefined,
  executionRuntimes: TaskConfigExecutionRuntime[],
  defaultExecutionRuntime: string,
): TaskConfigFormState {
  const runtimeState = buildInitialRuntimeState({
    executionRuntimes,
    defaultExecutionRuntime,
    executionRuntime: initialValues?.executionRuntime,
    executionConfig: initialValues?.executionConfig,
  });
  return {
    ...initialTextValues(initialValues),
    ...initialScheduleValues(initialValues),
    ...initialAutomationValues(initialValues),
    ...initialRecurrenceFieldValues(initialValues),
    ...runtimeState,
  };
}

function parseExtraRuntimeInput(formState: TaskConfigFormState, copy: Pick<TaskConfigCopy, "errorInvalidJson" | "errorJsonObject">, throwOnInvalidJson: boolean) {
  try {
    return parseRuntimeConfig(formState.extraExecutionConfig, copy);
  } catch (error) {
    if (throwOnInvalidJson) throw error;
    return undefined;
  }
}

function validateSchedule(formState: TaskConfigFormState, throwOnInvalidJson: boolean, copy: Pick<TaskConfigCopy, "errorIncompleteSchedule" | "errorInvalidScheduleRange">) {
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
  executionRuntimes: TaskConfigExecutionRuntime[],
  copy: Pick<TaskConfigCopy, "errorInvalidJson" | "errorJsonObject" | "errorIncompleteSchedule" | "errorInvalidScheduleRange">,
  options?: { throwOnInvalidJson?: boolean },
): TaskConfigFormInput | null {
  const throwOnInvalidJson = options?.throwOnInvalidJson ?? false;
  const extraRuntimeInput = parseExtraRuntimeInput(formState, copy, throwOnInvalidJson);
  if (extraRuntimeInput === undefined) return null;
  const schedule = validateSchedule(formState, throwOnInvalidJson, copy);
  if (!schedule) return null;
  const executionRuntime = resolveExecutionRuntime(executionRuntimes, formState.executionRuntime, formState.executionRuntime);
  const executionConfig = validateTaskConfigAgainstSpec(executionRuntime.spec, {
    ...cloneRuntimeInput(formState.fieldExecutionConfig),
    ...(extraRuntimeInput ?? {}),
  }) as RuntimeInput;
  const recurrenceRule = recurrenceRuleFromState(formState.recurrenceMode, formState.recurrenceCustomRule);
  return {
    title: formState.title,
    description: formState.description,
    priority: formState.priority,
    dueAt: formState.dueAt ? new Date(formState.dueAt) : null,
    ...schedule,
    executionRuntime: executionRuntime.key,
    executionConfig,
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
  executionRuntimes: TaskConfigExecutionRuntime[],
  defaultExecutionRuntime: string,
) {
  const next = applyPrimitivePresetValues(current, values);
  const withSchedule = applySchedulePresetValues(next, values);
  return applyRuntimePresetValues(withSchedule, values, executionRuntimes, defaultExecutionRuntime);
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

function applyRuntimePresetValues(
  current: TaskConfigFormState,
  values: TaskConfigPreset["values"],
  executionRuntimes: TaskConfigExecutionRuntime[],
  defaultExecutionRuntime: string,
) {
  if (!("executionRuntime" in values || "executionConfig" in values)) return current;
  return {
    ...current,
    ...buildInitialRuntimeState({
      executionRuntimes,
      defaultExecutionRuntime,
      executionRuntime: values.executionRuntime ?? current.executionRuntime,
      executionConfig: values.executionConfig,
    }),
  };
}

export function readDisplayedFieldValue(field: RuntimeTaskConfigField, runtimeInput: RuntimeInput) {
  const value = getValueAtPath(runtimeInput, field.path);
  return value === undefined ? field.defaultValue : value;
}

export function isFieldVisible(field: RuntimeTaskConfigField, runtimeInput: RuntimeInput) {
  if (!field.visibleWhen || field.visibleWhen.length === 0) return true;
  return field.visibleWhen.every((rule) => {
    const value = getValueAtPath(runtimeInput, rule.path);
    return rule.op === "eq" ? value === rule.value : Array.isArray(rule.value) && rule.value.includes(value);
  });
}

export function renderFieldValue(value: unknown) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return JSON.stringify(value);
}
