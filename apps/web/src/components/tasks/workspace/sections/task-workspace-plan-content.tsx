import { useState } from "react";
import { GitBranch, ListChecks, Minimize2, Sparkles } from "lucide-react";
import { useI18n } from "@chrona/i18n/react";
import { TaskPlanGraphPanel } from "@/components/tasks/panels/task-plan-graph-panel";
import type { TaskPlanGraphPlan } from "@/components/tasks/plan/task-plan-graph/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { TaskPlanReadModel } from "@chrona/contracts/ai";
import type { TaskPlanGenerationStatus } from "../../../../../../../features/task-workspace";
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
  isReviewingPlan?: boolean;
  planGenerationStatus: TaskPlanGenerationStatus;
  graphMode: "full" | "compact";
  onGraphModeChange: (mode: "full" | "compact") => void;
  onGeneratePlan: () => void;
  onSelectedNodeChange?: Parameters<typeof TaskPlanGraphPanel>[0]["onSelectedNodeChange"];
};

function formatPlanUpdatedAt(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function TaskWorkspacePlanBrief({
  plan,
  graphPlan,
  reviewing,
  copy,
  compact = false,
}: {
  plan: TaskPlanReadModel;
  graphPlan: TaskPlanGraphPlan;
  reviewing: boolean;
  copy: Record<string, string | undefined>;
  compact?: boolean;
}) {
  const brief = plan.blueprint ?? plan.compiledPlan ?? {
    title: "Plan",
    goal: plan.summary ?? "Review the generated execution plan.",
    assumptions: [],
  };
  const assumptions = brief.assumptions ?? [];
  const estimatedMinutes = graphPlan.nodes.reduce((sum, node) => sum + (node.estimatedMinutes ?? 0), 0);
  const updatedAt = formatPlanUpdatedAt(plan.updatedAt);

  if (compact) {
    return (
      <section aria-label="Plan brief" className="flex min-w-0 flex-col gap-2 rounded-xl border border-border/65 bg-background px-3 py-2.5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">Plan brief</span>
            <span className="truncate text-sm font-semibold text-foreground">{brief.title}</span>
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground" title={brief.goal}>{brief.goal}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5 text-xs text-muted-foreground">
          <Badge variant="outline">{graphPlan.nodes.length} step{graphPlan.nodes.length === 1 ? "" : "s"}</Badge>
          {estimatedMinutes > 0 ? <Badge variant="outline">About {estimatedMinutes} min</Badge> : null}
          {assumptions.length > 0 ? <Badge variant="outline">{assumptions.length} assumption{assumptions.length === 1 ? "" : "s"}</Badge> : null}
        </div>
      </section>
    );
  }
  return (
    <section aria-label="Plan brief" className="space-y-2 rounded-xl border border-border/65 bg-background px-3 py-3 shadow-sm">
      <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">Plan brief</span>
            <Badge variant="secondary" className="h-5 text-[10px]">{plan.status}</Badge>
          </div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">{brief.title}</h2>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">{graphPlan.nodes.length} step{graphPlan.nodes.length === 1 ? "" : "s"}</Badge>
          {estimatedMinutes > 0 ? <Badge variant="outline">About {estimatedMinutes} min</Badge> : null}
          {assumptions.length > 0 ? <Badge variant="outline">{assumptions.length} assumption{assumptions.length === 1 ? "" : "s"}</Badge> : null}
        </div>
      </div>
      <div className="grid gap-2 border-t border-border/55 pt-2 lg:grid-cols-2">
        <div className="space-y-1.5">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{copy.planGoal ?? "Goal"}</h3>
          <p className="text-sm leading-5 text-foreground">{brief.goal}</p>
        </div>
        {plan.summary ? (
          <div className="space-y-1.5">
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{copy.planSummaryLabel ?? "Summary"}</h3>
            <p className="text-sm leading-5 text-foreground">{plan.summary}</p>
          </div>
        ) : null}
      </div>
      {reviewing && assumptions.length > 0 ? (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-warning-foreground">{copy.planAssumptions ?? "Assumptions"}</h3>
          <p className="mt-1 text-xs leading-5 text-foreground">{assumptions.join(" · ")}</p>
        </div>
      ) : null}
      {!reviewing ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border/55 pt-3 text-xs text-muted-foreground">
          {plan.generatedBy ? <span>Generated by {plan.generatedBy}</span> : null}
          {updatedAt ? <span>Updated {updatedAt}</span> : null}
        </div>
      ) : null}
    </section>
  );
}

