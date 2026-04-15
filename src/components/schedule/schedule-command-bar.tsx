"use client";

import { Sparkles } from "lucide-react";
import { useMemo, useRef, useState } from "react";
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
import { useAutoComplete, type AutoCompleteSuggestion } from "@/hooks/use-ai";

const priorityBadgeColors: Record<string, string> = {
  Low: "bg-green-100 text-green-700",
  Medium: "bg-amber-100 text-amber-700",
  High: "bg-orange-100 text-orange-700",
  Urgent: "bg-red-100 text-red-700",
};

export function ScheduleCommandBar({
  id,
  selectedDay,
  isPending,
  onSubmit,
}: {
  id?: string;
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
  const [showSuggestions, setShowSuggestions] = useState(false);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ---- AI auto-complete ---- */
  const { suggestions } = useAutoComplete(
    value.trim().length >= 3 ? value.trim() : null,
  );

  function handleSelectSuggestion(suggestion: AutoCompleteSuggestion) {
    setValue(suggestion.title);
    setShowSuggestions(false);

    // Auto-submit with AI-suggested data
    const now = new Date();
    const referenceDate = toDateForDay(
      selectedDay,
      now.getHours() * 60 + now.getMinutes(),
    );
    const draft = buildQuickCreateDraft({
      title: suggestion.title,
      selectedDay,
      now: referenceDate,
      priority: suggestion.priority,
    });
    void onSubmit(draft).then(() => setValue(""));
  }

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
    <div id={id} className="rounded-2xl border border-border/60 bg-background/70 p-3 shadow-sm">
      <div className="relative flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <input
            value={value}
            disabled={isPending}
            onChange={(event) => {
              setValue(event.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => {
              blurTimeoutRef.current = setTimeout(() => setShowSuggestions(false), 200);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleSubmit();
              }
              if (event.key === "Escape") {
                setShowSuggestions(false);
              }
            }}
            placeholder={copy.quickCreatePlaceholder}
            className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none ring-0 transition focus:border-primary/50"
          />

          {/* AI Auto-complete dropdown */}
          {showSuggestions && suggestions.length > 0 ? (
            <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-border/60 bg-background shadow-lg">
              <div className="flex items-center gap-1.5 border-b border-border/40 px-3 py-1.5 text-[11px] text-muted-foreground">
                <Sparkles className="size-3 text-primary" />
                AI suggestions
              </div>
              {suggestions.slice(0, 5).map((s, i) => (
                <button
                  key={`${s.title}-${i}`}
                  type="button"
                  className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition hover:bg-muted/60"
                  onMouseDown={(e) => {
                    e.preventDefault(); // Prevent blur
                    handleSelectSuggestion(s);
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-foreground">{s.title}</p>
                    {s.description ? (
                      <p className="truncate text-xs text-muted-foreground">{s.description}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {s.estimatedMinutes ? (
                      <span className="text-[10px] text-muted-foreground">{s.estimatedMinutes}m</span>
                    ) : null}
                    <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-medium", priorityBadgeColors[s.priority] ?? "bg-muted text-muted-foreground")}>
                      {s.priority}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          ) : null}
        </div>

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
