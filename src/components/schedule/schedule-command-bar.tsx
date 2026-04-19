"use client";

import { Loader2, Sparkles, Wrench } from "lucide-react";
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
import { useAutoComplete, type StructuredSuggestion } from "@/hooks/use-ai";

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
  /** Suppress auto-complete after applying a suggestion until next manual input */
  const suppressRef = useRef(false);

  /* ---- AI auto-complete ---- */
  const {
    structuredSuggestions,
    isLoading: aiLoading,
    phase,
    statusMessage,
    toolCalls,
  } = useAutoComplete(
    !suppressRef.current && value.trim().length >= 3 ? value.trim() : null,
  );

  const showPanel = showSuggestions && (
    (structuredSuggestions?.length ?? 0) > 0 ||
    (aiLoading && phase !== "idle")
  );

  function handleSelectSuggestion(structured: StructuredSuggestion) {
    const { action } = structured;
    suppressRef.current = true;
    setValue(action.title);
    setShowSuggestions(false);

    // Auto-submit with AI-suggested data
    const now = new Date();
    const referenceDate = toDateForDay(
      selectedDay,
      now.getHours() * 60 + now.getMinutes(),
    );
    const draft = buildQuickCreateDraft({
      title: action.title,
      selectedDay,
      now: referenceDate,
      priority: action.priority,
    });

    // If the suggestion has a scheduled slot, use it
    if (action.scheduledStartAt && action.scheduledEndAt) {
      draft.scheduledStartAt = new Date(action.scheduledStartAt);
      draft.scheduledEndAt = new Date(action.scheduledEndAt);
    }

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
              suppressRef.current = false;
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

          {/* AI Auto-complete dropdown with streaming state */}
          {showPanel ? (
            <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-border/60 bg-background shadow-lg">
              {/* Header */}
              <div className="flex items-center gap-1.5 border-b border-border/40 px-3 py-1.5 text-[11px] text-muted-foreground">
                <Sparkles className="size-3 text-primary" />
                AI suggestions
                {aiLoading && (
                  <Loader2 className="ml-auto size-3 animate-spin text-muted-foreground" />
                )}
              </div>

              {/* Streaming status */}
              {aiLoading && statusMessage && (
                <div className="flex items-center gap-2 border-b border-border/20 px-3 py-1.5 text-[11px] text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" />
                  <span>{statusMessage}</span>
                </div>
              )}

              {/* Tool calls */}
              {toolCalls?.length > 0 && (
                <div className="border-b border-border/20 px-3 py-1.5">
                  {toolCalls.map((tc, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <Wrench className="size-2.5 text-amber-500" />
                      <span className="font-mono">{tc.tool}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Suggestion list */}
              {(structuredSuggestions ?? []).slice(0, 5).map((s, i) => (
                <button
                  key={`${s.id}-${i}`}
                  type="button"
                  className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition hover:bg-muted/60"
                  onMouseDown={(e) => {
                    e.preventDefault(); // Prevent blur
                    handleSelectSuggestion(s);
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-foreground">{s.action.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{s.summary}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {s.action.estimatedMinutes ? (
                      <span className="text-[10px] text-muted-foreground">{s.action.estimatedMinutes}m</span>
                    ) : null}
                    <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-medium", priorityBadgeColors[s.action.priority] ?? "bg-muted text-muted-foreground")}>
                      {s.action.priority}
                    </span>
                  </div>
                </button>
              ))}

              {/* Loading placeholder when no suggestions yet */}
              {(structuredSuggestions?.length ?? 0) === 0 && aiLoading && (
                <div className="px-3 py-3 text-center text-xs text-muted-foreground">
                  正在生成建议...
                </div>
              )}
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
