"use client";

import { useMemo, useState } from "react";
import { DEFAULT_SCHEDULE_PAGE_COPY, getSchedulePageCopy } from "@/components/schedule/schedule-page-copy";
import type { QuickCreateDraft } from "@/components/schedule/schedule-page-types";
import {
  buildQuickCreateDraft,
  parseQuickCreateCommand,
  toDateForDay,
} from "@/components/schedule/schedule-page-utils";
import { buttonVariants } from "@/components/ui/button";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";

export function ScheduleCommandBar({
  selectedDay,
  isPending,
  onSubmit,
}: {
  selectedDay: string;
  isPending: boolean;
  onSubmit: (draft: QuickCreateDraft) => Promise<void>;
}) {
  const { messages } = useI18n();
  const copy = useMemo(
    () => getSchedulePageCopy(messages.components?.schedulePage),
    [messages.components?.schedulePage],
  );
  const [value, setValue] = useState("");

  async function handleSubmit() {
    const normalized = value.trim();

    if (!normalized) {
      return;
    }

    const now = new Date();
    const referenceDate = toDateForDay(
      selectedDay,
      now.getHours() * 60 + now.getMinutes(),
    );
    const parsed = parseQuickCreateCommand(normalized, referenceDate);
    const draft =
      parsed && parsed.scheduledStartAt && parsed.scheduledEndAt
        ? parsed
        : buildQuickCreateDraft({
            title: parsed?.title || normalized,
            selectedDay,
            now: referenceDate,
            priority: parsed?.priority,
          });

    await onSubmit(draft);
    setValue("");
  }

  return (
    <div className="rounded-2xl border border-border/60 bg-background/70 p-3 shadow-sm">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <input
          value={value}
          disabled={isPending}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void handleSubmit();
            }
          }}
          placeholder={copy.quickCreatePlaceholder}
          className="h-10 flex-1 rounded-xl border border-border bg-background px-3 text-sm outline-none ring-0 transition focus:border-primary/50"
        />
        <button
          type="button"
          disabled={isPending || value.trim().length === 0}
          onClick={() => {
            void handleSubmit();
          }}
          className={cn(buttonVariants({ variant: "default", size: "sm" }), "h-10 rounded-xl px-4")}
        >
          {copy.quickCreateSubmit}
        </button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {copy.quickCreateHint || DEFAULT_SCHEDULE_PAGE_COPY.quickCreateHint}
      </p>
    </div>
  );
}
