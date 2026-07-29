import { useState } from "react";
import { Sparkles } from "lucide-react";
import { useI18n } from "@chrona/i18n";
import type { TaskPlanReadModel } from "@chrona/contracts";
import { Button } from "@shared/ui";
import type { TaskPlanGraphPlan } from "../plan/task-plan-graph/types";
import { TaskPlanGraphPanel } from "../panels/task-plan-graph-panel";
import type { TaskPlanGenerationStatus } from "../model/task-workspace-types";
import { TaskWorkspacePlanBrief, type PlanContentCopy } from "./task-workspace-plan-brief";
import { PlanContentBody } from "./task-workspace-plan-content-views";
const DEFAULT_COPY = {
  generatePlan: "Generate plan",
  regeneratePlan: "Regenerate plan",
  generating: "Generating...",
  preparingPlanGraph: "Preparing plan graph...",
  planGraphPlaceholder: "The plan graph will appear here once AI generates a plan.",
  graphModeLabel: "Graph display mode",
  graphFullMode: "Full graph",
  graphCompactMode: "Focus map",
  graphFullHint: "Dependencies and all paths",
  graphCompactHint: "Current path and blockers",
  planGoal: "Goal",
  planSummaryLabel: "Summary",
  planAssumptions: "Assumptions",
  planSteps: "Execution steps",
  planStepsView: "Steps",
  planFlowView: "Flow",
  planFlowHint: "Inspect dependencies and branches",
};

type TaskWorkspacePlanContentProps = {
  label: string;
  graphPlan: TaskPlanGraphPlan | null;
  isGraphPlanPending: boolean;
  plan: TaskPlanReadModel | null;
  acceptPlanError: string | null;
  planWorkbenchMode?: "review" | "accepted";
  planGenerationStatus: TaskPlanGenerationStatus;
  graphMode: "full" | "compact";
  onGraphModeChange: (mode: "full" | "compact") => void;
  onGeneratePlan: () => void;
  onSelectedNodeChange?: Parameters<typeof TaskPlanGraphPanel>[0]["onSelectedNodeChange"];
};


export function TaskWorkspacePlanContent({
  label,
  graphPlan,
  isGraphPlanPending,
  plan,
  acceptPlanError,
  planWorkbenchMode,
  planGenerationStatus,
  graphMode,
  onGraphModeChange,
  onGeneratePlan,
  onSelectedNodeChange,
}: TaskWorkspacePlanContentProps) {
  const { messages } = useI18n();
  const copy = { ...DEFAULT_COPY, ...(messages.components.taskWorkspace) } as PlanContentCopy & typeof DEFAULT_COPY;
  const planSummary = graphPlan && plan
    ? `${plan.status} / ${graphPlan.nodes.length} step${graphPlan.nodes.length === 1 ? "" : "s"} / ${graphPlan.nodes.reduce((sum, node) => sum + (node.estimatedMinutes ?? 0), 0)} min`
    : null;
  const isGeneratingPlan = planGenerationStatus === "generating";
  const [reviewView, setReviewView] = useState<"steps" | "flow">("steps");
  const [isBriefCompact, setIsBriefCompact] = useState(false);
  const usesPlanWorkbench = Boolean(planWorkbenchMode);
  const isReviewingPlan = planWorkbenchMode === "review";
  return (
    <div className="flex min-h-full flex-col">
      {graphPlan && plan ? (
        <>
          <div className="border-b border-border/55 p-3">
            <TaskWorkspacePlanBrief plan={plan} graphPlan={graphPlan} reviewing={isReviewingPlan} compact={isBriefCompact} onCompactChange={setIsBriefCompact} copy={copy} />
          </div>
          <PlanContentBody
            copy={copy}
            graphMode={graphMode}
            graphPlan={graphPlan}
            label={label}
            onGraphModeChange={onGraphModeChange}
            onSelectedNodeChange={onSelectedNodeChange}
            onViewChange={setReviewView}
            planSummary={planSummary}
            reviewing={isReviewingPlan}
            usesPlanWorkbench={usesPlanWorkbench}
            view={reviewView}
          />
          {acceptPlanError ? <p className="border-t border-border/55 px-3 py-2 text-xs text-destructive">{acceptPlanError}</p> : null}
        </>
      ) : (
        <div className="flex h-[520px] min-w-0 max-w-full flex-col md:h-[640px] xl:h-full">
          <div className="flex min-w-0 flex-col gap-2 border-b border-border/55 bg-muted/35 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">{label}</p>
            {isGraphPlanPending || isGeneratingPlan ? null : <Button type="button" onClick={onGeneratePlan} variant="secondary" size="sm" className="rounded-xl"><Sparkles className="size-4" />{plan ? copy.regeneratePlan : copy.generatePlan}</Button>}
          </div>
          <div className="m-2 flex min-h-0 min-w-0 flex-1 items-center justify-center rounded-[1.1rem] border border-dashed border-border bg-background/70 px-5 text-center text-sm text-muted-foreground">
            {isGraphPlanPending ? copy.preparingPlanGraph : copy.planGraphPlaceholder}
          </div>
        </div>
      )}
    </div>
  );
}
