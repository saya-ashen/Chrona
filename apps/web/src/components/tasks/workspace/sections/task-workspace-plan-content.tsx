import { useState } from "react";
import { ChevronDown, ChevronUp, GitBranch, Minimize2, Sparkles } from "lucide-react";
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
}: {
  plan: TaskPlanReadModel;
  graphPlan: TaskPlanGraphPlan;
}) {
  const brief = plan.blueprint ?? plan.compiledPlan ?? {
    title: "Plan",
    goal: plan.summary ?? "Review the generated execution plan.",
    assumptions: [],
  };
  const assumptions = brief.assumptions ?? [];
  const [isExpanded, setIsExpanded] = useState(false);
  const assumptionCountLabel = assumptions.length === 1 ? "1 assumption" : `${assumptions.length} assumptions`;
  const estimatedMinutes = graphPlan.nodes.reduce((sum, node) => sum + (node.estimatedMinutes ?? 0), 0);
  const updatedAt = formatPlanUpdatedAt(plan.updatedAt);

  return (
    <section
      aria-label="Plan brief"
      className="rounded-xl border border-border/65 bg-background/85 px-3 py-2 shadow-none"
    >
      <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">Plan brief</span>
            <span className="min-w-0 truncate text-sm font-semibold text-foreground" title={brief.title}>{brief.title}</span>
            <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">{plan.status}</Badge>
          </div>
          <p className="line-clamp-1 text-xs leading-5 text-muted-foreground" title={brief.goal}>Goal: {brief.goal}</p>
          {plan.summary ? <p className="line-clamp-1 text-xs leading-5 text-foreground/85" title={plan.summary}>Summary: {plan.summary}</p> : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5 text-xs text-muted-foreground lg:self-stretch lg:justify-between">
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <Badge variant="outline" className="h-4 px-1.5 text-[10px]">{graphPlan.nodes.length} steps</Badge>
            {estimatedMinutes > 0 ? <Badge variant="outline" className="h-4 px-1.5 text-[10px]">{estimatedMinutes} min</Badge> : null}
            <Badge variant="outline" className="h-4 px-1.5 text-[10px]">{assumptionCountLabel}</Badge>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-7 rounded-lg px-2.5 text-xs font-medium shadow-sm"
            aria-expanded={isExpanded}
            onClick={() => setIsExpanded((value) => !value)}
          >
            {isExpanded ? "Hide details" : "Show details"}
            {isExpanded ? <ChevronUp className="size-3.5" aria-hidden="true" /> : <ChevronDown className="size-3.5" aria-hidden="true" />}
          </Button>
        </div>
      </div>
      {isExpanded ? (
        <div className="mt-3 max-h-64 space-y-3 overflow-auto border-t border-border/55 pt-3 text-sm">
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Goal</p>
            <p className="leading-6 text-foreground">{brief.goal}</p>
          </div>
          {plan.summary ? (
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Summary</p>
              <p className="leading-6 text-foreground">{plan.summary}</p>
            </div>
          ) : null}
          {assumptions.length > 0 ? (
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Assumptions</p>
              <ul className="space-y-1 text-muted-foreground">
                {assumptions.map((assumption) => (
                  <li key={assumption} className="flex gap-2 leading-6">
                    <span aria-hidden="true" className="mt-2.5 size-1.5 shrink-0 rounded-full bg-primary/70" />
                    <span>{assumption}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {plan.generatedBy ? <span>Generated by {plan.generatedBy}</span> : null}
            {updatedAt ? <span>Updated {updatedAt}</span> : null}
          </div>
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
  planGenerationStatus,
  graphMode,
  onGraphModeChange,
  onGeneratePlan,
  onSelectedNodeChange,
}: TaskWorkspacePlanContentProps) {
  const { messages } = useI18n();
  const copy = { ...DEFAULT_COPY, ...(messages.components.taskWorkspace) };
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
          <div className="flex min-w-0 flex-col gap-2 border-b border-border/55 bg-muted/35 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">{label}</p>
              {planSummary ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{planSummary}</p> : null}
            </div>
            {graphModeControls}
          </div>
          <div className="border-b border-border/55 p-2">
            <TaskWorkspacePlanBrief plan={plan} graphPlan={graphPlan} />
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
              onSelectedNodeChange={onSelectedNodeChange}
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
