import { cn } from "@/lib/utils";
import { getNodeTone, TONE_STYLES } from "./logic";
import type { CompactFocusItem, CompactStage, GraphCopy, TaskPlanGraphPlan } from "./types";

export function buildCompactViewModel(plan: TaskPlanGraphPlan, graphCopy: GraphCopy): {
  stages: CompactStage[];
  focusItems: CompactFocusItem[];
  summary: {
    nodes: number;
    active: number;
    attention: number;
    done: number;
    currentLabel: string | null;
    statusLabel: string | null;
  };
} {
  const nodesById = new Map(plan.nodes.map((node) => [node.id, node]));
  const upstreamByNodeId: Record<string, string[]> = Object.fromEntries(plan.nodes.map((node) => [node.id, [...(plan.analytics.upstreamByNodeId[node.id] ?? [])]]));
  const downstreamByNodeId: Record<string, string[]> = Object.fromEntries(plan.nodes.map((node) => [node.id, [...(plan.analytics.downstreamByNodeId[node.id] ?? [])]]));

  for (const edge of plan.edges) {
    const from = edge.from ?? edge.fromNodeId;
    const to = edge.to ?? edge.toNodeId;
    if (!from || !to) continue;
    downstreamByNodeId[from] = [...(downstreamByNodeId[from] ?? []), to];
    upstreamByNodeId[to] = [...(upstreamByNodeId[to] ?? []), from];
  }

  const stageMap = new Map<number, string[]>();
  for (const node of plan.nodes) {
    const rank = plan.analytics.rankByNodeId[node.id] ?? 0;
    const group = stageMap.get(rank) ?? [];
    group.push(node.id);
    stageMap.set(rank, group);
  }

  const stages = [...stageMap.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([rank, ids]) => {
      const members = ids.map((id) => nodesById.get(id)).filter(Boolean);
      const completed = members.filter((node) => node?.status === "done" || node?.status === "skipped").length;
      const total = members.length || 1;
      const stageNodes = ids.map((id, index) => {
        const node = nodesById.get(id);
        return { id, tone: node ? getNodeTone(node) : "idle" as const, label: index + 1 };
      });
      return {
        id: `stage-${rank}`,
        title: rank === 0 ? graphCopy.compactEntryLabel : `${graphCopy.compactStageLabel} ${rank + 1}`,
        nodes: stageNodes,
        activeCount: members.filter((node) => node?.status === "active").length,
        attentionCount: members.filter((node) => node?.status === "waiting" || node?.status === "waiting_for_user" || node?.status === "blocked").length,
        doneCount: completed,
        completion: Math.round((completed / total) * 100),
      };
    });

  const focusIds = [...plan.analytics.activeNodeIds, ...plan.analytics.blockedNodeIds, ...plan.analytics.criticalPathNodeIds].filter((id, index, source) => source.indexOf(id) === index);
  const focusItems = focusIds.slice(0, 7).map((id) => {
    const node = nodesById.get(id);
    const upstreamCount = new Set(upstreamByNodeId[id] ?? []).size;
    const downstreamCount = new Set(downstreamByNodeId[id] ?? []).size;
    return {
      id,
      title: node?.title ?? id,
      statusLabel: node?.statusLabel ?? node?.status ?? "",
      summary: node?.summary ?? node?.objective ?? "",
      tone: node ? getNodeTone(node) : "idle",
      displayTone: node?.linkedTaskId ? "child-task" : node?.status === "waiting_for_user" ? "waiting" : node ? getNodeTone(node) : "idle",
      isCurrent: id === plan.currentStepId,
      hasLinkedTask: Boolean(node?.linkedTaskId),
      relationLabel: upstreamCount > 0 || downstreamCount > 0 ? [upstreamCount > 0 ? `${upstreamCount} upstream` : null, downstreamCount > 0 ? `${downstreamCount} downstream` : null].filter(Boolean).join(" · ") : null,
      phase: node?.phase ?? null,
      nextAction: node?.nextAction ?? null,
      estimatedMinutes: node?.estimatedMinutes ?? null,
    };
  });

  return {
    stages,
    focusItems,
    summary: {
      nodes: plan.nodes.length,
      active: plan.analytics.activeNodeIds.length,
      attention: plan.analytics.attentionNodeIds.length,
      done: plan.nodes.filter((node) => node.status === "done" || node.status === "skipped").length,
      currentLabel: plan.currentStepId ? nodesById.get(plan.currentStepId)?.title ?? null : null,
      statusLabel: plan.currentStepId ? nodesById.get(plan.currentStepId)?.statusLabel ?? nodesById.get(plan.currentStepId)?.status ?? null : null,
    },
  };
}

