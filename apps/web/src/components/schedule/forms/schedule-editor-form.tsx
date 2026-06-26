"use client";

import { useEffect, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { applySchedule, clearSchedule } from "@/lib/task-actions-client";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useI18n } from "@chrona/i18n/react";

type ScheduleEditorFormProps = {
  taskId: string;
  dueAt?: Date | null;
  scheduledStartAt?: Date | null;
  scheduledEndAt?: Date | null;
  scheduleSource?: "human" | "ai" | "system";
  submitLabel?: string;
  allowClear?: boolean;
  onMutatedAction?: () => Promise<void> | void;
};

type ScheduleEditorFormValues = {
  dueAt: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
};

const DEFAULT_COPY = {
  applySchedule: "Apply Schedule",
  due: "Due",
  start: "Start",
  end: "End",
  saving: "Saving…",
  updating: "Updating…",
  clearSchedule: "Clear Schedule",
  fieldRequired: "At least one scheduling field is required.",
  actionFailed: "Action failed",
} as const;

function formatDateTimeInput(value?: Date | null) {
  return value ? value.toISOString().slice(0, 16) : "";
}

function parseDateTime(value: string) {
  if (value.trim().length === 0) {
    return null;
  }

  return new Date(value);
}

export function ScheduleEditorForm({
  taskId,
  dueAt,
  scheduledStartAt,
  scheduledEndAt,
  scheduleSource = "human",
  submitLabel = "Apply Schedule",
  allowClear = true,
  onMutatedAction,
}: ScheduleEditorFormProps) {
  const { messages } = useI18n();
  const copy = { ...DEFAULT_COPY, ...messages.components.scheduleEditorForm };
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const defaultValues = useMemo<ScheduleEditorFormValues>(() => ({
    dueAt: formatDateTimeInput(dueAt),
    scheduledStartAt: formatDateTimeInput(scheduledStartAt),
    scheduledEndAt: formatDateTimeInput(scheduledEndAt),
  }), [dueAt, scheduledEndAt, scheduledStartAt]);
  const form = useForm<ScheduleEditorFormValues>({
    defaultValues,
    mode: "onChange",
  });

  useEffect(() => {
    form.reset(defaultValues);
  }, [defaultValues, form]);

  async function runAction(action: () => Promise<void>) {
    try {
      setIsPending(true);
      setErrorMessage(null);
      await action();
      await onMutatedAction?.();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : copy.actionFailed);
    } finally {
      setIsPending(false);
    }
  }

  async function handleScheduleSubmit(values: ScheduleEditorFormValues) {
    const nextDueAt = parseDateTime(values.dueAt);
    const nextScheduledStartAt = parseDateTime(values.scheduledStartAt);
    const nextScheduledEndAt = parseDateTime(values.scheduledEndAt);

    if (!nextScheduledStartAt || !nextScheduledEndAt) {
      setErrorMessage(copy.fieldRequired);
      return;
    }

    await runAction(async () => {
      await applySchedule({
        taskId,
        dueAt: nextDueAt,
        scheduledStartAt: nextScheduledStartAt,
        scheduledEndAt: nextScheduledEndAt,
        scheduleSource,
      });
    });
  }

  async function handleClearSubmit() {
    await runAction(async () => {
      await clearSchedule({ taskId });
    });
  }

  return (
    <div className="space-y-2">
      {errorMessage ? <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{errorMessage}</p> : null}

      <form onSubmit={(event) => void form.handleSubmit(handleScheduleSubmit)(event)}>
        <FieldGroup className="grid gap-2 md:grid-cols-3">
        <Controller
          name="dueAt"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid} className="text-xs text-muted-foreground">
              <FieldLabel htmlFor={field.name}>{copy.due}</FieldLabel>
              <Input {...field} aria-invalid={fieldState.invalid} id={field.name} type="datetime-local" />
              {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
            </Field>
          )}
        />
        <Controller
          name="scheduledStartAt"
          control={form.control}
          rules={{ required: copy.fieldRequired }}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid} className="text-xs text-muted-foreground">
              <FieldLabel htmlFor={field.name}>{copy.start}</FieldLabel>
              <Input {...field} aria-invalid={fieldState.invalid} id={field.name} type="datetime-local" />
              {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
            </Field>
          )}
        />
        <Controller
          name="scheduledEndAt"
          control={form.control}
          rules={{ required: copy.fieldRequired }}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid} className="text-xs text-muted-foreground">
              <FieldLabel htmlFor={field.name}>{copy.end}</FieldLabel>
              <Input {...field} aria-invalid={fieldState.invalid} id={field.name} type="datetime-local" />
              {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
            </Field>
          )}
        />
        <div className="flex flex-wrap gap-2 md:col-span-3">
          <Button type="submit" disabled={isPending} variant="default">
            {isPending ? copy.saving : submitLabel}
          </Button>
        </div>
        </FieldGroup>
      </form>

      {allowClear ? (
        <form onSubmit={(event) => { event.preventDefault(); void handleClearSubmit(); }}>
          <Button type="submit" disabled={isPending} variant="outline">
            {isPending ? copy.updating : copy.clearSchedule}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
