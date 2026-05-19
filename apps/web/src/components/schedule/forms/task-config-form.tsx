"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { buttonVariants } from "@/components/ui/button";
import { Field, inputClassName, selectClassName, textareaClassName } from "@/components/ui/field";
import { useI18n } from "@chrona/i18n/react";
import {
  deleteValueAtPath,
  getValueAtPath,
  setValueAtPath,
  validateTaskConfigAgainstSpec,
} from "@chrona/runtime-core";
import type { RuntimeInput, RuntimeTaskConfigField, RuntimeTaskConfigSpec } from "@chrona/runtime-core";

export type TaskConfigFormDraft = {
  title: string;
  description: string;
  priority: "Low" | "Medium" | "High" | "Urgent";
  dueAt: Date | null;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
};

export type TaskConfigFormInput = TaskConfigFormDraft & {
  executionRuntime: string;
  executionConfig: RuntimeInput;
};

export type TaskConfigExecutionRuntime = {
  key: string;
  label: string;
  spec: RuntimeTaskConfigSpec;
};

type TaskConfigPreset = {
  id: string;
  label: string;
  description: string;
  values: Partial<TaskConfigFormInput>;
};

type TaskConfigFormState = {
  title: string;
  description: string;
  priority: TaskConfigFormInput["priority"];
  dueAt: string;
  scheduledDate: string;
  scheduledStartTime: string;
  scheduledEndTime: string;
  executionRuntime: string;
  fieldExecutionConfig: RuntimeInput;
  extraExecutionConfig: string;
};

export type TaskConfigDraftState = {
  isDirty: boolean;
  values: TaskConfigFormInput;
};

type TaskConfigFormProps = {
  executionRuntimes: TaskConfigExecutionRuntime[];
  defaultExecutionRuntime: string;
  compact?: boolean;
  initialValues?: {
    title?: string;
    description?: string | null;
    priority?: "Low" | "Medium" | "High" | "Urgent";
    dueAt?: Date | null;
    scheduledStartAt?: Date | null;
    scheduledEndAt?: Date | null;
    executionRuntime?: string | null;
    executionConfig?: unknown;
  };
  submitLabel: string;
  pendingLabel: string;
  isPending?: boolean;
  presets?: TaskConfigPreset[];
  footerActions?: ReactNode;
  onDraftStateChange?: (state: TaskConfigDraftState) => void;
  onSubmitAction: (input: TaskConfigFormInput) => Promise<void> | void;
};

const DEFAULT_COPY = {
  moreOptions: "More options",
  starterPresets: "Starter presets",
  title: "Title",
  titlePlaceholder: "Add the next task to execute",
  priority: "Priority",
  schedule: "Schedule",
  scheduleHint: "Adjust when this block should run.",
  scheduleDate: "Date",
  scheduleStart: "Start",
  scheduleEnd: "End",
  scheduleDuration: "Duration",
  priorities: {
    Low: "Low",
    Medium: "Medium",
    High: "High",
    Urgent: "Urgent",
  },
  adapter: "Adapter",
  advancedFields: "Advanced fields",
  description: "Description",
  descriptionPlaceholder: "Optional execution context or desired outcome",
  runtimeParams: "Additional runtime params (JSON)",
  runtimeParamsPlaceholder: '{"customFlag": true}',
  errorInvalidJson: "Runtime params must be valid JSON",
  errorJsonObject: "Runtime params must be a JSON object",
  errorIncompleteSchedule: "Set date, start, and end time together",
  errorInvalidScheduleRange: "End time must be after start time",
  actionFailed: "Action failed",
} as const;

function formatDateTimeInput(value?: Date | null) {
  return value ? value.toISOString().slice(0, 16) : "";
}

function padDatePart(value: number) {
  return String(value).padStart(2, "0");
}

function formatLocalDateInput(value?: Date | null) {
  if (!value) return "";
  return `${value.getFullYear()}-${padDatePart(value.getMonth() + 1)}-${padDatePart(value.getDate())}`;
}

