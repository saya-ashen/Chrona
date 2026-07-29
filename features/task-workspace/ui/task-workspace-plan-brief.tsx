import { Expand, Minimize2 } from "lucide-react";
import type { TaskPlanReadModel } from "@chrona/contracts";
import type { TaskPlanGraphPlan } from "../plan/task-plan-graph/types";
import { Badge, Button } from "@shared/ui";

export type PlanContentCopy = Record<string, string | undefined>;

type PlanBriefProps = {
  plan: TaskPlanReadModel;
  graphPlan: TaskPlanGraphPlan;
  reviewing: boolean;
  copy: PlanContentCopy;
  compact: boolean;
  onCompactChange: (compact: boolean) => void;
};

type PlanBriefData = {
  assumptions: string[];
  estimatedMinutes: number;
  goal: string;
  title: string;
  updatedAt: string | null;
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

function createPlanBriefData(plan: TaskPlanReadModel, graphPlan: TaskPlanGraphPlan): PlanBriefData {
  const brief = plan.blueprint ?? plan.compiledPlan ?? {
    title: "Plan",
    goal: plan.summary ?? "Review the generated execution plan.",
    assumptions: [],
  };

  return {
    assumptions: brief.assumptions ?? [],
    estimatedMinutes: graphPlan.nodes.reduce(
      (sum, node) => sum + (node.estimatedMinutes ?? 0),
      0,
    ),
    goal: brief.goal,
    title: brief.title,
    updatedAt: formatPlanUpdatedAt(plan.updatedAt),
  };
}

function PlanBriefMetrics({ graphPlan, data }: Pick<PlanBriefProps, "graphPlan"> & { data: PlanBriefData }) {
  const stepLabel = graphPlan.nodes.length === 1 ? "step" : "steps";
  const assumptionLabel = data.assumptions.length === 1 ? "assumption" : "assumptions";

  return (
    <>
      <Badge variant="outline">{graphPlan.nodes.length} {stepLabel}</Badge>
      {data.estimatedMinutes > 0 ? <Badge variant="outline">About {data.estimatedMinutes} min</Badge> : null}
      {data.assumptions.length > 0 ? <Badge variant="outline">{data.assumptions.length} {assumptionLabel}</Badge> : null}
    </>
  );
}

function PlanBriefCompact({ graphPlan, data, onCompactChange }: Pick<PlanBriefProps, "graphPlan" | "onCompactChange"> & { data: PlanBriefData }) {
  return (
    <section aria-label="Plan brief" className="flex min-w-0 flex-col gap-2 rounded-xl border border-border/65 bg-background px-3 py-2.5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">Plan brief</span>
          <span className="truncate text-sm font-semibold text-foreground">{data.title}</span>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground" title={data.goal}>{data.goal}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <PlanBriefMetrics graphPlan={graphPlan} data={data} />
        <Button type="button" variant="ghost" size="sm" className="h-7 rounded-lg px-2 text-xs" onClick={() => onCompactChange(false)} aria-pressed="true">
          <Expand className="size-3.5" />Show full brief
        </Button>
      </div>
    </section>
  );
}

function PlanBriefExpanded({ copy, graphPlan, plan, reviewing, data, onCompactChange }: PlanBriefProps & { data: PlanBriefData }) {
  return (
    <section aria-label="Plan brief" className="space-y-2 rounded-xl border border-border/65 bg-background px-3 py-3 shadow-sm">
      <div className="flex min-w-0 flex-col gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">Plan brief</span>
            <Badge variant="secondary" className="h-5 text-[10px]">{plan.status}</Badge>
          </div>
          <h2 className="break-words text-lg font-semibold tracking-tight text-foreground">{data.title}</h2>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <PlanBriefMetrics graphPlan={graphPlan} data={data} />
          <Button type="button" variant="ghost" size="sm" className="h-7 rounded-lg px-2 text-xs" onClick={() => onCompactChange(true)} aria-pressed="false">
            <Minimize2 className="size-3.5" />Use compact brief
          </Button>
        </div>
      </div>
      <div className="grid gap-2 border-t border-border/55 pt-2 lg:grid-cols-2">
        <div className="space-y-1.5">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{copy.planGoal ?? "Goal"}</h3>
          <p className="text-sm leading-5 text-foreground">{data.goal}</p>
        </div>
        {plan.summary ? <div className="space-y-1.5"><h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{copy.planSummaryLabel ?? "Summary"}</h3><p className="text-sm leading-5 text-foreground">{plan.summary}</p></div> : null}
      </div>
      {reviewing && data.assumptions.length > 0 ? <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2"><h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-warning-foreground">{copy.planAssumptions ?? "Assumptions"}</h3><p className="mt-1 text-xs leading-5 text-foreground">{data.assumptions.join(" · ")}</p></div> : null}
      {!reviewing ? <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border/55 pt-3 text-xs text-muted-foreground">{plan.generatedBy ? <span>Generated by {plan.generatedBy}</span> : null}{data.updatedAt ? <span>Updated {data.updatedAt}</span> : null}</div> : null}
    </section>
  );
}

export function TaskWorkspacePlanBrief(props: PlanBriefProps) {
  const data = createPlanBriefData(props.plan, props.graphPlan);
  return props.compact ? <PlanBriefCompact graphPlan={props.graphPlan} data={data} onCompactChange={props.onCompactChange} /> : <PlanBriefExpanded {...props} data={data} />;
}
