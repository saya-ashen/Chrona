import type {
  ScheduleConflict,
  ScheduleSuggestion,
} from "@/components/schedule/schedule-page-types";
import { SurfaceCard } from "@/components/ui/surface-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { useI18n } from "@/i18n/client";

type ConflictCardProps = {
  conflict: ScheduleConflict;
  suggestions: ScheduleSuggestion[];
  onApplySuggestion?: (suggestion: ScheduleSuggestion) => void;
  isPending?: boolean;
};

const DEFAULT_COPY = {
  timeRange: "Time range",
  suggestions: "Suggested solutions",
  reason: "Reason",
  applying: "Applying...",
  applySuggestion: "Apply Suggestion",
  conflictTypes: {
    time_overlap: "Time Overlap",
    overload: "Overload",
    fragmentation: "Fragmentation",
    dependency: "Dependency Conflict",
  } as Record<string, string>,
  suggestionTypes: {
    reschedule: "Reschedule",
    split: "Split Task",
    merge: "Merge Tasks",
    defer: "Defer Task",
    reorder: "Reorder",
  } as Record<string, string>,
};

function getCopy(messages: Record<string, unknown>) {
  const raw = (messages.components as Record<string, Record<string, unknown>> | undefined)?.conflictCard ?? {};
  return {
    timeRange: (raw.timeRange as string) ?? DEFAULT_COPY.timeRange,
    suggestions: (raw.suggestions as string) ?? DEFAULT_COPY.suggestions,
    reason: (raw.reason as string) ?? DEFAULT_COPY.reason,
    applying: (raw.applying as string) ?? DEFAULT_COPY.applying,
    applySuggestion: (raw.applySuggestion as string) ?? DEFAULT_COPY.applySuggestion,
    conflictTypes: { ...DEFAULT_COPY.conflictTypes, ...(raw.conflictTypes as Record<string, string> | undefined) },
    suggestionTypes: { ...DEFAULT_COPY.suggestionTypes, ...(raw.suggestionTypes as Record<string, string> | undefined) },
    resolvedConflicts: (raw.resolvedConflicts as string) ?? "Resolve {count} conflicts",
    movedTasks: (raw.movedTasks as string) ?? "Move {count} tasks",
  };
}

export function ConflictCard({
  conflict,
  suggestions,
  onApplySuggestion,
  isPending,
}: ConflictCardProps) {
  const { messages } = useI18n();
  const copy = getCopy(messages as Record<string, unknown>);

  const severityTone =
    conflict.severity === "high"
      ? "critical"
      : conflict.severity === "medium"
        ? "warning"
        : "neutral";

  const conflictSuggestions = suggestions.filter(
    (s) => s.conflictId === conflict.id,
  );

  return (
    <SurfaceCard className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <StatusBadge tone={severityTone}>
              {conflict.severity.toUpperCase()}
            </StatusBadge>
            <span className="text-sm font-medium text-foreground">
              {copy.conflictTypes[conflict.type] || conflict.type}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {conflict.description}
          </p>
        </div>
      </div>

      {conflict.timeRange && (
        <div className="text-xs text-muted-foreground">
          {copy.timeRange}:{" "}
          {conflict.timeRange.start.toLocaleTimeString("zh-CN", {
            hour: "2-digit",
            minute: "2-digit",
          })}{" "}
          -{" "}
          {conflict.timeRange.end.toLocaleTimeString("zh-CN", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      )}

      {conflictSuggestions.length > 0 && (
        <div className="space-y-2 border-t border-border pt-3">
          <div className="text-xs font-medium text-muted-foreground">
            {copy.suggestions}
          </div>
          {conflictSuggestions.map((suggestion) => (
            <div
              key={suggestion.id}
              className="space-y-2 rounded-md border border-border bg-surface-secondary p-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="text-sm font-medium text-foreground">
                    {copy.suggestionTypes[suggestion.type] || suggestion.type}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {suggestion.description}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {copy.reason}: {suggestion.reason}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <div className="flex gap-3">
                  <span>
                    {copy.resolvedConflicts.replace("{count}", String(suggestion.estimatedImpact.resolvedConflicts))}
                  </span>
                  <span>{copy.movedTasks.replace("{count}", String(suggestion.estimatedImpact.movedTasks))}</span>
                </div>
                {onApplySuggestion && (
                  <button
                    type="button"
                    onClick={() => onApplySuggestion(suggestion)}
                    disabled={isPending}
                    className="rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {isPending ? copy.applying : copy.applySuggestion}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </SurfaceCard>
  );
}
