import type { RefObject } from "react";
import { Check, Clock, Loader2, Sparkles } from "lucide-react";
import { TaskPlanGraphPanel } from "@/components/task/panels/task-plan-graph-panel";
import type { PlanNodeDataModel } from "@/components/task/plan/task-plan-graph/types";
import type { TaskPlanGraphPlan } from "@/components/task/plan/task-plan-graph/types";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { SurfaceCard } from "@/components/ui/surface-card";
import type { TaskPlanGenerationStatus } from "./task-workspace-types";
import type { TaskPlanReadModel } from "@chrona/contracts/ai";

function formatPlanUpdatedAt(iso: string) {
  return iso.replace("T", " ").slice(0, 16);
}

function planStatusTone(status: string) {
  if (status === "accepted") return "success" as const;
  if (status === "draft") return "warning" as const;
  if (status === "superseded") return "neutral" as const;
  return "neutral" as const;
}

type TaskWorkspacePlanContentProps = {
  label: string;
  graphPlan: TaskPlanGraphPlan | null;
  plan: TaskPlanReadModel | null;
  graphPanelHeight: number;
  canAcceptPlan: boolean;
  isAcceptingPlan: boolean;
  acceptPlanError: string | null;
  planGenerationStatus: TaskPlanGenerationStatus;
  planAreaRef: RefObject<HTMLDivElement | null>;
  onAcceptPlan: () => void | Promise<void>;
  onGeneratePlan: () => void;
  onSelectedNodeChange: (node: PlanNodeDataModel | null, nodes: PlanNodeDataModel[]) => void;
};

export function TaskWorkspacePlanContent({
  label,
  graphPlan,
  plan,
  graphPanelHeight,
  canAcceptPlan,
  isAcceptingPlan,
  acceptPlanError,
  planGenerationStatus,
  planAreaRef,
  onAcceptPlan,
  onGeneratePlan,
  onSelectedNodeChange,
}: TaskWorkspacePlanContentProps) {
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
    <div
      ref={planAreaRef}
      className="space-y-2 xl:flex xl:min-h-0 xl:flex-1 xl:flex-col xl:overflow-hidden"
      style={graphPanelHeight > 0 ? { height: `${graphPanelHeight}px` } : undefined}
    >
      {graphPlan && plan ? (
        <>
          <TaskPlanGraphPanel
            label={label}
            plan={graphPlan}
            maxViewportHeight={graphPanelHeight}
            className="min-w-0 xl:flex xl:min-h-0 xl:flex-1 xl:flex-col"
            inspectorPlacement="none"
            dismissSelectionOnOutsideClick={false}
            onSelectedNodeChange={onSelectedNodeChange}
            description={(
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {graphPlan.nodes.length} steps · {graphPlan.nodes.reduce((sum, node) => sum + (node.estimatedMinutes ?? 0), 0)} min
                </span>
                <StatusBadge tone={planStatusTone(plan.status)}>{plan.status}</StatusBadge>
                <span className="inline-flex items-center gap-1">
                  <Clock className="size-3" />
                  Updated: {formatPlanUpdatedAt(plan.updatedAt)}
                </span>
              </div>
            )}
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
          className="flex h-full min-h-0 min-w-0 flex-col rounded-[1.35rem] border-border/50 bg-background/65 shadow-none ring-0"
        >
          <div className="mb-2 flex min-w-0 items-start justify-between gap-3 px-1">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary/80">{label}</p>
              <div className="mt-1 text-xs text-muted-foreground">
                No accepted plan yet. Generate one to turn this task into an executable graph.
              </div>
            </div>
            <div className="shrink-0">{planPrimaryAction}</div>
          </div>
          <div className="flex min-h-[320px] flex-1 items-center justify-center rounded-[1.1rem] border border-dashed border-border/60 bg-background/40 px-6 text-center text-sm text-muted-foreground">
            The plan graph will appear here once AI generates a plan.
          </div>
        </SurfaceCard>
      )}
    </div>
  );
}
