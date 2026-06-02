import { cn } from "@/lib/utils";
import { getNodeTone, TONE_STYLES } from "./logic";
import type { CompactFocusItem, CompactStage, GraphCopy, TaskPlanGraphPlan } from "./types";

export function buildCompactViewModel(plan: TaskPlanGraphPlan): {
  stages: CompactStage[];
  focusItems: CompactFocusItem[];
} {
  const nodesById = new Map(plan.nodes.map((node) => [node.id, node]));
  const upstreamByNodeId: Record<string, string[]> = Object.fromEntries(
    plan.nodes.map((node) => [node.id, [...(plan.analytics.upstreamByNodeId[node.id] ?? [])]]),
  );
  const downstreamByNodeId: Record<string, string[]> = Object.fromEntries(
    plan.nodes.map((node) => [node.id, [...(plan.analytics.downstreamByNodeId[node.id] ?? [])]]),
  );

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
      return {
        id: `stage-${rank}`,
        title: rank === 0 ? "Entry" : `Stage ${rank + 1}`,
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
    const upstreamCount = new Set(upstreamByNodeId[id] ?? []).size;
    const downstreamCount = new Set(downstreamByNodeId[id] ?? []).size;
    return {
      id,
      title: node?.title ?? id,
      statusLabel: node?.statusLabel ?? "",
      summary: node?.summary ?? "",
      tone: node ? getNodeTone(node) : "idle",
      displayTone:
        node?.linkedTaskId
          ? "child-task"
          : node?.status === "waiting_for_user"
          ? "waiting"
          : node
            ? getNodeTone(node)
            : "idle",
      isCurrent: id === plan.currentStepId,
      hasLinkedTask: Boolean(node?.linkedTaskId),
      relationLabel:
        upstreamCount > 0 || downstreamCount > 0
          ? [
              upstreamCount > 0 ? `${upstreamCount} upstream` : null,
              downstreamCount > 0 ? `${downstreamCount} downstream` : null,
            ].filter(Boolean).join(" · ")
          : null,
    };
  });

  return { stages, focusItems };
}

export function CompactStageStrip({ stages }: { stages: CompactStage[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {stages.map((stage) => (
        <div key={stage.id} className="rounded-[20px] border border-border bg-background px-3 py-3">
          <p className="text-[10px] font-medium text-muted-foreground">{stage.title}</p>
          <p className="mt-1 text-lg font-semibold text-foreground">{stage.nodeIds.length}</p>
          <div className="mt-2 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
            {stage.activeCount > 0 ? <span className="rounded-full border border-primary/20 bg-primary-soft px-1.5 py-0.5 text-primary">{stage.activeCount} active</span> : null}
            {stage.attentionCount > 0 ? <span className="rounded-full border border-primary/20 bg-primary-soft px-1.5 py-0.5 text-primary">{stage.attentionCount} attention</span> : null}
            {stage.doneCount > 0 ? <span className="rounded-full border border-border bg-muted px-1.5 py-0.5 text-muted-foreground">{stage.doneCount} done</span> : null}
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
      <div className="grid gap-2 border-l border-primary/25 pl-3" data-testid="task-plan-compact-groups">
        <p className="text-[11px] font-medium text-foreground">Current progress</p>
        <p className="text-[11px] font-medium text-muted-foreground">Action / blocked</p>
        <p className="text-[11px] font-medium text-muted-foreground">Next summary</p>
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
              "w-full rounded-[20px] border px-3 py-2.5 text-left shadow-sm transition-colors hover:border-primary/35 hover:bg-accent/30",
              toneStyle.border,
              toneStyle.bg,
              isSelected && "ring-2 ring-primary/35",
            )}
          >
            <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
              <span className={cn("size-2 rounded-full", toneStyle.dot)} />
              <span>{item.statusLabel}</span>
              {item.isCurrent ? <span className="text-primary">Current node</span> : null}
              {item.displayTone === "waiting" ? <span className="text-primary">Needs action</span> : null}
              {item.hasLinkedTask ? <span className="text-muted-foreground">Linked task</span> : null}
            </div>
            <p className="mt-1 break-words text-sm font-medium text-foreground">{item.title}</p>
            <p className="mt-1 break-words text-[11px] text-muted-foreground line-clamp-2">{item.summary}</p>
            {item.relationLabel ? <p className="mt-1 break-words text-[10px] text-muted-foreground">{item.relationLabel}</p> : null}
          </button>
        );
      })}
    </div>
  );
}
