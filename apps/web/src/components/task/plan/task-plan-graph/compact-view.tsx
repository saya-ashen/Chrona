import { cn } from "@/lib/utils";
import { getCompactStatusLabel, getNodeTone, getStatusLabel, TONE_STYLES } from "./logic";
import type { GraphCopy, PlanStep, TaskPlanGraphPlan } from "./types";

export function buildCompactSections(plan: TaskPlanGraphPlan) {
  const incomingCounts = new Map<string, number>();
  const outgoingCounts = new Map<string, number>();

  for (const step of plan.steps) {
    incomingCounts.set(step.id, 0);
    outgoingCounts.set(step.id, 0);
  }

  for (const edge of plan.edges ?? []) {
    incomingCounts.set(edge.toNodeId, (incomingCounts.get(edge.toNodeId) ?? 0) + 1);
    outgoingCounts.set(edge.fromNodeId, (outgoingCounts.get(edge.fromNodeId) ?? 0) + 1);
  }

  const current = plan.steps.filter((step) => step.id === plan.currentStepId);
  const attention = plan.steps.filter(
    (step) => step.id !== plan.currentStepId && (step.status === "waiting_for_user" || step.status === "blocked"),
  );
  const next = plan.steps.filter(
    (step) =>
      step.id !== plan.currentStepId &&
      !attention.some((candidate) => candidate.id === step.id) &&
      ((incomingCounts.get(step.id) ?? 0) > 0 || step.linkedTaskId),
  );
  const summary = plan.steps.filter(
    (step) =>
      step.id !== plan.currentStepId &&
      !attention.some((candidate) => candidate.id === step.id) &&
      !next.some((candidate) => candidate.id === step.id),
  );

  return {
    incomingCounts,
    outgoingCounts,
    groups: [
      { id: "current", title: "当前推进", steps: current },
      { id: "attention", title: "待处理 / 阻塞", steps: attention },
      { id: "next", title: "后续摘要", steps: next },
      { id: "summary", title: "其余节点", steps: summary },
    ].filter((group) => group.steps.length > 0),
  };
}

export function CompactOutlineNode({
  step,
  incomingCount,
  outgoingCount,
  graphCopy,
  isCurrent,
  isSelected,
  onToggle,
}: {
  step: PlanStep;
  incomingCount: number;
  outgoingCount: number;
  graphCopy: GraphCopy;
  isCurrent: boolean;
  isSelected: boolean;
  onToggle: (nodeId: string) => void;
}) {
  const tone = getNodeTone(step);
  const s = TONE_STYLES[tone];
  const relationSummary = [
    incomingCount > 0 ? `${incomingCount} 个前置` : null,
    outgoingCount > 0 ? `${outgoingCount} 个后续` : null,
    step.linkedTaskId ? "已关联任务" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      type="button"
      onClick={() => onToggle(step.id)}
      className={cn(
        "group relative w-full rounded-2xl border px-3 py-2 text-left transition-colors",
        s.border,
        s.bg,
        isCurrent && "ring-2",
        isCurrent && s.ring,
        isSelected && !isCurrent && "ring-1 ring-foreground/10",
      )}
      data-node-current={isCurrent ? "true" : "false"}
      data-node-selected={isSelected ? "true" : "false"}
      data-node-tone={tone}
      data-testid={`task-plan-outline-node-${step.id}`}
    >
      <div className="absolute bottom-2 left-0 top-2 w-px bg-border/50" aria-hidden="true" />
      <div className="flex items-start gap-2.5 pl-2">
        <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", s.dot)} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[10px] leading-snug text-muted-foreground">
            {isCurrent ? <span className="font-semibold text-foreground/80">当前节点</span> : null}
            {isCurrent ? <span aria-hidden="true">·</span> : null}
            <span className="font-semibold uppercase tracking-[0.12em]">{step.phase}</span>
            <span aria-hidden="true">·</span>
            <span>{getCompactStatusLabel(step.status, graphCopy)}</span>
            {step.type && step.type !== step.phase?.toLowerCase() ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{step.type}</span>
              </>
            ) : null}
          </div>
          <p className="mt-1 text-sm font-medium leading-snug text-foreground line-clamp-2">{step.title}</p>
          {relationSummary ? <p className="mt-1 text-[11px] text-muted-foreground">{relationSummary}</p> : null}
          {isSelected ? (
            <div className="mt-2 space-y-2 border-t border-border/30 pt-2">
              <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                <span className="rounded-full bg-foreground/5 px-1.5 py-0.5">{getStatusLabel(step.status, graphCopy)}</span>
                {typeof step.estimatedMinutes === "number" ? (
                  <span className="rounded-full bg-foreground/5 px-1.5 py-0.5">{step.estimatedMinutes}m</span>
                ) : null}
                {step.executionMode ? (
                  <span className="rounded-full bg-foreground/5 px-1.5 py-0.5">{step.executionMode}</span>
                ) : null}
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">{step.objective}</p>
            </div>
          ) : null}
        </div>
      </div>
    </button>
  );
}
