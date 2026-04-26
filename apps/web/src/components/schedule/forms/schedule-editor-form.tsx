"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { applySchedule, clearSchedule } from "@/lib/task-actions-client";
import { buttonVariants } from "@/components/ui/button";
import { Field, inputClassName } from "@/components/ui/field";
import { useI18n } from "@/i18n/client";

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

function parseDateTime(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || value.trim().length === 0) {
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
  const copy = { ...DEFAULT_COPY, ...(messages.components?.scheduleEditorForm ?? {}) };
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

  async function handleScheduleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const nextDueAt = parseDateTime(formData.get("dueAt"));
    const nextScheduledStartAt = parseDateTime(formData.get("scheduledStartAt"));
    const nextScheduledEndAt = parseDateTime(formData.get("scheduledEndAt"));

    if (!nextDueAt && !nextScheduledStartAt && !nextScheduledEndAt) {
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

  async function handleClearSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await runAction(async () => {
      await clearSchedule({ taskId });
    });
  }

  return (
    <div className="space-y-2">
      {errorMessage ? <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}

      <form onSubmit={(event) => void handleScheduleSubmit(event)} className="grid gap-2 md:grid-cols-3">
        <Field label={copy.due} className="text-xs text-muted-foreground">
          <input
            type="datetime-local"
            name="dueAt"
            defaultValue={formatDateTimeInput(dueAt)}
            className={inputClassName}
          />
        </Field>
        <Field label={copy.start} className="text-xs text-muted-foreground">
          <input
            type="datetime-local"
            name="scheduledStartAt"
            defaultValue={formatDateTimeInput(scheduledStartAt)}
            className={inputClassName}
          />
        </Field>
        <Field label={copy.end} className="text-xs text-muted-foreground">
          <input
            type="datetime-local"
            name="scheduledEndAt"
            defaultValue={formatDateTimeInput(scheduledEndAt)}
            className={inputClassName}
          />
        </Field>
        <div className="flex flex-wrap gap-2 md:col-span-3">
          <button type="submit" disabled={isPending} className={buttonVariants({ variant: "default" })}>
            {isPending ? copy.saving : submitLabel}
          </button>
        </div>
      </form>

      {allowClear ? (
        <form onSubmit={(event) => void handleClearSubmit(event)}>
          <button type="submit" disabled={isPending} className={buttonVariants({ variant: "outline" })}>
            {isPending ? copy.updating : copy.clearSchedule}
          </button>
        </form>
      ) : null}
    </div>
  );
}