export function CompactStageStrip({ stages, graphCopy }: { stages: CompactStage[]; graphCopy: GraphCopy }) {
  return (
    <div className="rounded-[20px] border border-border/70 bg-background/80 p-3" data-testid="task-plan-compact-line">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] sm:items-center">
        <div className="min-w-0 space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">{graphCopy.graphStageMap}</p>
          <p className="text-xs leading-5 text-muted-foreground">{graphCopy.compactDescription}</p>
        </div>
        <div className="min-w-0 overflow-x-auto pb-1">
          <div className="flex min-w-max items-center gap-2">
            {stages.map((stage, index) => (
              <div key={stage.id} className="flex items-center gap-2">
                <div className="min-w-24 rounded-2xl border border-border/60 bg-muted/25 px-2.5 py-2">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="truncate text-[10px] font-medium text-muted-foreground">{stage.title}</p>
                    <span className="text-[10px] font-semibold text-foreground">{stage.completion}%</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5" aria-label={`${stage.title} nodes`}>
                    {stage.nodes.map((node) => {
                      const toneStyle = TONE_STYLES[node.tone];
                      return (
                        <span key={node.id} className={cn("size-2.5 rounded-full ring-2 ring-background", toneStyle.dot)} title={`${stage.title} node ${node.label}`} />
                      );
                    })}
                  </div>
                </div>
                {index < stages.length - 1 ? <span className="h-px w-5 bg-border" aria-hidden="true" /> : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function CompactFocusStack({
  items,
  selectedNodeId,
  onSelect,
  graphCopy,
  summary,
}: {
  items: CompactFocusItem[];
  selectedNodeId: string | null;
  onSelect: (nodeId: string) => void;
  graphCopy: GraphCopy;
  summary: { nodes: number; active: number; attention: number; done: number; currentLabel: string | null; statusLabel: string | null };
}) {
  return (
    <div className="space-y-2">
      {items.map((item) => {
        const toneStyle = TONE_STYLES[item.tone];
        const isSelected = selectedNodeId === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            data-testid={`task-plan-outline-node-${item.id}`}
            data-node-current={item.isCurrent ? "true" : "false"}
            data-node-tone={item.displayTone}
            className={cn(
              "w-full rounded-[20px] border px-3 py-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/35 hover:bg-accent/30",
              toneStyle.border,
              toneStyle.bg,
              isSelected && "ring-2 ring-primary/35",
            )}
          >
            <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
              <span className={cn("size-2 rounded-full", toneStyle.dot)} />
              <span>{item.statusLabel}</span>
              {item.phase ? <span>{item.phase}</span> : null}
              {item.isCurrent ? <span className="text-primary">{graphCopy.compactCurrentNode}</span> : null}
              {item.displayTone === "waiting" ? <span className="text-primary">{graphCopy.compactNeedsAction}</span> : null}
              {item.hasLinkedTask ? <span className="text-muted-foreground">{graphCopy.compactLinkedTask}</span> : null}
            </div>
            <p className="mt-1.5 break-words text-sm font-semibold text-foreground">{item.title}</p>
            <p className="mt-1 break-words text-xs leading-5 text-muted-foreground line-clamp-3">{item.summary}</p>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
              {item.nextAction ? <span className="rounded-full border border-border/70 bg-background/70 px-2 py-1">{item.nextAction}</span> : null}
              {item.estimatedMinutes ? <span className="rounded-full border border-border/70 bg-background/70 px-2 py-1">{item.estimatedMinutes}m</span> : null}
              {item.relationLabel ? <span className="rounded-full border border-border/70 bg-background/70 px-2 py-1">{item.relationLabel}</span> : null}
            </div>
          </button>
        );
      })}
    </div>
  );
}
