import { Check, Loader2, Sparkles } from "lucide-react";
import { TaskPlanGraphPanel } from "@/components/tasks/panels/task-plan-graph-panel";
import type { PlanNodeDataModel } from "@/components/tasks/plan/task-plan-graph/types";
import type { TaskPlanGraphPlan } from "@/components/tasks/plan/task-plan-graph/types";
import { buttonVariants } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";
import type { TaskPlanReadModel } from "@chrona/contracts/ai";
import type { TaskPlanGenerationStatus } from "../model/task-workspace-types";

type TaskWorkspacePlanContentProps = {
  label: string;
  graphPlan: TaskPlanGraphPlan | null;
  plan: TaskPlanReadModel | null;
  canAcceptPlan: boolean;
  isAcceptingPlan: boolean;
  acceptPlanError: string | null;
  planGenerationStatus: TaskPlanGenerationStatus;
  onGeneratePlan: () => void;
  onAcceptPlan: () => void | Promise<void>;
  onSelectedNodeChange: (node: PlanNodeDataModel | null, nodes: PlanNodeDataModel[]) => void;
};

export function TaskWorkspacePlanContent({
  label,
  graphPlan,
  plan,
  canAcceptPlan,
  isAcceptingPlan,
  acceptPlanError,
  planGenerationStatus,
  onGeneratePlan,
  onAcceptPlan,
  onSelectedNodeChange,
}: TaskWorkspacePlanContentProps) {
  const planSummary = graphPlan && plan
    ? `${plan.status} / ${graphPlan.nodes.length} steps / ${graphPlan.nodes.reduce((sum, node) => sum + (node.estimatedMinutes ?? 0), 0)} min`
    : null;
  const isGeneratingPlan = planGenerationStatus === "generating";
  const generatePlanButton = (
    <button
      type="button"
      disabled={isGeneratingPlan}
      onClick={onGeneratePlan}
      className={buttonVariants({ variant: "secondary", size: "sm", className: "rounded-xl" })}
    >
      {isGeneratingPlan ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
      {isGeneratingPlan ? "Generating..." : plan ? "Regenerate plan" : "Generate plan"}
    </button>
  );

  return (
    <div className="h-full min-h-0 space-y-1">
      {graphPlan && plan ? (
        <>
          <TaskPlanGraphPanel
            label={label}
            plan={graphPlan}
            summary={planSummary}
            className="h-[480px] min-w-0 md:h-[640px] xl:h-full"
            fillHeight
            inspectorPlacement="none"
            dismissSelectionOnOutsideClick={false}
            onSelectedNodeChange={onSelectedNodeChange}
            actions={(
              <div className="flex flex-wrap items-center justify-end gap-2">
                {generatePlanButton}
                {canAcceptPlan ? (
                  <button
                    type="button"
                    disabled={isAcceptingPlan}
                    onClick={() => void onAcceptPlan()}
                    className={buttonVariants({ variant: "default", size: "sm", className: "rounded-xl" })}
                  >
                    {isAcceptingPlan ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                    {isAcceptingPlan ? "Accepting..." : "Accept Plan"}
                  </button>
                ) : null}
              </div>
            )}
          />
          {acceptPlanError ? <p className="text-xs text-red-600">{acceptPlanError}</p> : null}
        </>
      ) : (
        <SurfaceCard
          variant="inset"
          padding="sm"
          className="flex h-[420px] min-w-0 flex-col rounded-[1rem] border-border/50 bg-background/65 shadow-none ring-0 md:h-[560px] xl:h-full"
        >
          <div className="mb-1 flex min-w-0 items-center justify-between gap-2 px-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary/80">{label}</p>
            {generatePlanButton}
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center rounded-[1rem] border border-dashed border-border/60 bg-background/40 px-5 text-center text-sm text-muted-foreground">
            The plan graph will appear here once AI generates a plan.
          </div>
        </SurfaceCard>
      )}
    </div>
  );
}
