"use client";

import { AlertCircle, Calendar, Clock, MapPin, Star } from "lucide-react";
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { suggestTimeslots } from "@chrona/shared";
import type {
  ScheduleSlot,
  TimeslotSuggestion,
  TimeslotSuggestionResult,
} from "@chrona/contracts/ai";

/**
 * Format a Date as a compact time string (HH:MM).
 */
function fmtTime(d: Date): string {
  const h = d.getUTCHours().toString().padStart(2, "0");
  const m = d.getUTCMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

/**
 * Format a time range as "HH:MM – HH:MM".
 */
function fmtRange(start: Date, end: Date): string {
  return `${fmtTime(start)} – ${fmtTime(end)}`;
}

/**
 * Map a score (0-100) to a colour class for the progress bar.
 */
function scoreColor(score: number): string {
  if (score >= 80) return "bg-green-500";
  if (score >= 60) return "bg-amber-500";
  if (score >= 40) return "bg-orange-500";
  return "bg-red-500";
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TimeslotSuggestionPanelProps {
  taskId: string;
  title: string;
  priority: string;
  estimatedMinutes: number;
  dueAt?: Date | null;
  currentSchedule: ScheduleSlot[];
  /** Called when the user picks a suggestion. */
  onSchedule?: (startAt: Date, endAt: Date) => void;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SuggestionRow({
  suggestion,
  isBest,
  onSchedule,
}: {
  suggestion: TimeslotSuggestion;
  isBest: boolean;
  onSchedule?: (startAt: Date, endAt: Date) => void;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2.5 text-sm transition",
        isBest
          ? "border-primary/40 bg-primary/5"
          : "border-border/60 bg-background/80",
      )}
    >
      {/* Top row: time + best badge */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-medium text-foreground">
          <Clock className="size-3.5 text-muted-foreground" />
          {fmtRange(new Date(suggestion.startAt), new Date(suggestion.endAt))}
          {isBest ? (
            <span className="ml-1 inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
              <Star className="size-3" />
              Best
            </span>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() =>
            onSchedule?.(
              new Date(suggestion.startAt),
              new Date(suggestion.endAt),
            )
          }
          className={cn(
            "shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition",
            isBest
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "border border-border/60 bg-background text-foreground hover:border-primary/40 hover:text-primary",
          )}
        >
          <MapPin className="mr-1 inline-block size-3" />
          Schedule Here
        </button>
      </div>

      {/* Score bar */}
      <div className="mt-2 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full transition-all", scoreColor(suggestion.score))}
            style={{ width: `${Math.max(suggestion.score, 2)}%` }}
          />
        </div>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {suggestion.score}
        </span>
      </div>

      {/* Reasons (tags) */}
      {suggestion.reasons.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {suggestion.reasons.map((r) => (
            <span
              key={r}
              className="inline-block rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
            >
              {r}
            </span>
          ))}
        </div>
      ) : null}

      {/* Conflicts (warnings) */}
      {suggestion.conflicts.length > 0 ? (
        <div className="mt-1.5 space-y-0.5">
          {suggestion.conflicts.map((c) => (
            <p
              key={c}
              className="flex items-start gap-1 text-[11px] text-red-600"
            >
              <AlertCircle className="mt-0.5 size-3 shrink-0" />
              {c}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function TimeslotSuggestionPanel({
  taskId,
  title,
  priority,
  estimatedMinutes,
  dueAt,
  currentSchedule,
  onSchedule,
}: TimeslotSuggestionPanelProps) {
  const result: TimeslotSuggestionResult = useMemo(
    () =>
      suggestTimeslots({
        taskId,
        title,
        priority,
        estimatedMinutes,
        dueAt: dueAt ?? undefined,
        currentSchedule,
      }),
    [taskId, title, priority, estimatedMinutes, dueAt, currentSchedule],
  );

  const { suggestions, bestMatch } = result;

  // Empty state — no usable suggestions
  if (suggestions.length === 0 || (suggestions.length === 1 && suggestions[0].score === 0)) {
    return (
      <div className="space-y-2 rounded-xl border border-primary/20 bg-primary/5 p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-primary">
          <Calendar className="size-4" />
          Suggested Time Slots
        </div>
        <p className="text-xs text-muted-foreground">
          {suggestions.length === 1 && suggestions[0].conflicts.length > 0
            ? suggestions[0].conflicts[0]
            : "No suitable time slots found for this task. Try adjusting the estimated duration or schedule."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
      {/* Header */}
      <div className="flex items-center gap-2 text-sm font-medium text-primary">
        <Calendar className="size-4" />
        Suggested Time Slots
      </div>

      {/* Suggestions list */}
      <div className="space-y-2">
        {suggestions.map((s) => (
          <SuggestionRow
            key={`${new Date(s.startAt).getTime()}-${new Date(s.endAt).getTime()}`}
            suggestion={s}
            isBest={
              bestMatch !== null &&
              new Date(s.startAt).getTime() === new Date(bestMatch.startAt).getTime() &&
              new Date(s.endAt).getTime() === new Date(bestMatch.endAt).getTime()
            }
            onSchedule={onSchedule}
          />
        ))}
      </div>
    </div>
  );
}
