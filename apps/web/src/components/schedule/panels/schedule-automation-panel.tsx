import type {
  ScheduleAutomationCandidate,
  SchedulePageData,
} from "@/components/schedule/schedule-page-types";
import type { SchedulePageCopy } from "@/components/schedule/schedule-page-copy";
import { EmptyState } from "./schedule-panel-primitives";

type Props = {
  candidates: ScheduleAutomationCandidate[];
  recordsByTaskId: Map<string, SchedulePageData["listItems"][number]>;
  copy: SchedulePageCopy;
  isPending: boolean;
  onRunCandidate: (taskId: string) => Promise<void>;
};

function sortCandidates(candidates: ScheduleAutomationCandidate[]) {
  const priorityRank = { high: 0, medium: 1, low: 2 } as const;
  return [...candidates].sort((left, right) => {
    const leftRank = priorityRank[left.priority];
    const rightRank = priorityRank[right.priority];
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    return left.taskId.localeCompare(right.taskId);
  });
}

export function ScheduleAutomationPanel({
  candidates,
  recordsByTaskId,
  copy,
  isPending,
  onRunCandidate,
}: Props) {
  if (candidates.length === 0) {
    return <EmptyState>{copy.automationEmpty}</EmptyState>;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {copy.automationBackendOnlyHint}
      </p>
      {sortCandidates(candidates).map((candidate) => {
        const record = recordsByTaskId.get(candidate.taskId);
        const runtimeKey =
          record?.runtimeAdapterKey ??
          (typeof (record?.runtimeInput as { adapterKey?: unknown } | undefined)
            ?.adapterKey === "string"
            ? String(
                (record?.runtimeInput as { adapterKey?: unknown }).adapterKey,
              )
            : null);
        const canRun =
          candidate.kind === "auto_run" && runtimeKey === "openclaw";

        return (
          <div
            key={`${candidate.kind}:${candidate.taskId}`}
            className="rounded-2xl border border-border/60 bg-background/80 p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {record?.title ?? candidate.taskId}
                </p>
                <p className="text-xs text-muted-foreground">
                  {candidate.reason}
                </p>
              </div>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {candidate.priority}
              </span>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{candidate.kind}</span>
              {record?.runtimeAdapterKey ? (
                <span>· {record.runtimeAdapterKey}</span>
              ) : null}
              {record?.runnabilitySummary ? (
                <span>· {record.runnabilitySummary}</span>
              ) : null}
              {candidate.executionMode ? (
                <span>· {candidate.executionMode}</span>
              ) : null}
              {candidate.sessionStrategy ? (
                <span>· {candidate.sessionStrategy}</span>
              ) : null}
              {candidate.readyNodeIds?.length ? (
                <span>· {candidate.readyNodeIds.length} ready nodes</span>
              ) : null}
            </div>

            {candidate.kind === "auto_run" ? (
              <div className="mt-3">
                <button
                  type="button"
                  className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => void onRunCandidate(candidate.taskId)}
                  disabled={!canRun || isPending}
                  title={
                    !canRun ? copy.automationUnsupportedRuntime : undefined
                  }
                >
                  {copy.automationRunNow}
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
