import { applySchedule, clearSchedule } from "@/app/actions/task-actions";
import { buttonVariants } from "@/components/ui/button";
import { Field, inputClassName } from "@/components/ui/field";

type ScheduleEditorFormProps = {
  taskId: string;
  dueAt?: Date | null;
  scheduledStartAt?: Date | null;
  scheduledEndAt?: Date | null;
  scheduleSource?: "human" | "ai" | "system";
  submitLabel?: string;
  allowClear?: boolean;
};

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
}: ScheduleEditorFormProps) {
  async function submitSchedule(formData: FormData) {
    "use server";

    const nextDueAt = parseDateTime(formData.get("dueAt"));
    const nextScheduledStartAt = parseDateTime(formData.get("scheduledStartAt"));
    const nextScheduledEndAt = parseDateTime(formData.get("scheduledEndAt"));

    if (!nextDueAt && !nextScheduledStartAt && !nextScheduledEndAt) {
      throw new Error("At least one scheduling field is required.");
    }

    await applySchedule({
      taskId,
      dueAt: nextDueAt,
      scheduledStartAt: nextScheduledStartAt,
      scheduledEndAt: nextScheduledEndAt,
      scheduleSource,
    });
  }

  async function clearTaskSchedule() {
    "use server";

    await clearSchedule({ taskId });
  }

  return (
    <div className="space-y-2">
      <form action={submitSchedule} className="grid gap-2 md:grid-cols-3">
        <Field label="Due" className="text-xs text-muted-foreground">
          <input
            type="datetime-local"
            name="dueAt"
            defaultValue={formatDateTimeInput(dueAt)}
            className={inputClassName}
          />
        </Field>
        <Field label="Start" className="text-xs text-muted-foreground">
          <input
            type="datetime-local"
            name="scheduledStartAt"
            defaultValue={formatDateTimeInput(scheduledStartAt)}
            className={inputClassName}
          />
        </Field>
        <Field label="End" className="text-xs text-muted-foreground">
          <input
            type="datetime-local"
            name="scheduledEndAt"
            defaultValue={formatDateTimeInput(scheduledEndAt)}
            className={inputClassName}
          />
        </Field>
        <div className="flex flex-wrap gap-2 md:col-span-3">
          <button type="submit" className={buttonVariants({ variant: "default" })}>
            {submitLabel}
          </button>
        </div>
      </form>
      {allowClear ? (
        <form action={clearTaskSchedule}>
          <button type="submit" className={buttonVariants({ variant: "outline" })}>
            Clear Schedule
          </button>
        </form>
      ) : null}
    </div>
  );
}
