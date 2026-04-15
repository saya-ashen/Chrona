import type {
  ScheduleConflict,
  ScheduleSuggestion,
} from "./schedule-page-types";
import { SurfaceCard } from "@/components/ui/surface-card";
import { StatusBadge } from "@/components/ui/status-badge";

type ConflictCardProps = {
  conflict: ScheduleConflict;
  suggestions: ScheduleSuggestion[];
  onApplySuggestion?: (suggestion: ScheduleSuggestion) => void;
  isPending?: boolean;
};

const conflictTypeLabels: Record<string, string> = {
  time_overlap: "时间重叠",
  overload: "工作量过载",
  fragmentation: "碎片化",
  dependency: "依赖冲突",
};

const suggestionTypeLabels: Record<string, string> = {
  reschedule: "重新安排",
  split: "拆分任务",
  merge: "合并任务",
  defer: "延后任务",
  reorder: "调整顺序",
};

export function ConflictCard({
  conflict,
  suggestions,
  onApplySuggestion,
  isPending,
}: ConflictCardProps) {
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
              {conflictTypeLabels[conflict.type] || conflict.type}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {conflict.description}
          </p>
        </div>
      </div>

      {conflict.timeRange && (
        <div className="text-xs text-muted-foreground">
          时间范围:{" "}
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
            建议方案
          </div>
          {conflictSuggestions.map((suggestion) => (
            <div
              key={suggestion.id}
              className="space-y-2 rounded-md border border-border bg-surface-secondary p-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="text-sm font-medium text-foreground">
                    {suggestionTypeLabels[suggestion.type] || suggestion.type}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {suggestion.description}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    原因: {suggestion.reason}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <div className="flex gap-3">
                  <span>
                    解决 {suggestion.estimatedImpact.resolvedConflicts} 个冲突
                  </span>
                  <span>移动 {suggestion.estimatedImpact.movedTasks} 个任务</span>
                </div>
                {onApplySuggestion && (
                  <button
                    type="button"
                    onClick={() => onApplySuggestion(suggestion)}
                    disabled={isPending}
                    className="rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {isPending ? "应用中..." : "应用建议"}
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
