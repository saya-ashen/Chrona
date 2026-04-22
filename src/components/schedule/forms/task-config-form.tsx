"use client";

import type { JSX } from "react";
import { useEffect, useMemo, useState } from "react";
import type { Prisma } from "@/generated/prisma/client";
import { buttonVariants } from "@/components/ui/button";
import { Field, inputClassName, selectClassName, textareaClassName } from "@/components/ui/field";
import { useI18n } from "@/i18n/client";
import {
  deleteValueAtPath,
  getValueAtPath,
  setValueAtPath,
  validateTaskConfigAgainstSpec,
} from "@/modules/task-execution/config-spec";
import type { RuntimeInput, RuntimeTaskConfigField, RuntimeTaskConfigSpec } from "@/modules/task-execution/types";

export type TaskConfigFormInput = {
  title: string;
  description: string;
  priority: "Low" | "Medium" | "High" | "Urgent";
  dueAt: Date | null;
  runtimeAdapterKey: string;
  runtimeInput: Prisma.InputJsonObject;
  runtimeInputVersion: string;
  runtimeModel: string | null;
  prompt: string | null;
  runtimeConfig?: Prisma.InputJsonObject | null;
  sessionStrategy?: "shared" | "per_subtask";
};

export type TaskConfigRuntimeAdapter = {
  key: string;
  label: string;
  spec: RuntimeTaskConfigSpec;
};

export type TaskConfigPreset = {
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
  runtimeAdapterKey: string;
  runtimeInputVersion: string;
  fieldRuntimeInput: RuntimeInput;
  extraRuntimeConfig: string;
};

type TaskConfigFormProps = {
  runtimeAdapters: TaskConfigRuntimeAdapter[];
  defaultRuntimeAdapterKey: string;
  compact?: boolean;
  initialValues?: {
    title?: string;
    description?: string | null;
    priority?: "Low" | "Medium" | "High" | "Urgent";
    dueAt?: Date | null;
    runtimeAdapterKey?: string | null;
    runtimeInput?: unknown;
    runtimeInputVersion?: string | null;
    runtimeModel?: string | null;
    prompt?: string | null;
    runtimeConfig?: unknown;
  };
  submitLabel: string;
  pendingLabel: string;
  isPending?: boolean;
  presets?: TaskConfigPreset[];
  onSubmitAction: (input: TaskConfigFormInput) => Promise<void> | void;
};

const DEFAULT_COPY = {
  moreOptions: "More options",
  starterPresets: "Starter presets",
  title: "Title",
  titlePlaceholder: "Add the next task to execute",
  priority: "Priority",
  priorities: {
    Low: "Low",
    Medium: "Medium",
    High: "High",
    Urgent: "Urgent",
  },
  dueDate: "Due date",
  adapter: "Adapter",
  advancedFields: "Advanced fields",
  description: "Description",
  descriptionPlaceholder: "Optional execution context or desired outcome",
  runtimeParams: "Additional runtime params (JSON)",
  runtimeParamsPlaceholder: '{"customFlag": true}',
  errorInvalidJson: "Runtime params must be valid JSON",
  errorJsonObject: "Runtime params must be a JSON object",
  actionFailed: "Action failed",
} as const;

function formatDateTimeInput(value?: Date | null) {
  return value ? value.toISOString().slice(0, 16) : "";
}

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
): Prisma.InputJsonObject | null {
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

  return parsed as Prisma.InputJsonObject;
}

function cloneRuntimeInput(input: RuntimeInput) {
  return structuredClone(input);
}

function buildCompatRuntimeInput(initialValues?: TaskConfigFormProps["initialValues"]) {
  const runtimeInput: RuntimeInput = isRuntimeInputObject(initialValues?.runtimeInput)
    ? cloneRuntimeInput(initialValues.runtimeInput)
    : isRuntimeInputObject(initialValues?.runtimeConfig)
      ? cloneRuntimeInput(initialValues.runtimeConfig)
      : {};

  if (typeof initialValues?.runtimeModel === "string" && initialValues.runtimeModel.trim()) {
    runtimeInput.model = initialValues.runtimeModel.trim();
  }

  if (typeof initialValues?.prompt === "string" && initialValues.prompt.trim()) {
    runtimeInput.prompt = initialValues.prompt.trim();
  }

  return runtimeInput;
}

