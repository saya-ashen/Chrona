import { cn } from "@/lib/utils";
import { getNodeTone, TONE_STYLES } from "./logic";
import type { CompactFocusItem, CompactStage, GraphCopy, TaskPlanGraphPlan } from "./types";

export function buildCompactViewModel(plan: TaskPlanGraphPlan): {
  stages: CompactStage[];
  focusItems: CompactFocusItem[];
} {
  const nodesById = new Map(plan.nodes.map((node) => [node.id, node]));
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
      return {
        id: `stage-${rank}`,
        title: rank === 0 ? "入口" : `阶段 ${rank + 1}`,
        nodeIds: ids,
        activeCount: members.filter((node) => node?.status === "active").length,
        attentionCount: members.filter((node) => node?.status === "waiting" || node?.status === "blocked").length,
        doneCount: members.filter((node) => node?.status === "done" || node?.status === "skipped").length,
      };
    });

  const focusIds = [
    ...plan.analytics.activeNodeIds,
    ...plan.analytics.blockedNodeIds,
    ...plan.analytics.criticalPathNodeIds,
  ].filter((id, index, source) => source.indexOf(id) === index);

  const focusItems = focusIds.slice(0, 7).map((id) => {
    const node = nodesById.get(id);
    const upstreamCount = plan.analytics.upstreamByNodeId[id]?.length ?? 0;
    const downstreamCount = plan.analytics.downstreamByNodeId[id]?.length ?? 0;
    return {
      id,
      title: node?.title ?? id,
      statusLabel: node?.statusLabel ?? "",
      summary: node?.summary ?? "",
      tone: node ? getNodeTone(node) : "idle",
      relationLabel:
        upstreamCount > 0 || downstreamCount > 0 ? `${upstreamCount} 前置 · ${downstreamCount} 后续` : null,
    };
  });

  return { stages, focusItems };
}

export function CompactStageStrip({ stages }: { stages: CompactStage[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {stages.map((stage) => (
        <div key={stage.id} className="rounded-[20px] border border-border/60 bg-background/82 px-3 py-3 shadow-sm">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{stage.title}</p>
          <p className="mt-1 text-lg font-semibold text-foreground">{stage.nodeIds.length}</p>
          <div className="mt-2 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
            {stage.activeCount > 0 ? <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-sky-700">{stage.activeCount} active</span> : null}
            {stage.attentionCount > 0 ? <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-amber-700">{stage.attentionCount} attention</span> : null}
            {stage.doneCount > 0 ? <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-slate-700">{stage.doneCount} done</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export function CompactFocusStack({
  items,
  selectedNodeId,
  onSelect,
  graphCopy: _graphCopy,
}: {
  items: CompactFocusItem[];
  selectedNodeId: string | null;
  onSelect: (nodeId: string) => void;
  graphCopy: GraphCopy;
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
            data-testid={`task-plan-focus-node-${item.id}`}
            className={cn(
              "w-full rounded-[20px] border px-3 py-2.5 text-left transition-colors",
              toneStyle.border,
              toneStyle.bg,
              isSelected && "ring-1 ring-foreground/10",
            )}
          >
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              <span className={cn("size-2 rounded-full", toneStyle.dot)} />
              <span>{item.statusLabel}</span>
            </div>
            <p className="mt-1 text-sm font-medium text-foreground">{item.title}</p>
            <p className="mt-1 text-[11px] text-muted-foreground line-clamp-2">{item.summary}</p>
            {item.relationLabel ? <p className="mt-1 text-[10px] text-muted-foreground">{item.relationLabel}</p> : null}
          </button>
        );
      })}
    </div>
  );
}
