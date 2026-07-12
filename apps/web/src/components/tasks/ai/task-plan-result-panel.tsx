import { AlertTriangle, Check, RotateCcw } from "lucide-react";

import { Button } from "shared/ui/button";
import { TaskPlanGraph } from "@/components/tasks/plan/task-plan-graph";
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
  showGraph?: boolean;
  showRegenerateButton?: boolean;
};

export function TaskPlanResultPanel({
  activeReadModel,
  planGraph,
  graphSummary,
  isAppliedPlan,
  onRegenerate,
  onApply,
  showGraph = true,
  showRegenerateButton = true,
}: TaskPlanResultPanelProps) {
  const graphRenderKey = `${activeReadModel.id}:${activeReadModel.revision}:${activeReadModel.status}:${activeReadModel.updatedAt}`;

  return (
    <div className="space-y-3 rounded-xl border border-transparent bg-transparent p-0">
      {showRegenerateButton ? (
        <div className="flex items-center justify-end gap-3">
          <Button
            type="button"
            onClick={onRegenerate}
            variant="outline"
            size="sm"
            className="rounded-full border-primary/20 bg-background/80 text-primary hover:bg-primary/10"
          >
            <RotateCcw className="size-3.5" />
            Regenerate plan
          </Button>
        </div>
      ) : null}

      {graphSummary.warnings.length > 0 ? (
        <div className="space-y-1">
          {graphSummary.warnings.map((warning, index) => (
            <div
              key={index}
              className="flex items-start gap-2 text-xs text-warning-foreground"
            >
              <AlertTriangle className="mt-0.5 size-3 shrink-0" />
              <span>{warning}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="sr-only">
        <span>{graphSummary.totalEstimatedMinutes} min</span>
      </div>

      {isAppliedPlan ? (
        showGraph ? (
          <div
            key={graphRenderKey}
            className="overflow-hidden rounded-lg border border-border/40 bg-background/60 p-3"
          >
            <TaskPlanGraph plan={planGraph} />
          </div>
        ) : null
      ) : (
        <>
          {showGraph ? (
            <div
              key={graphRenderKey}
              className="overflow-hidden rounded-lg border border-border/40 bg-background/60 p-3"
            >
              <TaskPlanGraph plan={planGraph} />
            </div>
          ) : null}

          {onApply ? (
            <div className="flex justify-end rounded-lg border border-border/40 bg-background/70 px-3 py-2">
              <Button
                type="button"
                onClick={() => onApply(activeReadModel)}
                variant="default"
                size="sm"
                className="rounded-xl"
              >
                <Check className="size-4" />
                Apply Plan
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
