import { suggestTimeslots } from "@chrona/shared";
import type { ScheduleSlot } from "@chrona/contracts"

type TimeslotSuggestionPanelProps = {
  taskId: string;
  title: string;
  priority: string;
  estimatedMinutes: number;
  dueAt?: Date | null;
  currentSchedule: ScheduleSlot[];
  onSchedule?: (startAt: Date, endAt: Date) => void;
};

function formatTimeRange(startAt: Date, endAt: Date) {
  return `${startAt.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })} - ${endAt.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

export function TimeslotSuggestionPanel({
  taskId,
  title,
  priority,
  estimatedMinutes,
  dueAt,
  currentSchedule,
  onSchedule,
}: TimeslotSuggestionPanelProps) {
  const { suggestions, bestMatch } = suggestTimeslots({
    taskId,
    title,
    priority,
    estimatedMinutes,
    dueAt,
    currentSchedule,
  });

  return (
    <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold text-foreground">
        Suggested Time Slots
      </h3>

      {suggestions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No suitable time slots found for this task. Try adjusting the estimated
          duration or schedule.
        </p>
      ) : (
        <div className="space-y-2">
          {suggestions.map((suggestion) => {
            const isBest =
              bestMatch !== null &&
              bestMatch.startAt.getTime() === suggestion.startAt.getTime() &&
              bestMatch.endAt.getTime() === suggestion.endAt.getTime();

            return (
              <div
                key={`${suggestion.startAt.toISOString()}-${suggestion.endAt.toISOString()}`}
                className="rounded-md border border-border bg-surface-secondary p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {formatTimeRange(suggestion.startAt, suggestion.endAt)}
                      </span>
                      {isBest && (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                          Best
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                      {suggestion.reasons.map((reason) => (
                        <span key={reason}>{reason}</span>
                      ))}
                      {suggestion.conflicts.map((conflict) => (
                        <span key={conflict}>{conflict}</span>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">
                      {suggestion.score}
                    </span>
                    <button
                      type="button"
                      className="rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground"
                      onClick={() =>
                        onSchedule?.(suggestion.startAt, suggestion.endAt)
                      }
                    >
                      Schedule
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
