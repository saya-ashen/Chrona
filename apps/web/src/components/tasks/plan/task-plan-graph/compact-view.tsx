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
      return {
        id: `stage-${rank}`,
        title: rank === 0 ? graphCopy.compactEntryLabel : `${graphCopy.compactStageLabel} ${rank + 1}`,
        nodeIds: ids,
        activeCount: members.filter((node) => node?.status === "active").length,
        attentionCount: members.filter((node) => node?.status === "waiting" || node?.status === "blocked").length,
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
    <div className="min-w-0 overflow-x-auto pb-1" data-testid="task-plan-compact-line">
      <div className="flex min-w-max items-stretch gap-2">
        {stages.map((stage, index) => (
          <div key={stage.id} className="flex items-center gap-2">
            <div className="min-w-28 rounded-2xl border border-border/70 bg-background px-3 py-2 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-[10px] font-medium text-muted-foreground">{stage.title}</p>
                <span className="rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-foreground">{stage.completion}%</span>
              </div>
              <p className="mt-1 text-base font-semibold text-foreground">{stage.nodeIds.length}</p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary/80" style={{ width: `${stage.completion}%` }} />
              </div>
              <div className="mt-1 flex gap-1 text-[10px] text-muted-foreground">
                {stage.activeCount > 0 ? <span className="text-primary">{stage.activeCount} {graphCopy.compactActiveSuffix}</span> : null}
                {stage.attentionCount > 0 ? <span className="text-primary">{stage.attentionCount} {graphCopy.compactAttentionSuffix}</span> : null}
                {stage.doneCount > 0 ? <span>{stage.doneCount} {graphCopy.compactDoneSuffix}</span> : null}
              </div>
            </div>
            {index < stages.length - 1 ? <span className="h-px w-5 bg-border" aria-hidden="true" /> : null}
          </div>
        ))}
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
      <div className="rounded-[20px] border border-border/70 bg-background/80 p-3 shadow-sm" data-testid="task-plan-compact-groups">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-[11px] font-medium text-muted-foreground">{graphCopy.compactCurrentProgress}</p>
            <p className="mt-0.5 text-sm font-semibold text-foreground">{summary.currentLabel ?? graphCopy.compactCurrentNode}</p>
            <p className="text-[11px] text-muted-foreground">{summary.statusLabel ?? graphCopy.compactNeedsAction}</p>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
            <span className="rounded-full border border-border bg-muted px-2 py-1">{summary.nodes} nodes</span>
            <span className="rounded-full border border-border bg-muted px-2 py-1">{summary.active} active</span>
            <span className="rounded-full border border-border bg-muted px-2 py-1">{summary.attention} attention</span>
            <span className="rounded-full border border-border bg-muted px-2 py-1">{summary.done} done</span>
          </div>
        </div>
      </div>
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
              "w-full rounded-[20px] border px-3 py-2.5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/35 hover:bg-accent/30",
              toneStyle.border,
              toneStyle.bg,
              isSelected && "ring-2 ring-primary/35",
            )}
          >
            <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
              <span className={cn("size-2 rounded-full", toneStyle.dot)} />
              <span>{item.statusLabel}</span>
              {item.isCurrent ? <span className="text-primary">{graphCopy.compactCurrentNode}</span> : null}
              {item.displayTone === "waiting" ? <span className="text-primary">{graphCopy.compactNeedsAction}</span> : null}
              {item.hasLinkedTask ? <span className="text-muted-foreground">{graphCopy.compactLinkedTask}</span> : null}
            </div>
            <p className="mt-1 break-words text-sm font-semibold text-foreground">{item.title}</p>
            <p className="mt-1 break-words text-[11px] text-muted-foreground line-clamp-2">{item.summary}</p>
            {item.relationLabel ? <p className="mt-1 break-words text-[10px] text-muted-foreground">{item.relationLabel}</p> : null}
          </button>
        );
      })}
    </div>
  );
}
