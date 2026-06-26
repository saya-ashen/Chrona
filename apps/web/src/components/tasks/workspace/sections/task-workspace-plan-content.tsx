import { GitBranch, Loader2, Minimize2, Sparkles } from "lucide-react";
import { useI18n } from "@chrona/i18n/react";
import { TaskPlanGraphPanel } from "@/components/tasks/panels/task-plan-graph-panel";
import type { TaskPlanGraphPlan } from "@/components/tasks/plan/task-plan-graph/types";
import { Button } from "@/components/ui/button";
import type { TaskPlanReadModel } from "@chrona/contracts/ai";
import type { TaskPlanGenerationStatus } from "../model/task-workspace-types";
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
};


type TaskWorkspacePlanContentProps = {
  label: string;
  graphPlan: TaskPlanGraphPlan | null;
  isGraphPlanPending: boolean;
  plan: TaskPlanReadModel | null;
  acceptPlanError: string | null;
  planGenerationStatus: TaskPlanGenerationStatus;
  graphMode: "full" | "compact";
  onGraphModeChange: (mode: "full" | "compact") => void;
  onGeneratePlan: () => void;
};

export function TaskWorkspacePlanContent({
  label,
  graphPlan,
  isGraphPlanPending,
  plan,
  acceptPlanError,
  planGenerationStatus,
  graphMode,
  onGraphModeChange,
  onGeneratePlan,
}: TaskWorkspacePlanContentProps) {
  const { messages } = useI18n();
  const copy = { ...DEFAULT_COPY, ...(messages.components.taskWorkspace ?? {}) };
  const planSummary = graphPlan && plan
    ? `${plan.status} / ${graphPlan.nodes.length} steps / ${graphPlan.nodes.reduce((sum, node) => sum + (node.estimatedMinutes ?? 0), 0)} min`
    : null;
  const isGeneratingPlan = planGenerationStatus === "generating";
  const graphModeControls = (
    <div className="flex w-full flex-wrap items-stretch gap-1 sm:w-auto sm:justify-end" role="group" aria-label={copy.graphModeLabel}>
      <Button
        type="button"
        variant={graphMode === "full" ? "default" : "ghost"}
        size="sm"
        className="h-auto min-w-0 flex-1 items-start justify-start rounded-xl px-3 py-2 text-left text-xs sm:flex-none"
        onClick={() => onGraphModeChange("full")}
        aria-pressed={graphMode === "full"}
        title={copy.graphFullHint}
      >
        <GitBranch className="mt-0.5 size-3.5 shrink-0" />
        <span className="flex min-w-0 flex-col items-start leading-tight">
          <span className="truncate">{copy.graphFullMode}</span>
          <span className="hidden text-[10px] font-normal opacity-75 md:inline">{copy.graphFullHint}</span>
        </span>
      </Button>
      <Button
        type="button"
        variant={graphMode === "compact" ? "default" : "ghost"}
        size="sm"
        className="h-auto min-w-0 flex-1 items-start justify-start rounded-xl px-3 py-2 text-left text-xs sm:flex-none"
        onClick={() => onGraphModeChange("compact")}
        aria-pressed={graphMode === "compact"}
        title={copy.graphCompactHint}
      >
        <Minimize2 className="mt-0.5 size-3.5 shrink-0" />
        <span className="flex min-w-0 flex-col items-start leading-tight">
          <span className="truncate">{copy.graphCompactMode}</span>
          <span className="hidden text-[10px] font-normal opacity-75 md:inline">{copy.graphCompactHint}</span>
        </span>
      </Button>
    </div>
  );
  const generatePlanButton = (
    <Button
      type="button"
      disabled={isGeneratingPlan}
      onClick={onGeneratePlan}
      variant="secondary" size="sm" className="rounded-xl"
    >
      {isGeneratingPlan ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
      {isGeneratingPlan
        ? copy.generating
        : plan
          ? copy.regeneratePlan
          : copy.generatePlan}
    </Button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {graphPlan && plan ? (
        <>
          <div className="flex min-w-0 flex-col gap-2 border-b border-border/55 bg-muted/35 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">{label}</p>
              {planSummary ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{planSummary}</p> : null}
            </div>
            {graphModeControls}
          </div>
          <div className="min-h-0 flex-1 p-2">
            <TaskPlanGraphPanel
              label={label}
              plan={graphPlan}
              mode={graphMode}
              summary={planSummary}
              className={graphMode === "compact"
                ? "min-h-0 min-w-0 w-full flex-1"
                : "h-[620px] min-w-0 w-full md:h-[760px] xl:h-full"}
              fillHeight
              showOverview={graphMode === "full"}
            />
          </div>
          {acceptPlanError ? <p className="border-t border-border/55 px-3 py-2 text-xs text-destructive">{acceptPlanError}</p> : null}
        </>
      ) : (
        <div className="flex h-[520px] min-w-0 max-w-full flex-col md:h-[640px] xl:h-full">
          <div className="flex min-w-0 flex-col gap-2 border-b border-border/55 bg-muted/35 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">{label}</p>
            {isGraphPlanPending ? null : generatePlanButton}
          </div>
          <div className="m-2 flex min-h-0 min-w-0 flex-1 items-center justify-center rounded-[1.1rem] border border-dashed border-border bg-background/70 px-5 text-center text-sm text-muted-foreground">
            {isGraphPlanPending
              ? copy.preparingPlanGraph
              : copy.planGraphPlaceholder}
          </div>
        </div>
      )}
    </div>
  );
}
