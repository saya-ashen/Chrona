import { Check, Loader2, Sparkles } from "lucide-react";
import type { ExecutionActionInput } from "@chrona/contracts/ai";
import { TaskPlanGraphPanel } from "@/components/task/panels/task-plan-graph-panel";
import type { PlanNodeDataModel } from "@/components/task/plan/task-plan-graph/types";
import type { TaskPlanGraphPlan } from "@/components/task/plan/task-plan-graph/types";
import { buttonVariants } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";
import type { TaskExecutionDispatchResult } from "./task-workspace-query";
import type { TaskPlanGenerationStatus } from "./task-workspace-types";
import type { TaskPlanReadModel } from "@chrona/contracts/ai";

type TaskWorkspacePlanContentProps = {
  label: string;
  graphPlan: TaskPlanGraphPlan | null;
  plan: TaskPlanReadModel | null;
  canAcceptPlan: boolean;
  isAcceptingPlan: boolean;
  acceptPlanError: string | null;
  planGenerationStatus: TaskPlanGenerationStatus;
  onAcceptPlan: () => void | Promise<void>;
  onGeneratePlan: () => void;
  onDispatchExecutionAction: (action: ExecutionActionInput) => Promise<TaskExecutionDispatchResult>;
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
  onAcceptPlan,
  onGeneratePlan,
  onDispatchExecutionAction: _onDispatchExecutionAction,
  onSelectedNodeChange,
}: TaskWorkspacePlanContentProps) {
  void _onDispatchExecutionAction;
  const planSummary = graphPlan && plan
    ? `${plan.status} / ${graphPlan.nodes.length} steps / ${graphPlan.nodes.reduce((sum, node) => sum + (node.estimatedMinutes ?? 0), 0)} min`
    : null;

  const planPrimaryAction = (
    <button
      type="button"
      onClick={onGeneratePlan}
      disabled={planGenerationStatus === "generating"}
      className={buttonVariants({ variant: plan ? "outline" : "default", size: "sm", className: "rounded-xl" })}
    >
      {planGenerationStatus === "generating" ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
      {planGenerationStatus === "generating" ? "Generating..." : plan ? "Regenerate plan" : "Generate plan"}
    </button>
  );

  return (
    <div className="space-y-1.5 xl:flex xl:min-h-0 xl:flex-1 xl:flex-col xl:overflow-hidden">
      {graphPlan && plan ? (
        <>
          <TaskPlanGraphPanel
            label={label}
            plan={graphPlan}
            summary={planSummary}
            className="min-h-[520px] min-w-0 xl:flex xl:flex-1 xl:flex-col"
            fillHeight
            inspectorPlacement="none"
            dismissSelectionOnOutsideClick={false}
            onSelectedNodeChange={onSelectedNodeChange}
            actions={(
              <div className="flex flex-wrap items-center justify-end gap-2">
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
                {planPrimaryAction}
              </div>
            )}
          />
          {acceptPlanError ? <p className="text-xs text-red-600">{acceptPlanError}</p> : null}
        </>
      ) : (
        <SurfaceCard
          variant="inset"
          padding="sm"
          className="flex h-full min-h-[520px] min-w-0 flex-col rounded-[1.35rem] border-border/50 bg-background/65 shadow-none ring-0"
        >
          <div className="mb-2 flex min-w-0 items-center justify-between gap-3 px-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary/80">{label}</p>
            <div className="shrink-0">{planPrimaryAction}</div>
          </div>
          <div className="flex min-h-[520px] flex-1 items-center justify-center rounded-[1.1rem] border border-dashed border-border/60 bg-background/40 px-6 text-center text-sm text-muted-foreground">
            The plan graph will appear here once AI generates a plan.
          </div>
        </SurfaceCard>
      )}
    </div>
  );
}
