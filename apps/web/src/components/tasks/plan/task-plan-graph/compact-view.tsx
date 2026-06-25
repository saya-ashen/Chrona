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
        return {
          id,
          tone: node ? getNodeTone(node) : "idle" as const,
          label: index + 1,
          lane: plan.analytics.laneByNodeId[id] ?? index,
          isCurrent: id === plan.currentStepId,
        };
      });
      const stageNodeIds = new Set(ids);
      const stageEdges = plan.edges.flatMap((edge) => {
        const from = edge.from ?? edge.fromNodeId;
        const to = edge.to ?? edge.toNodeId;
        return from && to && stageNodeIds.has(from) && nodesById.has(to) ? [{ id: edge.id, from, to }] : [];
      });
      return {
        id: `stage-${rank}`,
        title: rank === 0 ? graphCopy.compactEntryLabel : `${graphCopy.compactStageLabel} ${rank + 1}`,
        nodes: stageNodes,
        edges: stageEdges,
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

const MINI_NODE_RADIUS = 5;
const MINI_STAGE_GAP = 30;
const MINI_LANE_GAP = 22;
const MINI_PADDING_X = 12;
const MINI_PADDING_Y = 12;

function minimapNodeClass(tone: CompactStage["nodes"][number]["tone"]) {
  if (tone === "done") return "fill-success stroke-success";
  if (tone === "active") return "fill-primary stroke-primary";
  if (tone === "attention" || tone === "upcoming") return "fill-warning stroke-warning";
  if (tone === "blocked") return "fill-destructive stroke-destructive";
  if (tone === "skipped") return "fill-muted stroke-muted-foreground/70";
  return "fill-muted-foreground/65 stroke-muted-foreground/65";
}

export function CompactStageStrip({ stages }: { stages: CompactStage[]; graphCopy: GraphCopy }) {
  const positionedStages = stages.map((stage, stageIndex) => {
    const lanes = [...new Set(stage.nodes.map((node) => node.lane))].sort((left, right) => left - right);
    const laneIndexByLane = new Map(lanes.map((lane, index) => [lane, index]));
    return {
      ...stage,
      x: MINI_PADDING_X + stageIndex * MINI_STAGE_GAP,
      nodes: stage.nodes.map((node) => ({
        ...node,
        x: MINI_PADDING_X + stageIndex * MINI_STAGE_GAP,
        y: MINI_PADDING_Y + (laneIndexByLane.get(node.lane) ?? 0) * MINI_LANE_GAP,
      })),
    };
  });
  const nodesById = new Map(positionedStages.flatMap((stage) => stage.nodes.map((node) => [node.id, node])));
  const stageCount = Math.max(positionedStages.length, 1);
  const laneCount = Math.max(...positionedStages.map((stage) => new Set(stage.nodes.map((node) => node.lane)).size), 1);
  const width = MINI_PADDING_X * 2 + Math.max(stageCount - 1, 0) * MINI_STAGE_GAP + MINI_NODE_RADIUS * 2;
  const height = MINI_PADDING_Y * 2 + Math.max(laneCount - 1, 0) * MINI_LANE_GAP + MINI_NODE_RADIUS * 2;
  return (
    <div className="rounded-[20px] border border-border/70 bg-background/80 p-3" data-testid="task-plan-compact-line">
      <div className="min-w-0 overflow-x-auto">
        <svg className="block min-w-full" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Plan minimap">
          {positionedStages.flatMap((stage) => stage.edges.map((edge) => {
            const from = nodesById.get(edge.from);
            const to = nodesById.get(edge.to);
            if (!from || !to) return null;
            return (
              <line key={edge.id} x1={from.x} y1={from.y} x2={to.x} y2={to.y} className="stroke-border/80" strokeWidth="2" strokeLinecap="round" />
            );
          }))}
          {positionedStages.map((stage) => stage.nodes.map((node) => (
            <g key={node.id}>
              {node.isCurrent ? <circle cx={node.x} cy={node.y} r={MINI_NODE_RADIUS + 4} className="fill-primary/10 stroke-primary/50" strokeWidth="1.5" /> : null}
              <circle cx={node.x} cy={node.y} r={MINI_NODE_RADIUS} className={cn("stroke-[1.5]", minimapNodeClass(node.tone))}>
                <title>{`${stage.title} node ${node.label}`}</title>
              </circle>
            </g>
          )))}
        </svg>
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
