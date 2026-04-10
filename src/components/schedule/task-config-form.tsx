"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import type { Prisma } from "@/generated/prisma/client";
import { buttonVariants } from "@/components/ui/button";
import { Field, inputClassName, selectClassName, textareaClassName } from "@/components/ui/field";
import { useI18n } from "@/i18n/client";

export type TaskConfigFormInput = {
  title: string;
  description: string;
  priority: "Low" | "Medium" | "High" | "Urgent";
  runtimeModel: string;
  prompt: string;
  dueAt: Date | null;
  runtimeConfig?: Prisma.InputJsonObject | null;
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
  runtimeModel: string;
  prompt: string;
  dueAt: string;
  runtimeConfig: string;
};

type TaskConfigFormProps = {
  initialValues?: {
    title?: string;
    description?: string | null;
    priority?: "Low" | "Medium" | "High" | "Urgent";
    runtimeModel?: string | null;
    prompt?: string | null;
    dueAt?: Date | null;
    runtimeConfig?: unknown;
  };
  submitLabel: string;
  pendingLabel: string;
  isPending?: boolean;
  presets?: TaskConfigPreset[];
  onSubmit: (input: TaskConfigFormInput) => Promise<void> | void;
};

const DEFAULT_COPY = {
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
  model: "Model",
  promptInstructions: "Prompt / instructions",
  promptPlaceholder: "Describe the task, constraints, and expected outcome",
  advancedFields: "Advanced fields",
  description: "Description",
  descriptionPlaceholder: "Optional execution context or desired outcome",
  runtimeParams: "Runtime params (JSON)",
  runtimeParamsPlaceholder: '{"temperature": 0.2}',
  errorInvalidJson: "Runtime params must be valid JSON",
  errorJsonObject: "Runtime params must be a JSON object",
  actionFailed: "Action failed",
} as const;

function formatDateTimeInput(value?: Date | null) {
  return value ? value.toISOString().slice(0, 16) : "";
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

function toFormState(initialValues?: TaskConfigFormProps["initialValues"]): TaskConfigFormState {
  return {
    title: initialValues?.title ?? "",
    description: initialValues?.description ?? "",
    priority: initialValues?.priority ?? "Medium",
    runtimeModel: initialValues?.runtimeModel ?? "",
    prompt: initialValues?.prompt ?? "",
    dueAt: formatDateTimeInput(initialValues?.dueAt),
    runtimeConfig: formatRuntimeConfig(initialValues?.runtimeConfig),
  };
}

function applyPresetValues(current: TaskConfigFormState, values: TaskConfigPreset["values"]) {
  const next = { ...current };

  if ("title" in values) {
    next.title = values.title ?? "";
  }

  if ("description" in values) {
    next.description = values.description ?? "";
  }

  if ("priority" in values && values.priority) {
    next.priority = values.priority;
  }

  if ("runtimeModel" in values) {
    next.runtimeModel = values.runtimeModel ?? "";
  }

  if ("prompt" in values) {
    next.prompt = values.prompt ?? "";
  }

  if ("dueAt" in values) {
    next.dueAt = formatDateTimeInput(values.dueAt ?? null);
  }

  if ("runtimeConfig" in values) {
    next.runtimeConfig = formatRuntimeConfig(values.runtimeConfig ?? null);
  }

  return next;
}

export function TaskConfigForm({
  initialValues,
  submitLabel,
  pendingLabel,
  isPending = false,
  presets,
  onSubmit,
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
  const initialState = useMemo(
    () => toFormState(initialValues),
    [
      initialValues?.title,
      initialValues?.description,
      initialValues?.priority,
      initialValues?.runtimeModel,
      initialValues?.prompt,
      initialValues?.dueAt?.toISOString(),
      formatRuntimeConfig(initialValues?.runtimeConfig),
    ],
  );
  const [formState, setFormState] = useState<TaskConfigFormState>(initialState);

  useEffect(() => {
    setFormState(initialState);
  }, [initialState]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalErrorMessage(null);

    try {
      await onSubmit({
        title: formState.title,
        description: formState.description,
        priority: formState.priority,
        runtimeModel: formState.runtimeModel,
        prompt: formState.prompt,
        dueAt: formState.dueAt ? new Date(formState.dueAt) : null,
        runtimeConfig: parseRuntimeConfig(formState.runtimeConfig, copy),
      });
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
        <div className="rounded-2xl border border-border/60 bg-background/70 p-3">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">{copy.starterPresets}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                disabled={isPending}
                onClick={() => setFormState((current) => applyPresetValues(current, preset.values))}
                className="rounded-2xl border border-border/60 bg-background px-3 py-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:opacity-60"
              >
                <p className="text-sm font-medium text-foreground">{preset.label}</p>
                <p className="mt-1 text-xs text-muted-foreground">{preset.description}</p>
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

        <Field label={copy.model} className="text-xs text-muted-foreground">
          <input
            name="runtimeModel"
            required
            value={formState.runtimeModel}
            onChange={(event) => setFormState((current) => ({ ...current, runtimeModel: event.target.value }))}
            placeholder="gpt-5.4"
            className={inputClassName}
          />
        </Field>

        <Field label={copy.promptInstructions} className="text-xs text-muted-foreground">
          <textarea
            name="prompt"
            required
            rows={4}
            value={formState.prompt}
            onChange={(event) => setFormState((current) => ({ ...current, prompt: event.target.value }))}
            placeholder={copy.promptPlaceholder}
            className={textareaClassName}
          />
        </Field>

        <details className="rounded-2xl border border-border/60 bg-background/70 px-3 py-3">
          <summary className="cursor-pointer text-sm font-medium text-foreground">{copy.advancedFields}</summary>

          <div className="mt-3 space-y-3">
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

            <Field label={copy.runtimeParams} className="text-xs text-muted-foreground">
              <textarea
                name="runtimeConfig"
                rows={6}
                value={formState.runtimeConfig}
                onChange={(event) => setFormState((current) => ({ ...current, runtimeConfig: event.target.value }))}
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
