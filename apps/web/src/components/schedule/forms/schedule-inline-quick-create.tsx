"use client";

import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";
import { cn } from "@/lib/utils";

export function ScheduleInlineQuickCreate({
  mode,
  selectedDay,
  initialTitle = "",
  initialPriority = "Medium",
  initialStartAt,
  initialDurationMinutes = 60,
  isPending,
  submitLabel,
  hint,
  onCancel,
  onSubmit,
  compact = false,
}: {
  mode: "queue" | "scheduled";
  selectedDay: string;
  initialTitle?: string;
  initialPriority?: "Low" | "Medium" | "High" | "Urgent";
  initialStartAt?: Date | null;
  initialDurationMinutes?: number;
  isPending: boolean;
  submitLabel: string;
  hint?: string;
  onCancel?: () => void;
  onSubmit: (draft: {
    title: string;
    dueAt: Date | null;
    scheduledStartAt: Date | null;
    scheduledEndAt: Date | null;
    priority: "Low" | "Medium" | "High" | "Urgent";
    durationMinutes: number;
  }) => Promise<void>;
  compact?: boolean;
}) {
  const initialHour = initialStartAt?.getHours() ?? 9;
  const initialMinute = initialStartAt?.getMinutes() ?? 0;
  const [expanded, setExpanded] = useState(!compact);
  const [title, setTitle] = useState(initialTitle);
  const [priority, setPriority] = useState<"Low" | "Medium" | "High" | "Urgent">(initialPriority);
  const [timeValue, setTimeValue] = useState(
    `${String(initialHour).padStart(2, "0")}:${String(initialMinute).padStart(2, "0")}`,
  );
  const [durationMinutes, setDurationMinutes] = useState(initialDurationMinutes);

  async function handleSubmit() {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      return;
    }

    if (mode === "queue") {
      await onSubmit({
        title: normalizedTitle,
        dueAt: null,
        scheduledStartAt: null,
        scheduledEndAt: null,
        priority,
        durationMinutes,
      });
      setTitle("");
      return;
    }

    const [hoursText = "09", minutesText = "00"] = timeValue.split(":");
    const startAt = new Date(`${selectedDay}T${hoursText.padStart(2, "0")}:${minutesText.padStart(2, "0")}:00`);
    const endAt = new Date(startAt.getTime() + durationMinutes * 60 * 1000);

    await onSubmit({
      title: normalizedTitle,
      dueAt: null,
      scheduledStartAt: startAt,
      scheduledEndAt: endAt,
      priority,
      durationMinutes,
    });
    setTitle("");
  }

  if (compact && !expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="flex w-full items-center justify-between rounded-2xl border border-border/70 bg-background/80 px-4 py-3 text-left transition hover:border-primary/30 hover:bg-background"
      >
        <div className="flex items-center gap-3">
          <span className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Plus className="size-4" />
          </span>
          <div>
            <p className="text-sm font-medium text-foreground">Quick create</p>
            <p className="text-xs text-muted-foreground">Open a compact composer</p>
          </div>
        </div>
        <ChevronRight className="size-4 text-muted-foreground" />
      </button>
    );
  }

  return (
    <SurfaceCard as="div" variant="inset" padding="sm" className="space-y-3 rounded-[24px] border-border/70 bg-background/85">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">
            {mode === "queue" ? "Create task" : "Add event"}
          </p>
          {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        {compact ? (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
            aria-label="Collapse create task form"
          >
            <ChevronDown className="size-4" />
          </button>
        ) : null}
      </div>

      <input
        aria-label="Title"
        value={title}
        disabled={isPending}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && onCancel) {
            event.preventDefault();
            onCancel();
            if (compact) {
              setExpanded(false);
            }
          }
          if (event.key === "Enter") {
            event.preventDefault();
            void handleSubmit();
          }
        }}
        placeholder={mode === "queue" ? "Add a task to the queue" : "Add title and time"}
        className="h-11 w-full rounded-2xl border border-border/70 bg-background px-4 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary/40 focus-visible:ring-4 focus-visible:ring-primary/10"
      />

      <div className="grid gap-2 md:grid-cols-2">
        {mode === "scheduled" ? (
          <input
            type="time"
            aria-label="Custom time"
            value={timeValue}
            disabled={isPending}
            onChange={(event) => setTimeValue(event.target.value)}
            className="h-10 w-full rounded-2xl border border-border/70 bg-background px-3 text-sm outline-none transition focus:border-primary/40"
          />
        ) : null}
        <select
          aria-label="Duration"
          value={String(durationMinutes)}
          disabled={isPending}
          onChange={(event) => setDurationMinutes(Number(event.target.value))}
          className="h-10 w-full rounded-2xl border border-border/70 bg-background px-3 text-sm outline-none transition focus:border-primary/40"
        >
          <option value="30">30 min</option>
          <option value="60">1 hour</option>
          <option value="90">1.5 hours</option>
          <option value="120">2 hours</option>
        </select>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["Low", "Medium", "High", "Urgent"] as const).map((option) => (
          <button
            key={option}
            type="button"
            disabled={isPending}
            onClick={() => setPriority(option)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs transition",
              priority === option
                ? "border-primary/25 bg-primary/10 text-primary"
                : "border-border/70 bg-background text-muted-foreground hover:text-foreground",
            )}
          >
            {option}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-end gap-2">
        {onCancel ? (
          <button type="button" disabled={isPending} onClick={onCancel} className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Cancel
          </button>
        ) : null}
        <button
          type="button"
          disabled={isPending || title.trim().length === 0}
          onClick={() => {
            void handleSubmit();
          }}
          className={cn(buttonVariants({ variant: "default", size: "sm" }), "rounded-full")}
        >
          {submitLabel}
        </button>
      </div>
    </SurfaceCard>
  );
}