function resolveRuntimeAdapter(
  runtimeAdapters: TaskConfigRuntimeAdapter[],
  runtimeAdapterKey: string | null | undefined,
  defaultRuntimeAdapterKey: string,
) {
  const normalizedKey = runtimeAdapterKey?.trim() || defaultRuntimeAdapterKey;

  return (
    runtimeAdapters.find((adapter) => adapter.key === normalizedKey) ??
    runtimeAdapters[0] ?? {
      key: defaultRuntimeAdapterKey,
      label: defaultRuntimeAdapterKey,
      spec: {
        adapterKey: defaultRuntimeAdapterKey,
        version: `${defaultRuntimeAdapterKey}-v1`,
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
  runtimeAdapters: TaskConfigRuntimeAdapter[];
  defaultRuntimeAdapterKey: string;
  runtimeAdapterKey?: string | null;
  runtimeInput?: unknown;
  runtimeInputVersion?: string | null;
  runtimeModel?: string | null;
  prompt?: string | null;
  runtimeConfig?: unknown;
}) {
  const runtimeAdapter = resolveRuntimeAdapter(
    input.runtimeAdapters,
    input.runtimeAdapterKey,
    input.defaultRuntimeAdapterKey,
  );
  const rawRuntimeInput = isRuntimeInputObject(input.runtimeInput)
    ? input.runtimeInput
    : buildCompatRuntimeInput({
        runtimeModel: input.runtimeModel,
        prompt: input.prompt,
        runtimeConfig: input.runtimeConfig,
      });
  const explicitRuntimeInput = validateTaskConfigAgainstSpec(runtimeAdapter.spec, rawRuntimeInput, {
    applyDefaults: false,
  });
  const hydratedRuntimeInput = stripDefaultRuntimeFieldValues(runtimeAdapter.spec, explicitRuntimeInput);

  return {
    runtimeAdapterKey: runtimeAdapter.key,
    runtimeInputVersion: input.runtimeInputVersion?.trim() || runtimeAdapter.spec.version,
    fieldRuntimeInput: pickSpecFieldRuntimeInput(runtimeAdapter.spec, hydratedRuntimeInput),
    extraRuntimeConfig: formatRuntimeConfig(pickExtraRuntimeInput(runtimeAdapter.spec, hydratedRuntimeInput)),
  };
}

function toFormState(
  initialValues: TaskConfigFormProps["initialValues"] | undefined,
  runtimeAdapters: TaskConfigRuntimeAdapter[],
  defaultRuntimeAdapterKey: string,
): TaskConfigFormState {
  const runtimeState = buildInitialRuntimeState({
    runtimeAdapters,
    defaultRuntimeAdapterKey,
    runtimeAdapterKey: initialValues?.runtimeAdapterKey,
    runtimeInput: initialValues?.runtimeInput,
    runtimeInputVersion: initialValues?.runtimeInputVersion,
    runtimeModel: initialValues?.runtimeModel,
    prompt: initialValues?.prompt,
    runtimeConfig: initialValues?.runtimeConfig,
  });

  return {
    title: initialValues?.title ?? "",
    description: initialValues?.description ?? "",
    priority: initialValues?.priority ?? "Medium",
    dueAt: formatDateTimeInput(initialValues?.dueAt),
    ...runtimeState,
  };
}

function extractLegacyRuntimeFields(runtimeInput: RuntimeInput) {
  const runtimeModel = typeof runtimeInput.model === "string" && runtimeInput.model.trim() ? runtimeInput.model.trim() : null;
  const prompt = typeof runtimeInput.prompt === "string" && runtimeInput.prompt.trim() ? runtimeInput.prompt.trim() : null;
  const runtimeConfig = cloneRuntimeInput(runtimeInput);

  delete runtimeConfig.model;
  delete runtimeConfig.prompt;

  return {
    runtimeModel,
    prompt,
    runtimeConfig: Object.keys(runtimeConfig).length > 0 ? (runtimeConfig as Prisma.InputJsonObject) : null,
  };
}

function buildTaskConfigFormInput(
  formState: TaskConfigFormState,
  runtimeAdapters: TaskConfigRuntimeAdapter[],
  copy: { errorInvalidJson: string; errorJsonObject: string },
): TaskConfigFormInput {
  const runtimeAdapter = resolveRuntimeAdapter(runtimeAdapters, formState.runtimeAdapterKey, formState.runtimeAdapterKey);
  const extraRuntimeInput = parseRuntimeConfig(formState.extraRuntimeConfig, copy);
  const mergedRuntimeInput = {
    ...cloneRuntimeInput(formState.fieldRuntimeInput),
    ...(extraRuntimeInput ?? {}),
  };
  const runtimeInput = validateTaskConfigAgainstSpec(runtimeAdapter.spec, mergedRuntimeInput) as Prisma.InputJsonObject;
  const runtimeInputWithoutDefaults = validateTaskConfigAgainstSpec(runtimeAdapter.spec, mergedRuntimeInput, {
    applyDefaults: false,
  });
  const legacyRuntimeFields = extractLegacyRuntimeFields(runtimeInputWithoutDefaults);

  const sessionStrategy =
    runtimeInput.sessionStrategy === "shared" || runtimeInput.sessionStrategy === "per_subtask"
      ? (runtimeInput.sessionStrategy as "shared" | "per_subtask")
      : undefined;

  return {
    title: formState.title,
    description: formState.description,
    priority: formState.priority,
    dueAt: formState.dueAt ? new Date(formState.dueAt) : null,
    runtimeAdapterKey: runtimeAdapter.key,
    runtimeInputVersion: runtimeAdapter.spec.version,
    runtimeInput,
    runtimeModel: legacyRuntimeFields.runtimeModel,
    prompt: legacyRuntimeFields.prompt,
    runtimeConfig: legacyRuntimeFields.runtimeConfig,
    sessionStrategy,
  };
}

function applyRuntimeAdapterChange(
  current: TaskConfigFormState,
  runtimeAdapter: TaskConfigRuntimeAdapter,
): TaskConfigFormState {
  const remappedRuntimeInput: RuntimeInput = {};

  for (const field of runtimeAdapter.spec.fields) {
    const value = getValueAtPath(current.fieldRuntimeInput, field.path);

    if (value !== undefined) {
      setValueAtPath(remappedRuntimeInput, field.path, structuredClone(value));
    }
  }

  const normalizedRuntimeInput = validateTaskConfigAgainstSpec(runtimeAdapter.spec, remappedRuntimeInput, {
    applyDefaults: false,
  });

  return {
    ...current,
    runtimeAdapterKey: runtimeAdapter.key,
    runtimeInputVersion: runtimeAdapter.spec.version,
    fieldRuntimeInput: pickSpecFieldRuntimeInput(runtimeAdapter.spec, normalizedRuntimeInput),
    extraRuntimeConfig: "",
  };
}

function applyPresetValues(
  current: TaskConfigFormState,
  values: TaskConfigPreset["values"],
  runtimeAdapters: TaskConfigRuntimeAdapter[],
  defaultRuntimeAdapterKey: string,
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

  if (
    "runtimeAdapterKey" in values ||
    "runtimeInput" in values ||
    "runtimeInputVersion" in values ||
    "runtimeModel" in values ||
    "prompt" in values ||
    "runtimeConfig" in values
  ) {
    const runtimeState = buildInitialRuntimeState({
      runtimeAdapters,
      defaultRuntimeAdapterKey,
      runtimeAdapterKey: values.runtimeAdapterKey ?? next.runtimeAdapterKey,
      runtimeInput: values.runtimeInput,
      runtimeInputVersion: values.runtimeInputVersion,
      runtimeModel: values.runtimeModel,
      prompt: values.prompt,
      runtimeConfig: values.runtimeConfig,
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
  runtimeAdapters,
  defaultRuntimeAdapterKey,
  compact = false,
  initialValues,
  submitLabel,
  pendingLabel,
  isPending = false,
  presets,
  onSubmitAction,
}: TaskConfigFormProps) {
  const { messages } = useI18n();
  const copy = {
    ...DEFAULT_COPY,
    ...(messages.components?.taskConfigForm ?? {}),
    priorities: {
      ...DEFAULT_COPY.priorities,
      ...(messages.components?.taskConfigForm?.priorities ?? {}),
    },
  };
  const [localErrorMessage, setLocalErrorMessage] = useState<string | null>(null);
  const initialTitle = initialValues?.title;
  const initialDescription = initialValues?.description;
  const initialPriority = initialValues?.priority;
  const initialDueAt = initialValues?.dueAt;
  const initialRuntimeAdapterKey = initialValues?.runtimeAdapterKey;
  const initialRuntimeInput = initialValues?.runtimeInput;
  const initialRuntimeInputVersion = initialValues?.runtimeInputVersion;
  const initialRuntimeModel = initialValues?.runtimeModel;
  const initialPrompt = initialValues?.prompt;
  const initialRuntimeConfig = initialValues?.runtimeConfig;
  const initialState = useMemo(
    () =>
      toFormState(
        {
          title: initialTitle,
          description: initialDescription,
          priority: initialPriority,
          dueAt: initialDueAt,
          runtimeAdapterKey: initialRuntimeAdapterKey,
          runtimeInput: initialRuntimeInput,
          runtimeInputVersion: initialRuntimeInputVersion,
          runtimeModel: initialRuntimeModel,
          prompt: initialPrompt,
          runtimeConfig: initialRuntimeConfig,
        },
        runtimeAdapters,
        defaultRuntimeAdapterKey,
      ),
    [
      defaultRuntimeAdapterKey,
      runtimeAdapters,
      initialTitle,
      initialDescription,
      initialPriority,
      initialDueAt,
      initialRuntimeAdapterKey,
      initialRuntimeInput,
      initialRuntimeInputVersion,
      initialRuntimeModel,
      initialPrompt,
      initialRuntimeConfig,
    ],
  );
  const [formState, setFormState] = useState<TaskConfigFormState>(initialState);

  useEffect(() => {
    setFormState(initialState);
  }, [initialState]);

  const selectedRuntimeAdapter = useMemo(
    () => resolveRuntimeAdapter(runtimeAdapters, formState.runtimeAdapterKey, defaultRuntimeAdapterKey),
    [defaultRuntimeAdapterKey, formState.runtimeAdapterKey, runtimeAdapters],
  );
  const visibleRuntimeInput = useMemo(
    () =>
      selectedRuntimeAdapter.spec.fields.reduce<RuntimeInput>((accumulator, field) => {
        const value = readDisplayedFieldValue(field, formState.fieldRuntimeInput);

        if (value !== undefined) {
          setValueAtPath(accumulator, field.path, value);
        }

        return accumulator;
      }, cloneRuntimeInput(formState.fieldRuntimeInput)),
    [formState.fieldRuntimeInput, selectedRuntimeAdapter.spec.fields],
  );
  const visibleStandardFields = selectedRuntimeAdapter.spec.fields.filter(
    (field) => !field.advanced && isFieldVisible(field, visibleRuntimeInput),
  );
  const visibleAdvancedFields = selectedRuntimeAdapter.spec.fields.filter(
    (field) => field.advanced && isFieldVisible(field, visibleRuntimeInput),
  );
  const requiredRuntimeFields = visibleStandardFields.filter((field) =>
    selectedRuntimeAdapter.spec.runnability.requiredPaths.includes(field.path),
  );
  const optionalRuntimeFields = visibleStandardFields.filter(
    (field) => !selectedRuntimeAdapter.spec.runnability.requiredPaths.includes(field.path),
  );

  function updateRuntimeField(field: RuntimeTaskConfigField, nextValue: unknown) {
    setFormState((current) => {
      const nextRuntimeInput = cloneRuntimeInput(current.fieldRuntimeInput);

      if (nextValue === undefined) {
        deleteValueAtPath(nextRuntimeInput, field.path);
      } else {
        setValueAtPath(nextRuntimeInput, field.path, nextValue);
      }

      return {
        ...current,
        fieldRuntimeInput: nextRuntimeInput,
      };
    });
  }

  async function handleSubmit(event: Parameters<NonNullable<JSX.IntrinsicElements["form"]["onSubmit"]>>[0]) {
    event.preventDefault();
    setLocalErrorMessage(null);

    try {
      await onSubmitAction(buildTaskConfigFormInput(formState, runtimeAdapters, copy));
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
                  setFormState((current) =>
                    applyPresetValues(current, preset.values, runtimeAdapters, defaultRuntimeAdapterKey),
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

      <form onSubmit={(event) => void handleSubmit(event)} className="space-y-3">
        <Field label={copy.title} className="text-xs text-muted-foreground">
          <input
            name="title"
            required
            value={formState.title}
            onChange={(event) => setFormState((current) => ({ ...current, title: event.target.value }))}
            placeholder={copy.titlePlaceholder}
            className={inputClassName}
          />
        </Field>

        {!compact ? (
          <>
            <Field label={copy.description} className="text-xs text-muted-foreground">
              <textarea
                name="description"
                rows={3}
                value={formState.description}
                onChange={(event) => setFormState((current) => ({ ...current, description: event.target.value }))}
                placeholder={copy.descriptionPlaceholder}
                className={textareaClassName}
              />
            </Field>

            <div className="grid gap-2 sm:grid-cols-2">
              <Field label={copy.priority} className="text-xs text-muted-foreground">
                <select
                  name="priority"
                  value={formState.priority}
                onChange={(event) =>
                  setFormState((current) => ({
                    ...current,
                    priority: event.target.value as TaskConfigFormInput["priority"],
                  }))
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

              <Field label={copy.dueDate} className="text-xs text-muted-foreground">
                <input
                  name="dueAt"
                  type="datetime-local"
                  value={formState.dueAt}
                  onChange={(event) => setFormState((current) => ({ ...current, dueAt: event.target.value }))}
                  className={inputClassName}
                />
              </Field>
            </div>
          </>
        ) : null}


        {(compact ? requiredRuntimeFields : visibleStandardFields).map((field) => {
          const value = readDisplayedFieldValue(field, formState.fieldRuntimeInput);

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

        <details className="rounded-2xl border border-border/60 bg-background/70 px-3 py-3">
          <summary className="cursor-pointer text-sm font-medium text-foreground">{compact ? copy.moreOptions : copy.advancedFields}</summary>

          <div className="mt-3 space-y-3">
            {compact ? (
              <>
                <Field label={copy.priority} className="text-xs text-muted-foreground">
                  <select
                    name="priority"
                    value={formState.priority}
                    onChange={(event) =>
                      setFormState((current) => ({
                        ...current,
                        priority: event.target.value as TaskConfigFormInput["priority"],
                      }))
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

                <Field label={copy.dueDate} className="text-xs text-muted-foreground">
                  <input
                    name="dueAt"
                    type="datetime-local"
                    value={formState.dueAt}
                    onChange={(event) => setFormState((current) => ({ ...current, dueAt: event.target.value }))}
                    className={inputClassName}
                  />
                </Field>

                {runtimeAdapters.length > 1 ? (
                  <Field label={copy.adapter} className="text-xs text-muted-foreground">
                    <select
                      name="runtimeAdapterKey"
                      value={formState.runtimeAdapterKey}
                      onChange={(event) =>
                        setFormState((current) =>
                          applyRuntimeAdapterChange(
                            current,
                            resolveRuntimeAdapter(runtimeAdapters, event.target.value, defaultRuntimeAdapterKey),
                          ),
                        )
                      }
                      className={selectClassName}
                    >
                      {runtimeAdapters.map((adapter) => (
                        <option key={adapter.key} value={adapter.key}>
                          {adapter.label}
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
                    onChange={(event) => setFormState((current) => ({ ...current, description: event.target.value }))}
                    placeholder={copy.descriptionPlaceholder}
                    className={textareaClassName}
                  />
                </Field>
              </>
            ) : (
              <>
                {runtimeAdapters.length > 1 ? (
                  <Field label={copy.adapter} className="text-xs text-muted-foreground">
                    <select
                      name="runtimeAdapterKey"
                      value={formState.runtimeAdapterKey}
                      onChange={(event) =>
                        setFormState((current) =>
                          applyRuntimeAdapterChange(
                            current,
                            resolveRuntimeAdapter(runtimeAdapters, event.target.value, defaultRuntimeAdapterKey),
                          ),
                        )
                      }
                      className={selectClassName}
                    >
                      {runtimeAdapters.map((adapter) => (
                        <option key={adapter.key} value={adapter.key}>
                          {adapter.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : null}
              </>
            )}

            {(compact ? [...optionalRuntimeFields, ...visibleAdvancedFields] : visibleAdvancedFields).map((field) => {
              const value = readDisplayedFieldValue(field, formState.fieldRuntimeInput);

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

            <Field label={copy.runtimeParams} className="text-xs text-muted-foreground">
              <textarea
                name="runtimeConfig"
                rows={6}
                value={formState.extraRuntimeConfig}
                onChange={(event) => setFormState((current) => ({ ...current, extraRuntimeConfig: event.target.value }))}
                placeholder={copy.runtimeParamsPlaceholder}
                className={textareaClassName}
              />
            </Field>
          </div>
        </details>

        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={isPending} className={buttonVariants({ variant: "default", size: "sm" })}>
            {isPending ? pendingLabel : submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
