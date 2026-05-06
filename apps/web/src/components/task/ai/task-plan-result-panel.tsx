import { AlertTriangle, Check, CheckCircle2, Clock, RotateCcw, Scissors } from "lucide-react";

import { TaskPlanGraph } from "@/components/task/plan/task-plan-graph";
import type { TaskPlanReadModel } from "@chrona/contracts/ai";

type TaskPlanResultPanelProps = {
  activeReadModel: TaskPlanReadModel;
  planGraph: Parameters<typeof TaskPlanGraph>[0]["plan"];
  graphSummary: {
    totalEstimatedMinutes: number;
    nodeCount: number;
    warnings: string[];
  };
  isAppliedPlan: boolean;
  onRegenerate: () => void;
  onApply?: (result: TaskPlanReadModel) => Promise<void> | void;
};

export function TaskPlanResultPanel({
  activeReadModel,
  planGraph,
  graphSummary,
  isAppliedPlan,
  onRegenerate,
  onApply,
}: TaskPlanResultPanelProps) {
  return (
    <div className="space-y-3 rounded-xl border border-transparent bg-transparent p-0">
      <div className="flex items-center justify-end gap-3">
        <span className="sr-only">AI Task Planning</span>
        <button
          type="button"
          onClick={onRegenerate}
          className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-background/80 px-3 py-1 text-xs font-medium text-primary transition hover:bg-primary/10"
        >
          <RotateCcw className="size-3.5" />
          Regenerate plan
        </button>
      </div>

      <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
        <div className="flex items-center gap-2 rounded-2xl border border-border/50 bg-background/70 px-3 py-2 shadow-sm">
          <span className="flex size-7 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Clock className="size-3.5" />
          </span>
          <span className="font-medium text-foreground">
            {graphSummary.totalEstimatedMinutes} min
          </span>
        </div>
        <div className="flex items-center gap-2 rounded-2xl border border-border/50 bg-background/70 px-3 py-2 shadow-sm">
          <span className="flex size-7 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Scissors className="size-3.5" />
          </span>
          <span className="font-medium text-foreground">
            {graphSummary.nodeCount} nodes
          </span>
        </div>
      </div>

      {graphSummary.warnings.length > 0 ? (
        <div className="space-y-1">
          {graphSummary.warnings.map((warning, index) => (
            <div
              key={index}
              className="flex items-start gap-2 text-xs text-amber-700"
            >
              <AlertTriangle className="mt-0.5 size-3 shrink-0" />
              <span>{warning}</span>
            </div>
          ))}
        </div>
      ) : null}

      {isAppliedPlan ? (
        <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/80 px-3 py-2.5 text-xs font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10">
            <CheckCircle2 className="size-4" />
          </span>
          <span>Active in main panel</span>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border border-border/40 bg-background/60 p-3">
            <TaskPlanGraph plan={planGraph} />
          </div>

          {onApply ? (
            <div className="flex justify-end rounded-lg border border-border/40 bg-background/70 px-3 py-2">
              <button
                type="button"
                onClick={() => onApply(activeReadModel)}
                className="flex items-center justify-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary transition hover:bg-primary/20"
              >
                <Check className="size-4" />
                Apply Plan
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