export function TaskWorkspacePlanContent({
  label,
  graphPlan,
  isGraphPlanPending,
  plan,
  acceptPlanError,
  isReviewingPlan = false,
  planGenerationStatus,
  graphMode,
  onGraphModeChange,
  onGeneratePlan,
  onSelectedNodeChange,
}: TaskWorkspacePlanContentProps) {
  const { messages } = useI18n();
  const copy = { ...DEFAULT_COPY, ...(messages.components.taskWorkspace) } as Record<string, string | undefined> & typeof DEFAULT_COPY;
  const planSummary = graphPlan && plan
    ? `${plan.status} / ${graphPlan.nodes.length} step${graphPlan.nodes.length === 1 ? "" : "s"} / ${graphPlan.nodes.reduce((sum, node) => sum + (node.estimatedMinutes ?? 0), 0)} min`
    : null;
  const isGeneratingPlan = planGenerationStatus === "generating";
  const [reviewView, setReviewView] = useState<"steps" | "flow">("steps");
  const requiresGraph = Boolean(graphPlan && (graphPlan.nodes.length > 3 || graphPlan.nodes.some((node) =>
    ["checkpoint", "condition", "wait", "user_input"].includes(node.type ?? node.kind ?? "task")
      || (node.dependencies?.length ?? 0) > 1,
  )));
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
  const generatePlanButton = isGeneratingPlan ? null : (
    <Button
      type="button"
      onClick={onGeneratePlan}
      variant="secondary"
      size="sm"
      className="rounded-xl"
    >
      <Sparkles className="size-4" />
      {plan ? copy.regeneratePlan : copy.generatePlan}
    </Button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {graphPlan && plan ? (
        <>
          <div className="border-b border-border/55 p-3">
            <TaskWorkspacePlanBrief plan={plan} graphPlan={graphPlan} reviewing={isReviewingPlan} compact={isReviewingPlan && reviewView === "flow"} copy={copy} />
          </div>
          {isReviewingPlan ? (
            <>
              <div className="flex items-center justify-between gap-3 border-b border-border/55 bg-muted/20 px-3 py-2.5">
                <div className="flex gap-1" role="group" aria-label="Plan review view">
                  <Button type="button" size="sm" variant={reviewView === "steps" ? "default" : "ghost"} onClick={() => setReviewView("steps")} aria-pressed={reviewView === "steps"}>
                    <ListChecks className="size-4" />{copy.planStepsView ?? "Steps"}
                  </Button>
                  <Button type="button" size="sm" variant={reviewView === "flow" ? "default" : "ghost"} onClick={() => setReviewView("flow")} aria-pressed={reviewView === "flow"}>
                    <GitBranch className="size-4" />{copy.planFlowView ?? "Flow"}
                  </Button>
                </div>
                <p className="hidden text-xs text-muted-foreground md:block">{reviewView === "steps" ? `${graphPlan.nodes.length} step${graphPlan.nodes.length === 1 ? "" : "s"} in execution order` : (copy.planFlowHint ?? "Inspect dependencies and branches")}</p>
              </div>
              {reviewView === "steps" ? (
                <div className="min-h-0 flex-1 overflow-y-auto p-3" aria-label={copy.planSteps ?? "Execution steps"}>
                  <ol className="space-y-2">
                    {graphPlan.nodes.map((node, index) => {
                      const needsUser = Boolean(node.requiresHumanInput || node.checkpoint || ["checkpoint", "condition", "wait", "user_input"].includes(node.type ?? node.kind ?? "task"));
                      return (
                        <li key={node.id}>
                          <button type="button" className="flex w-full gap-3 rounded-xl border border-border/65 bg-background px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5" onClick={() => onSelectedNodeChange?.(node, graphPlan.nodes)}>
                            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{index + 1}</span>
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-center gap-2"><span className="font-medium text-foreground">{node.title}</span>{needsUser ? <Badge variant="secondary">Needs review</Badge> : null}</span>
                              {node.objective ? <span className="mt-1 block text-sm leading-5 text-muted-foreground">{node.objective}</span> : null}
                              <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                {node.estimatedMinutes ? <span>About {node.estimatedMinutes} min</span> : null}
                                {(node.dependencies?.length ?? 0) > 0 ? <span>After {node.dependencies?.length} step{node.dependencies?.length === 1 ? "" : "s"}</span> : <span>No dependencies</span>}
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              ) : (
                <div className="min-h-0 flex-1 p-2" aria-label="Execution graph">
                  <TaskPlanGraphPanel label={label} plan={graphPlan} mode="full" summary={planSummary} className="min-h-[520px] min-w-0 w-full" showOverview onSelectedNodeChange={onSelectedNodeChange} />
                </div>
              )}
          </>
          ) : (
            <>
              <div className="flex min-w-0 flex-col gap-2 border-b border-border/55 bg-muted/35 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0"><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">{label}</p>{planSummary ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{planSummary}</p> : null}</div>
                <div className={requiresGraph ? "" : "opacity-70"}>{graphModeControls}</div>
              </div>
              <div className={requiresGraph ? "min-h-0 flex-1 p-2" : "min-h-0 flex-1 border-t border-border/40 bg-muted/15 p-2 opacity-75"} aria-label={requiresGraph ? "Execution graph" : "Execution graph diagnostics"}>
                <TaskPlanGraphPanel label={label} plan={graphPlan} mode={graphMode} summary={planSummary} className={graphMode === "compact" ? "min-h-0 min-w-0 w-full flex-1" : "h-[620px] min-w-0 w-full md:h-[760px] xl:h-full"} fillHeight showOverview={graphMode === "full"} onSelectedNodeChange={onSelectedNodeChange} />
              </div>
            </>
          )}
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