function formatLocalTimeInput(value?: Date | null) {
  if (!value) return "";
  return `${padDatePart(value.getHours())}:${padDatePart(value.getMinutes())}`;
}

function buildDateTimeFromLocalParts(dateValue: string, timeValue: string) {
  if (!dateValue || !timeValue) return null;
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hours, minutes] = timeValue.split(":").map(Number);
  if ([year, month, day, hours, minutes].some((value) => !Number.isFinite(value))) {
    return null;
  }

  return new Date(year, month - 1, day, hours, minutes, 0, 0);
}

function formatDurationLabel(startAt: Date | null, endAt: Date | null) {
  if (!startAt || !endAt) return null;
  const durationMinutes = Math.round((endAt.getTime() - startAt.getTime()) / 60000);
  if (durationMinutes <= 0) return null;
  if (durationMinutes % 60 === 0) return `${durationMinutes / 60}h`;
  if (durationMinutes > 60) return `${Math.floor(durationMinutes / 60)}h ${durationMinutes % 60}m`;
  return `${durationMinutes}m`;
}

const TIME_OPTIONS = Array.from({ length: 24 * 4 }, (_, index) => {
  const totalMinutes = index * 15;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${padDatePart(hours)}:${padDatePart(minutes)}`;
});

function isRuntimeInputObject(value: unknown): value is RuntimeInput {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function formatRuntimeConfig(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }

  return JSON.stringify(value, null, 2);
}

function parseRuntimeConfig(
  value: string,
  copy: { errorInvalidJson: string; errorJsonObject: string },
): RuntimeInput | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(copy.errorInvalidJson);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(copy.errorJsonObject);
  }

  return parsed as RuntimeInput;
}

function cloneRuntimeInput(input: RuntimeInput) {
  return structuredClone(input);
}

function resolveExecutionRuntime(
  executionRuntimes: TaskConfigExecutionRuntime[],
  executionRuntime: string | null | undefined,
  defaultExecutionRuntime: string,
) {
  const normalizedKey = executionRuntime?.trim() || defaultExecutionRuntime;

  return (
    executionRuntimes.find((runtime) => runtime.key === normalizedKey) ??
    executionRuntimes[0] ?? {
      key: defaultExecutionRuntime,
      label: defaultExecutionRuntime,
      spec: {
        runtime: defaultExecutionRuntime,
        version: `${defaultExecutionRuntime}-v1`,
        fields: [],
        runnability: { requiredPaths: [] },
      },
    }
  );
}

function pickSpecFieldRuntimeInput(spec: RuntimeTaskConfigSpec, runtimeInput: RuntimeInput) {
  const picked: RuntimeInput = {};

  for (const field of spec.fields) {
    const value = getValueAtPath(runtimeInput, field.path);

    if (value !== undefined) {
      setValueAtPath(picked, field.path, structuredClone(value));
    }
  }

  return picked;
}

function pickExtraRuntimeInput(spec: RuntimeTaskConfigSpec, runtimeInput: RuntimeInput) {
  const extra = cloneRuntimeInput(runtimeInput);

  for (const field of spec.fields) {
    deleteValueAtPath(extra, field.path);
  }

  return Object.keys(extra).length > 0 ? extra : null;
}

function areRuntimeFieldValuesEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function stripDefaultRuntimeFieldValues(spec: RuntimeTaskConfigSpec, runtimeInput: RuntimeInput) {
  const strippedRuntimeInput = cloneRuntimeInput(runtimeInput);

  for (const field of spec.fields) {
    if (field.defaultValue === undefined) {
      continue;
    }

    const value = getValueAtPath(strippedRuntimeInput, field.path);

    if (value !== undefined && areRuntimeFieldValuesEqual(value, field.defaultValue)) {
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
  const runtime = resolveExecutionRuntime(
    input.executionRuntimes,
    input.executionRuntime,
    input.defaultExecutionRuntime,
  );
  const rawExecutionConfig = isRuntimeInputObject(input.executionConfig) ? input.executionConfig : {};
  const explicitExecutionConfig = validateTaskConfigAgainstSpec(runtime.spec, rawExecutionConfig, {
    applyDefaults: false,
  });
  const hydratedExecutionConfig = stripDefaultRuntimeFieldValues(runtime.spec, explicitExecutionConfig);

  return {
    executionRuntime: runtime.key,
    fieldExecutionConfig: pickSpecFieldRuntimeInput(runtime.spec, hydratedExecutionConfig),
    extraExecutionConfig: formatRuntimeConfig(pickExtraRuntimeInput(runtime.spec, hydratedExecutionConfig)),
  };
}

function toFormState(
  initialValues: TaskConfigFormProps["initialValues"] | undefined,
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
    title: initialValues?.title ?? "",
    description: initialValues?.description ?? "",
    priority: initialValues?.priority ?? "Medium",
    dueAt: formatDateTimeInput(initialValues?.dueAt),
    scheduledDate: formatLocalDateInput(initialValues?.scheduledStartAt),
    scheduledStartTime: formatLocalTimeInput(initialValues?.scheduledStartAt),
    scheduledEndTime: formatLocalTimeInput(initialValues?.scheduledEndAt),
    ...runtimeState,
  };
}

function buildTaskConfigFormInput(
  formState: TaskConfigFormState,
  executionRuntimes: TaskConfigExecutionRuntime[],
  copy: { errorInvalidJson: string; errorJsonObject: string },
  options?: { throwOnInvalidJson?: boolean },
): TaskConfigFormInput | null {
  const executionRuntime = resolveExecutionRuntime(executionRuntimes, formState.executionRuntime, formState.executionRuntime);
  let extraRuntimeInput: RuntimeInput | null;
  try {
    extraRuntimeInput = parseRuntimeConfig(formState.extraExecutionConfig, copy);
  } catch (error) {
    if (options?.throwOnInvalidJson) {
      throw error;
    }
    return null;
  }
  const mergedRuntimeInput = {
    ...cloneRuntimeInput(formState.fieldExecutionConfig),
    ...(extraRuntimeInput ?? {}),
  };
  const executionConfig = validateTaskConfigAgainstSpec(executionRuntime.spec, mergedRuntimeInput) as RuntimeInput;

  const hasPartialSchedule =
    !!formState.scheduledDate || !!formState.scheduledStartTime || !!formState.scheduledEndTime;
  const scheduledStartAt = buildDateTimeFromLocalParts(formState.scheduledDate, formState.scheduledStartTime);
  const scheduledEndAt = buildDateTimeFromLocalParts(formState.scheduledDate, formState.scheduledEndTime);

  if (hasPartialSchedule && (!scheduledStartAt || !scheduledEndAt)) {
    if (options?.throwOnInvalidJson) {
      throw new Error(DEFAULT_COPY.errorIncompleteSchedule);
    }
    return null;
  }

  if (scheduledStartAt && scheduledEndAt && scheduledEndAt <= scheduledStartAt) {
    if (options?.throwOnInvalidJson) {
      throw new Error(DEFAULT_COPY.errorInvalidScheduleRange);
    }
    return null;
  }

  return {
    title: formState.title,
    description: formState.description,
    priority: formState.priority,
    dueAt: formState.dueAt ? new Date(formState.dueAt) : null,
    scheduledStartAt,
    scheduledEndAt,
    executionRuntime: executionRuntime.key,
    executionConfig,
  };
}

function applyRuntimeAdapterChange(
  current: TaskConfigFormState,
  runtime: TaskConfigExecutionRuntime,
): TaskConfigFormState {
  const remappedRuntimeInput: RuntimeInput = {};

  for (const field of runtime.spec.fields) {
    const value = getValueAtPath(current.fieldExecutionConfig, field.path);

    if (value !== undefined) {
      setValueAtPath(remappedRuntimeInput, field.path, structuredClone(value));
    }
  }

  const normalizedRuntimeInput = validateTaskConfigAgainstSpec(runtime.spec, remappedRuntimeInput, {
    applyDefaults: false,
  });

  return {
    ...current,
    executionRuntime: runtime.key,
    fieldExecutionConfig: pickSpecFieldRuntimeInput(runtime.spec, normalizedRuntimeInput),
    extraExecutionConfig: "",
  };
}

function applyPresetValues(
  current: TaskConfigFormState,
  values: TaskConfigPreset["values"],
  executionRuntimes: TaskConfigExecutionRuntime[],
  defaultExecutionRuntime: string,
) {
  let next = { ...current };

  if ("title" in values) {
    next.title = values.title ?? "";
  }

  if ("description" in values) {
    next.description = values.description ?? "";
  }

  if ("priority" in values && values.priority) {
    next.priority = values.priority;
  }

  if ("dueAt" in values) {
    next.dueAt = formatDateTimeInput(values.dueAt ?? null);
  }

  if ("scheduledStartAt" in values || "scheduledEndAt" in values) {
    next.scheduledDate = formatLocalDateInput(values.scheduledStartAt ?? null);
    next.scheduledStartTime = formatLocalTimeInput(values.scheduledStartAt ?? null);
    next.scheduledEndTime = formatLocalTimeInput(values.scheduledEndAt ?? null);
  }

  if (
    "executionRuntime" in values ||
    "executionConfig" in values
  ) {
    const runtimeState = buildInitialRuntimeState({
      executionRuntimes,
      defaultExecutionRuntime,
      executionRuntime: values.executionRuntime ?? next.executionRuntime,
      executionConfig: values.executionConfig,
    });

    next = {
      ...next,
      ...runtimeState,
    };
  }

  return next;
}

function readDisplayedFieldValue(field: RuntimeTaskConfigField, runtimeInput: RuntimeInput) {
  const value = getValueAtPath(runtimeInput, field.path);
  return value === undefined ? field.defaultValue : value;
}

function isFieldVisible(field: RuntimeTaskConfigField, runtimeInput: RuntimeInput) {
  if (!field.visibleWhen || field.visibleWhen.length === 0) {
    return true;
  }

  return field.visibleWhen.every((rule) => {
    const value = getValueAtPath(runtimeInput, rule.path);

    if (rule.op === "eq") {
      return value === rule.value;
    }

    if (rule.op === "in") {
      return Array.isArray(rule.value) && rule.value.includes(value);
    }

    return true;
  });
}

function renderFieldValue(value: unknown) {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return JSON.stringify(value);
}

export function TaskConfigForm({
  executionRuntimes,
  defaultExecutionRuntime,
  compact = false,
  initialValues,
  submitLabel,
  pendingLabel,
  isPending = false,
  presets,
  footerActions,
  onDraftStateChange,
  onSubmitAction,
}: TaskConfigFormProps) {
  const { messages } = useI18n();
  const taskConfigFormMessages = messages.components?.taskConfigForm;
  const copy = useMemo(() => ({
    ...DEFAULT_COPY,
    ...(taskConfigFormMessages ?? {}),
    priorities: {
      ...DEFAULT_COPY.priorities,
      ...(taskConfigFormMessages?.priorities ?? {}),
    },
  }), [taskConfigFormMessages]);
  const [localErrorMessage, setLocalErrorMessage] = useState<string | null>(null);
  const initialTitle = initialValues?.title;
  const initialDescription = initialValues?.description;
  const initialPriority = initialValues?.priority;
  const initialDueAt = initialValues?.dueAt;
  const initialScheduledStartAt = initialValues?.scheduledStartAt;
  const initialScheduledEndAt = initialValues?.scheduledEndAt;
  const initialExecutionRuntime = initialValues?.executionRuntime;
  const initialExecutionConfig = initialValues?.executionConfig;
  const initialState = useMemo(
    () =>
      toFormState(
        {
          title: initialTitle,
          description: initialDescription,
          priority: initialPriority,
          dueAt: initialDueAt,
          scheduledStartAt: initialScheduledStartAt,
          scheduledEndAt: initialScheduledEndAt,
          executionRuntime: initialExecutionRuntime,
          executionConfig: initialExecutionConfig,
        },
        executionRuntimes,
        defaultExecutionRuntime,
      ),
    [
      defaultExecutionRuntime,
      executionRuntimes,
      initialTitle,
      initialDescription,
      initialPriority,
      initialDueAt,
      initialScheduledStartAt,
      initialScheduledEndAt,
      initialExecutionRuntime,
      initialExecutionConfig,
    ],
  );
  const {
    control,
    reset,
    handleSubmit,
    setValue,
    getValues,
    formState: { isDirty },
  } = useForm<TaskConfigFormState>({
    defaultValues: initialState,
  });
  const formState = (useWatch({ control }) as TaskConfigFormState | undefined) ?? initialState;

  function replaceFormState(next: TaskConfigFormState) {
    reset(next, { keepDefaultValues: true });
  }

  useEffect(() => {
    reset(initialState);
  }, [initialState, reset]);

  useEffect(() => {
    if (!onDraftStateChange) {
      return;
    }

    const values = buildTaskConfigFormInput(formState, executionRuntimes, copy);
    if (!values) {
      return;
    }

    onDraftStateChange({
      isDirty,
      values,
    });
  }, [copy, executionRuntimes, formState, initialState, isDirty, onDraftStateChange]);

  const selectedExecutionRuntime = useMemo(
    () => resolveExecutionRuntime(executionRuntimes, formState.executionRuntime, defaultExecutionRuntime),
    [defaultExecutionRuntime, executionRuntimes, formState.executionRuntime],
  );
  const visibleExecutionConfig = useMemo(
    () =>
      selectedExecutionRuntime.spec.fields.reduce<RuntimeInput>((accumulator, field) => {
        const value = readDisplayedFieldValue(field, formState.fieldExecutionConfig);

        if (value !== undefined) {
          setValueAtPath(accumulator, field.path, value);
        }

        return accumulator;
      }, cloneRuntimeInput(formState.fieldExecutionConfig ?? {})),
    [formState.fieldExecutionConfig, selectedExecutionRuntime.spec.fields],
  );
  const visibleStandardFields = selectedExecutionRuntime.spec.fields.filter(
    (field) => !field.advanced && isFieldVisible(field, visibleExecutionConfig),
  );
  const scheduledStartAtPreview = buildDateTimeFromLocalParts(formState.scheduledDate, formState.scheduledStartTime);
  const scheduledEndAtPreview = buildDateTimeFromLocalParts(formState.scheduledDate, formState.scheduledEndTime);
  const scheduleDurationLabel = formatDurationLabel(scheduledStartAtPreview, scheduledEndAtPreview);
  const requiredRuntimeFields = visibleStandardFields.filter((field) =>
    selectedExecutionRuntime.spec.runnability.requiredPaths.includes(field.path),
  );
  const optionalRuntimeFields = visibleStandardFields.filter(
    (field) => !selectedExecutionRuntime.spec.runnability.requiredPaths.includes(field.path),
  );

  function updateRuntimeField(field: RuntimeTaskConfigField, nextValue: unknown) {
    const nextRuntimeInput = cloneRuntimeInput(getValues("fieldExecutionConfig") ?? {});

    if (nextValue === undefined) {
      deleteValueAtPath(nextRuntimeInput, field.path);
    } else {
      setValueAtPath(nextRuntimeInput, field.path, nextValue);
    }

    setValue("fieldExecutionConfig", nextRuntimeInput, { shouldDirty: true });
  }

  async function submitForm(values: TaskConfigFormState) {
    setLocalErrorMessage(null);

    try {
      const input = buildTaskConfigFormInput(values, executionRuntimes, copy, { throwOnInvalidJson: true });
      if (input) {
        await onSubmitAction(input);
      }
    } catch (error) {
      setLocalErrorMessage(error instanceof Error ? error.message : copy.actionFailed);
    }
  }

  return (
    <div className="space-y-3">
      {localErrorMessage ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{localErrorMessage}</p>
      ) : null}

      {presets && presets.length > 0 ? (
        <div className={compact ? "flex flex-wrap gap-2" : "rounded-2xl border border-border/60 bg-background/70 p-3"}>
          {compact ? <p className="sr-only">{copy.starterPresets}</p> : <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">{copy.starterPresets}</p>}
          <div className={compact ? "flex flex-wrap gap-2" : "mt-3 grid gap-2 sm:grid-cols-2"}>
            {presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                disabled={isPending}
                onClick={() =>
                  replaceFormState(
                    applyPresetValues(getValues(), preset.values, executionRuntimes, defaultExecutionRuntime),
                  )
                }
                className={compact ? "rounded-full border border-border/60 bg-background px-3 py-1.5 text-sm transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:opacity-60" : "rounded-2xl border border-border/60 bg-background px-3 py-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:opacity-60"}
              >
                <p className="text-sm font-medium text-foreground">{preset.label}</p>
                {!compact ? <p className="mt-1 text-xs text-muted-foreground">{preset.description}</p> : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <form onSubmit={(event) => void handleSubmit(submitForm)(event)} className="space-y-3">
        <Field label={copy.title} className="text-xs text-muted-foreground">
          <input
            name="title"
            required
            value={formState.title}
            onChange={(event) => setValue("title", event.target.value, { shouldDirty: true })}
            placeholder={copy.titlePlaceholder}
            className={inputClassName}
          />
        </Field>

        {!compact ? (
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] xl:items-start">
            <div className="space-y-3">
              <Field label={copy.description} className="text-xs text-muted-foreground">
                <textarea
                  name="description"
                  rows={5}
                  value={formState.description}
                  onChange={(event) => setValue("description", event.target.value, { shouldDirty: true })}
                  placeholder={copy.descriptionPlaceholder}
                  className={textareaClassName}
                />
              </Field>
            </div>

            <div className="space-y-3">
              <Field label={copy.priority} className="text-xs text-muted-foreground">
                <select
                  name="priority"
                  value={formState.priority}
                  onChange={(event) =>
                    setValue("priority", event.target.value as TaskConfigFormInput["priority"], { shouldDirty: true })
                  }
                  className={selectClassName}
                >
                  {(["Low", "Medium", "High", "Urgent"] as const).map((priority) => (
                    <option key={priority} value={priority}>
                      {copy.priorities[priority]}
                    </option>
                  ))}
                </select>
              </Field>

              <div className="rounded-[1.2rem] border border-border/60 bg-muted/25 p-3 shadow-sm">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{copy.schedule}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{copy.scheduleHint}</p>
                  </div>
                  {scheduleDurationLabel ? (
                    <span className="rounded-full border border-primary/15 bg-primary/8 px-2.5 py-1 text-xs font-medium text-primary">
                      {scheduleDurationLabel}
                    </span>
                  ) : null}
                </div>

                <div className="grid gap-2 sm:grid-cols-3">
                  <Field label={copy.scheduleDate} className="text-xs text-muted-foreground">
                    <input
                      name="scheduledDate"
                      type="date"
                      value={formState.scheduledDate}
                      onChange={(event) => setValue("scheduledDate", event.target.value, { shouldDirty: true })}
                      className={inputClassName}
                    />
                  </Field>

                  <Field label={copy.scheduleStart} className="text-xs text-muted-foreground">
                    <select
                      name="scheduledStartTime"
                      value={formState.scheduledStartTime}
                      onChange={(event) => setValue("scheduledStartTime", event.target.value, { shouldDirty: true })}
                      className={selectClassName}
                    >
                      <option value="">--</option>
                      {TIME_OPTIONS.map((time) => (
                        <option key={time} value={time}>
                          {time}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label={copy.scheduleEnd} className="text-xs text-muted-foreground">
                    <select
                      name="scheduledEndTime"
                      value={formState.scheduledEndTime}
                      onChange={(event) => setValue("scheduledEndTime", event.target.value, { shouldDirty: true })}
                      className={selectClassName}
                    >
                      <option value="">--</option>
                      {TIME_OPTIONS.map((time) => (
                        <option key={time} value={time}>
                          {time}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              </div>
            </div>
          </div>
        ) : null}


        {(compact ? requiredRuntimeFields : visibleStandardFields).map((field) => {
          const value = readDisplayedFieldValue(field, formState.fieldExecutionConfig);

          if (field.kind === "textarea") {
            return (
              <Field key={field.path} label={field.label} hint={field.description} className="text-xs text-muted-foreground">
                <textarea
                  name={field.path}
                  rows={compact ? 3 : 4}
                  value={renderFieldValue(value)}
                  onChange={(event) => updateRuntimeField(field, event.target.value)}
                  maxLength={field.constraints?.maxLength}
                  className={textareaClassName}
                />
              </Field>
            );
          }

          if (field.kind === "select") {
            return (
              <Field key={field.path} label={field.label} hint={field.description} className="text-xs text-muted-foreground">
                <select
                  name={field.path}
                  value={renderFieldValue(value)}
                  onChange={(event) => updateRuntimeField(field, event.target.value || undefined)}
                  className={selectClassName}
                >
                  <option value="">-</option>
                  {(field.options ?? []).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
            );
          }

          if (field.kind === "number") {
            return (
              <Field key={field.path} label={field.label} hint={field.description} className="text-xs text-muted-foreground">
                <input
                  name={field.path}
                  type="number"
                  value={renderFieldValue(value)}
                  onChange={(event) => updateRuntimeField(field, event.target.value === "" ? undefined : event.target.value)}
                  min={field.constraints?.min}
                  max={field.constraints?.max}
                  step={field.constraints?.step}
                  className={inputClassName}
                />
              </Field>
            );
          }

          if (field.kind === "boolean") {
            return (
              <Field key={field.path} label={field.label} hint={field.description} className="text-xs text-muted-foreground">
                <label className="flex items-center gap-2 rounded-xl border border-border/70 bg-background/90 px-3 py-2 text-sm text-foreground">
                  <input
                    name={field.path}
                    type="checkbox"
                    checked={Boolean(value)}
                    onChange={(event) => updateRuntimeField(field, event.target.checked)}
                  />
                  <span>{field.label}</span>
                </label>
              </Field>
            );
          }

          if (field.kind === "json") {
            return (
              <Field key={field.path} label={field.label} hint={field.description} className="text-xs text-muted-foreground">
                <textarea
                  name={field.path}
                  rows={compact ? 4 : 5}
                  value={typeof value === "string" ? value : formatRuntimeConfig(value)}
                  onChange={(event) => updateRuntimeField(field, event.target.value)}
                  className={textareaClassName}
                />
              </Field>
            );
          }

          return (
            <Field key={field.path} label={field.label} hint={field.description} className="text-xs text-muted-foreground">
              <input
                name={field.path}
                value={renderFieldValue(value)}
                onChange={(event) => updateRuntimeField(field, event.target.value)}
                minLength={field.constraints?.minLength}
                maxLength={field.constraints?.maxLength}
                pattern={field.constraints?.pattern}
                className={inputClassName}
              />
            </Field>
          );
        })}

        {compact ? (
          <details className="rounded-2xl border border-border/60 bg-background/70 px-3 py-3">
            <summary className="cursor-pointer text-sm font-medium text-foreground">{copy.moreOptions}</summary>

            <div className="mt-3 space-y-3">
              <>
                <Field label={copy.priority} className="text-xs text-muted-foreground">
                  <select
                    name="priority"
                    value={formState.priority}
                    onChange={(event) =>
                      setValue("priority", event.target.value as TaskConfigFormInput["priority"], { shouldDirty: true })
                    }
                    className={selectClassName}
                  >
                    {(["Low", "Medium", "High", "Urgent"] as const).map((priority) => (
                      <option key={priority} value={priority}>
                        {copy.priorities[priority]}
                      </option>
                    ))}
                  </select>
                </Field>

                {executionRuntimes.length > 1 ? (
                  <Field label={copy.adapter} className="text-xs text-muted-foreground">
                    <select
                      name="executionRuntime"
                      value={formState.executionRuntime}
                      onChange={(event) =>
                        replaceFormState(
                          applyRuntimeAdapterChange(
                            getValues(),
                            resolveExecutionRuntime(executionRuntimes, event.target.value, defaultExecutionRuntime),
                          ),
                        )
                      }
                      className={selectClassName}
                    >
                      {executionRuntimes.map((runtime) => (
                        <option key={runtime.key} value={runtime.key}>
                          {runtime.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : null}

                <Field label={copy.description} className="text-xs text-muted-foreground">
                  <textarea
                    name="description"
                    rows={3}
                    value={formState.description}
                    onChange={(event) => setValue("description", event.target.value, { shouldDirty: true })}
                    placeholder={copy.descriptionPlaceholder}
                    className={textareaClassName}
                  />
                </Field>
              </>

              {optionalRuntimeFields.map((field) => {
              const value = readDisplayedFieldValue(field, formState.fieldExecutionConfig);

              if (field.kind === "textarea") {
                return (
                  <Field key={field.path} label={field.label} hint={field.description} className="text-xs text-muted-foreground">
                    <textarea
                      name={field.path}
                      rows={3}
                      value={renderFieldValue(value)}
                      onChange={(event) => updateRuntimeField(field, event.target.value)}
                      maxLength={field.constraints?.maxLength}
                      className={textareaClassName}
                    />
                  </Field>
                );
              }

              if (field.kind === "select") {
                return (
                  <Field key={field.path} label={field.label} hint={field.description} className="text-xs text-muted-foreground">
                    <select
                      name={field.path}
                      value={renderFieldValue(value)}
                      onChange={(event) => updateRuntimeField(field, event.target.value || undefined)}
                      className={selectClassName}
                    >
                      <option value="">-</option>
                      {(field.options ?? []).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                );
              }

              if (field.kind === "number") {
                return (
                  <Field key={field.path} label={field.label} hint={field.description} className="text-xs text-muted-foreground">
                    <input
                      name={field.path}
                      type="number"
                      value={renderFieldValue(value)}
                      onChange={(event) => updateRuntimeField(field, event.target.value === "" ? undefined : event.target.value)}
                      min={field.constraints?.min}
                      max={field.constraints?.max}
                      step={field.constraints?.step}
                      className={inputClassName}
                    />
                  </Field>
                );
              }

              if (field.kind === "boolean") {
                return (
                  <Field key={field.path} label={field.label} hint={field.description} className="text-xs text-muted-foreground">
                    <label className="flex items-center gap-2 rounded-xl border border-border/70 bg-background/90 px-3 py-2 text-sm text-foreground">
                      <input
                        name={field.path}
                        type="checkbox"
                        checked={Boolean(value)}
                        onChange={(event) => updateRuntimeField(field, event.target.checked)}
                      />
                      <span>{field.label}</span>
                    </label>
                  </Field>
                );
              }

              if (field.kind === "json") {
                return (
                  <Field key={field.path} label={field.label} hint={field.description} className="text-xs text-muted-foreground">
                    <textarea
                      name={field.path}
                      rows={4}
                      value={typeof value === "string" ? value : formatRuntimeConfig(value)}
                      onChange={(event) => updateRuntimeField(field, event.target.value)}
                      className={textareaClassName}
                    />
                  </Field>
                );
              }

              return (
                <Field key={field.path} label={field.label} hint={field.description} className="text-xs text-muted-foreground">
                  <input
                    name={field.path}
                    value={renderFieldValue(value)}
                    onChange={(event) => updateRuntimeField(field, event.target.value)}
                    className={inputClassName}
                  />
                </Field>
              );
            })}
            </div>
          </details>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
          <div className="flex flex-wrap items-center gap-2">{footerActions}</div>
          <button type="submit" disabled={isPending} className={buttonVariants({ variant: "default", size: "default" })}>
            {isPending ? pendingLabel : submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
