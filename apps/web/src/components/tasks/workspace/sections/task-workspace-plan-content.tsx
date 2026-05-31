import { Loader2, Sparkles } from "lucide-react";
import { useI18n } from "@chrona/i18n/react";
import { TaskPlanGraphPanel } from "@/components/tasks/panels/task-plan-graph-panel";
import type { PlanNodeDataModel } from "@/components/tasks/plan/task-plan-graph/types";
import type { TaskPlanGraphPlan } from "@/components/tasks/plan/task-plan-graph/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { TaskPlanReadModel } from "@chrona/contracts/ai";
import type { TaskPlanGenerationStatus } from "../model/task-workspace-types";

type TaskWorkspacePlanContentProps = {
  label: string;
  graphPlan: TaskPlanGraphPlan | null;
  isGraphPlanPending: boolean;
  plan: TaskPlanReadModel | null;
  acceptPlanError: string | null;
  planGenerationStatus: TaskPlanGenerationStatus;
  onGeneratePlan: () => void;
  onSelectedNodeChange: (node: PlanNodeDataModel | null, nodes: PlanNodeDataModel[]) => void;
};

export function TaskWorkspacePlanContent({
  label,
  graphPlan,
  isGraphPlanPending,
  plan,
  acceptPlanError,
  planGenerationStatus,
  onGeneratePlan,
  onSelectedNodeChange,
}: TaskWorkspacePlanContentProps) {
  const { messages } = useI18n();
  const copy = messages.components?.taskWorkspace ?? {};
  const planSummary = graphPlan && plan
    ? `${plan.status} / ${graphPlan.nodes.length} steps / ${graphPlan.nodes.reduce((sum, node) => sum + (node.estimatedMinutes ?? 0), 0)} min`
    : null;
  const isGeneratingPlan = planGenerationStatus === "generating";
  const generatePlanButton = (
    <Button
      type="button"
      disabled={isGeneratingPlan}
      onClick={onGeneratePlan}
      variant="secondary" size="sm" className="rounded-xl"
    >
      {isGeneratingPlan ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
      {isGeneratingPlan
        ? (copy.generating ?? "Generating...")
        : plan
          ? (copy.regeneratePlan ?? "Regenerate plan")
          : (copy.generatePlan ?? "Generate plan")}
    </Button>
  );

  return (
    <div className="h-full min-h-0 space-y-1">
      {graphPlan && plan ? (
        <>
          <TaskPlanGraphPanel
            label={label}
            plan={graphPlan}
            mode="full"
            summary={planSummary}
            className="h-[620px] min-w-0 md:h-[760px] xl:h-full"
            fillHeight
            inspectorPlacement="none"
            dismissSelectionOnOutsideClick={false}
            showOverview={false}
            onSelectedNodeChange={onSelectedNodeChange}
          />
          {acceptPlanError ? <p className="text-xs text-destructive">{acceptPlanError}</p> : null}
        </>
      ) : (
        <Card
         
         
          className="flex h-[520px] min-w-0 max-w-full flex-col rounded-[1.35rem] border-border/70 bg-card/75 shadow-sm ring-0 md:h-[640px] xl:h-full"
        >
          <div className="mb-1 flex min-w-0 items-center justify-between gap-2 px-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">{label}</p>
            {isGraphPlanPending ? null : generatePlanButton}
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center rounded-[1.1rem] border border-dashed border-border bg-muted/40 px-5 text-center text-sm text-muted-foreground">
            {isGraphPlanPending
              ? (copy.preparingPlanGraph ?? "Preparing plan graph...")
              : (copy.planGraphPlaceholder ?? "The plan graph will appear here once AI generates a plan.")}
          </div>
        </Card>
      )}
    </div>
  );
}
