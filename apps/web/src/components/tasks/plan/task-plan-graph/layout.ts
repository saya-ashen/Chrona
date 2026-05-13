import dagre from "@dagrejs/dagre";
import ELK from "elkjs/lib/elk.bundled.js";
import { MarkerType, Position } from "@xyflow/react";
import {
  EDGE_OFFSET,
  LAYOUT_DIRECTION,
  LAYOUT_NODE_SEP,
  LAYOUT_PADDING,
  LAYOUT_RANK_SEP,
  MAX_VIEWPORT_HEIGHT,
  MIN_VIEWPORT_HEIGHT,
  NODE_HEIGHT,
  NODE_WIDTH,
  SELECTED_NODE_Z_INDEX,
} from "./constants";
import { buildEdgeStyle, getNodeTone, nodeShapeForKind } from "./logic";
import type { FlowGraphEdge, FlowGraphNode, GraphCopy, TaskPlanGraphPlan } from "./types";

const elk = new ELK();

export type FlowLayout = {
  nodes: FlowGraphNode[];
  edges: FlowGraphEdge[];
  contentWidth: number;
  contentHeight: number;
  viewportHeight: number;
};

type LayoutNodePosition = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type LayoutInput = {
  plan: TaskPlanGraphPlan;
  selectedNodeId: string | null;
  graphCopy: GraphCopy;
  onSelect: (nodeId: string) => void;
};

type GraphMaps = {
  incomingById: Map<string, string[]>;
  outgoingById: Map<string, string[]>;
  nodeById: Map<string, TaskPlanGraphPlan["nodes"][number]>;
};

type HybridLayoutMetadata = {
  laneById: Map<string, number>;
  rankById: Map<string, number>;
  roleById: Map<string, FlowGraphNode["data"]["layoutRole"]>;
};

const HORIZONTAL_LANE_GAP = NODE_WIDTH + LAYOUT_NODE_SEP + 80;
const VERTICAL_RANK_GAP = NODE_HEIGHT + LAYOUT_RANK_SEP;

function alternatingLane(index: number) {
  const magnitude = Math.floor(index / 2) + 1;
  return index % 2 === 0 ? -magnitude : magnitude;
}

function edgeEndpoints(edge: TaskPlanGraphPlan["edges"][number]) {
  return {
    from: edge.from ?? edge.fromNodeId ?? "",
    to: edge.to ?? edge.toNodeId ?? "",
  };
}

function buildGraphMaps(plan: TaskPlanGraphPlan): GraphMaps {
  const nodeById = new Map(plan.nodes.map((node) => [node.id, node]));
  const incomingById = new Map(plan.nodes.map((node) => [node.id, [] as string[]]));
  const outgoingById = new Map(plan.nodes.map((node) => [node.id, [] as string[]]));

  for (const edge of plan.edges) {
    const { from, to } = edgeEndpoints(edge);
    if (!from || !to) continue;
    outgoingById.get(from)?.push(to);
    incomingById.get(to)?.push(from);
  }

  return { incomingById, outgoingById, nodeById };
}

function isSidecarNode(node: TaskPlanGraphPlan["nodes"][number]) {
  return Boolean(
    node.requiresHumanInput ||
      node.kind === "wait" ||
      node.type === "wait" ||
      node.kind === "user_input" ||
      node.interactionType === "approve" ||
      node.interactionType === "confirm" ||
      node.interactionType === "input" ||
      node.interactionType === "wait" ||
      node.intent === "approval" ||
      node.intent === "input",
  );
}

function numericRecordValue(record: Record<string, number>, id: string) {
  const value = record[id];
  return Number.isFinite(value) ? value : null;
}

function inferRankById(plan: TaskPlanGraphPlan, maps: GraphMaps) {
  const rankById = new Map<string, number>();
  const pending = [...plan.nodes.map((node) => node.id)];
  let guard = pending.length * pending.length + 1;

  for (const id of pending) {
    const explicitRank = numericRecordValue(plan.analytics.rankByNodeId, id);
    if (explicitRank !== null) rankById.set(id, explicitRank);
  }

  while (pending.length > 0 && guard > 0) {
    guard -= 1;
    const id = pending.shift();
    if (!id || rankById.has(id)) continue;
    const parents = maps.incomingById.get(id) ?? [];
    if (parents.length === 0) {
      rankById.set(id, 0);
      continue;
    }
    if (parents.every((parentId) => rankById.has(parentId))) {
      rankById.set(id, Math.max(...parents.map((parentId) => rankById.get(parentId) ?? 0)) + 1);
      continue;
    }
    pending.push(id);
  }

  for (const [index, node] of plan.nodes.entries()) {
    if (!rankById.has(node.id)) rankById.set(node.id, index);
  }

  return rankById;
}

function primaryPathIds(plan: TaskPlanGraphPlan, maps: GraphMaps) {
  const explicitPath = plan.analytics.criticalPathNodeIds.filter((id) => maps.nodeById.has(id));
  if (explicitPath.length > 1) return explicitPath;

  const path: string[] = [];
  let current: string | null = plan.currentStepId && maps.nodeById.has(plan.currentStepId)
    ? plan.currentStepId
    : (plan.analytics.entryNodeIds.find((id) => maps.nodeById.has(id)) ?? plan.nodes[0]?.id ?? null);
  const seen = new Set<string>();

  while (current && !seen.has(current)) {
    seen.add(current);
    path.push(current);
    const next: string | undefined = (maps.outgoingById.get(current) ?? []).find((id) => {
      const candidate = maps.nodeById.get(id);
      return candidate ? !isSidecarNode(candidate) : false;
    });
    current = next ?? null;
  }

  return path.length > 0 ? path : plan.nodes.map((node) => node.id);
}

function inferHybridLayoutMetadata(plan: TaskPlanGraphPlan, maps: GraphMaps): HybridLayoutMetadata {
  const rankById = inferRankById(plan, maps);
  const laneById = new Map<string, number>();
  const roleById = new Map<string, FlowGraphNode["data"]["layoutRole"]>();
  const primary = new Set(primaryPathIds(plan, maps));

  for (const node of plan.nodes) {
    const explicitLane = numericRecordValue(plan.analytics.laneByNodeId, node.id);
    laneById.set(node.id, explicitLane ?? 0);
    roleById.set(node.id, primary.has(node.id) ? "primary" : "parallel");
  }

  for (const node of plan.nodes) {
    if (!isSidecarNode(node) || primary.has(node.id)) continue;
    const parents = maps.incomingById.get(node.id) ?? [];
    const anchorId = parents.find((id) => primary.has(id)) ?? parents[0];
    const sidecarSiblings = (anchorId ? maps.outgoingById.get(anchorId) : plan.nodes.map((item) => item.id))
      ?.filter((id) => {
        const sibling = maps.nodeById.get(id);
        return sibling && !primary.has(id) && isSidecarNode(sibling);
      }) ?? [];
    const sidecarIndex = Math.max(0, sidecarSiblings.indexOf(node.id));
    const anchorLane = anchorId ? (laneById.get(anchorId) ?? 0) : 0;
    const anchorRank = anchorId ? (rankById.get(anchorId) ?? rankById.get(node.id) ?? 0) : (rankById.get(node.id) ?? 0);
    laneById.set(node.id, anchorLane + alternatingLane(sidecarIndex) * 0.82);
    rankById.set(node.id, anchorRank + 0.35);
    roleById.set(node.id, "sidecar");
  }

  for (const node of plan.nodes) {
    const children = (maps.outgoingById.get(node.id) ?? []).filter((id) => !primary.has(id) && roleById.get(id) !== "sidecar");
    if (children.length < 2 && node.kind !== "condition" && node.type !== "condition") continue;

    children.forEach((childId, index) => {
      const lane = alternatingLane(index);
      laneById.set(childId, lane);
      roleById.set(childId, "branch");

      let current = childId;
      const seen = new Set<string>();
      while (!seen.has(current)) {
        seen.add(current);
        const nextCandidates = (maps.outgoingById.get(current) ?? []).filter((id) => !primary.has(id));
        if (nextCandidates.length !== 1) break;
        const next = nextCandidates[0];
        if ((maps.incomingById.get(next) ?? []).length > 1 || roleById.get(next) === "sidecar") break;
        laneById.set(next, lane);
        roleById.set(next, "branch");
        current = next;
      }
    });
  }

  const groupedByRank = new Map<number, string[]>();
  for (const node of plan.nodes) {
    if (roleById.get(node.id) !== "parallel") continue;
    const rank = Math.round(rankById.get(node.id) ?? 0);
    groupedByRank.set(rank, [...(groupedByRank.get(rank) ?? []), node.id]);
  }

  for (const siblings of groupedByRank.values()) {
    if (siblings.length < 2) continue;
    siblings.forEach((id, index) => {
      laneById.set(id, alternatingLane(index));
    });
  }

  return { laneById, rankById, roleById };
}

function applyHybridLayout(input: LayoutInput, layoutNodes: Map<string, LayoutNodePosition>) {
  const maps = buildGraphMaps(input.plan);
  const metadata = inferHybridLayoutMetadata(input.plan, maps);
  const primaryNodes = input.plan.nodes.filter((node) => metadata.roleById.get(node.id) === "primary");
  const primaryCenter = primaryNodes.length > 0
    ? primaryNodes.reduce((sum, node) => {
      const layoutNode = layoutNodes.get(node.id);
      return sum + (layoutNode ? layoutNode.x + layoutNode.width / 2 : 0);
    }, 0) / primaryNodes.length
    : 0;

  for (const node of input.plan.nodes) {
    const layoutNode = layoutNodes.get(node.id);
    if (!layoutNode) continue;
    const lane = metadata.laneById.get(node.id) ?? 0;
    const rank = metadata.rankById.get(node.id) ?? 0;
    const role = metadata.roleById.get(node.id);
    const targetX = primaryCenter + lane * HORIZONTAL_LANE_GAP - layoutNode.width / 2;
    const targetY = rank * VERTICAL_RANK_GAP;

    if (role === "primary") {
      layoutNode.x = layoutNode.x * 0.35 + targetX * 0.65;
      continue;
    }

    if (role === "sidecar") {
      layoutNode.x = targetX;
      layoutNode.y = layoutNode.y * 0.25 + targetY * 0.75;
      continue;
    }

    layoutNode.x = layoutNode.x * 0.25 + targetX * 0.75;
    layoutNode.y = layoutNode.y * 0.4 + targetY * 0.6;
  }

  return metadata;
}

function resolveRuntimeEdgeState(sourceNode: TaskPlanGraphPlan["nodes"][number] | undefined, targetNode: TaskPlanGraphPlan["nodes"][number] | undefined) {
  if (!sourceNode || !targetNode) {
    return null;
  }

  if (targetNode.status === "blocked") {
    return "blocked" as const;
  }

  if (targetNode.status === "waiting" && targetNode.intent === "approval") {
    return "approval" as const;
  }

  if (targetNode.status === "waiting") {
    return "input" as const;
  }

  if (sourceNode.status === "active" || targetNode.status === "active") {
    return "active" as const;
  }

  return null;
}

function edgeMinLength(sourceNode: TaskPlanGraphPlan["nodes"][number] | undefined, targetNode: TaskPlanGraphPlan["nodes"][number] | undefined) {
  if (!sourceNode || !targetNode) return 1;
  if (sourceNode.kind === "condition" || sourceNode.type === "condition") return 2;
  if (targetNode.status === "blocked" || targetNode.requiresHumanInput) return 2;
  return 1;
}

function materializeFlowLayout(input: LayoutInput, layoutNodes: Map<string, LayoutNodePosition>, metadata?: HybridLayoutMetadata): FlowLayout {
  let minLeft = Number.POSITIVE_INFINITY;
  let minTop = Number.POSITIVE_INFINITY;
  let maxRight = Number.NEGATIVE_INFINITY;
  let maxBottom = Number.NEGATIVE_INFINITY;

  for (const node of input.plan.nodes) {
    const layoutNode = layoutNodes.get(node.id);
    if (!layoutNode) continue;
    const left = layoutNode.x;
    const top = layoutNode.y;
    const right = layoutNode.x + layoutNode.width;
    const bottom = layoutNode.y + layoutNode.height;
    minLeft = Math.min(minLeft, left);
    minTop = Math.min(minTop, top);
    maxRight = Math.max(maxRight, right);
    maxBottom = Math.max(maxBottom, bottom);
  }

  if (!Number.isFinite(minLeft) || !Number.isFinite(minTop) || !Number.isFinite(maxRight) || !Number.isFinite(maxBottom)) {
    minLeft = 0;
    minTop = 0;
    maxRight = NODE_WIDTH;
    maxBottom = NODE_HEIGHT;
  }

  const contentWidth = Math.max(Math.ceil(maxRight - minLeft + LAYOUT_PADDING * 2), NODE_WIDTH + LAYOUT_PADDING * 2);
  const rawContentHeight = Math.max(Math.ceil(maxBottom - minTop + LAYOUT_PADDING * 2), NODE_HEIGHT + LAYOUT_PADDING * 2);
  const viewportHeight = Math.max(Math.min(rawContentHeight, MAX_VIEWPORT_HEIGHT), MIN_VIEWPORT_HEIGHT);
  const contentHeight = Math.max(rawContentHeight, viewportHeight);

  const focusSet = new Set(input.plan.analytics.reachableFromActiveIds);
  const nodeById = new Map(input.plan.nodes.map((node) => [node.id, node]));

  const nodes: FlowGraphNode[] = input.plan.nodes.map((node, index) => {
    const layoutNode = layoutNodes.get(node.id) ?? { x: 0, y: 0, width: NODE_WIDTH, height: NODE_HEIGHT };
    const isSelected = node.id === input.selectedNodeId;
    return {
      id: node.id,
      type: "taskPlanNode",
      position: {
        x: layoutNode.x - minLeft + LAYOUT_PADDING,
        y: layoutNode.y - minTop + LAYOUT_PADDING,
      },
      width: layoutNode.width,
      height: layoutNode.height,
      initialWidth: layoutNode.width,
      initialHeight: layoutNode.height,
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      draggable: false,
      selectable: false,
      zIndex: isSelected ? SELECTED_NODE_Z_INDEX : 1,
      style: {
        zIndex: isSelected ? SELECTED_NODE_Z_INDEX : 1,
        opacity: focusSet.size === 0 || focusSet.has(node.id) || node.status === "blocked" ? 1 : 0.48,
      },
      data: {
        node,
        stepNumber: index + 1,
        layoutRole: metadata?.roleById.get(node.id),
        tone: getNodeTone(node),
        shape: nodeShapeForKind(node.kind === "step" || node.kind === "user_input" ? "task" : (node.kind ?? node.type ?? "task")),
        isSelected,
        isCurrent: node.id === input.plan.currentStepId,
        isFocus: focusSet.size === 0 || focusSet.has(node.id) || node.status === "blocked",
        graphCopy: input.graphCopy,
        onSelect: input.onSelect,
      },
    };
  });

  const edges: FlowGraphEdge[] = input.plan.edges.map((edge) => {
    const from = edge.from ?? edge.fromNodeId ?? "";
    const to = edge.to ?? edge.toNodeId ?? "";
    const baseStyle = buildEdgeStyle(edge.kind ?? "sequential", edge.emphasis ?? "normal");
    const runtimeEdgeState = resolveRuntimeEdgeState(nodeById.get(from), nodeById.get(to));

    const runtimeStyle = runtimeEdgeState === "active"
      ? { stroke: "rgba(14, 165, 233, 0.9)", strokeWidth: 2.35, strokeDasharray: undefined }
      : runtimeEdgeState === "approval"
        ? { stroke: "rgba(217, 70, 239, 0.84)", strokeWidth: 2.2, strokeDasharray: "7 5" }
        : runtimeEdgeState === "input"
          ? { stroke: "rgba(245, 158, 11, 0.84)", strokeWidth: 2.2, strokeDasharray: "7 5" }
          : runtimeEdgeState === "blocked"
            ? { stroke: "rgba(244, 63, 94, 0.88)", strokeWidth: 2.3, strokeDasharray: undefined }
            : null;

    return {
      id: edge.id,
      source: from,
      target: to,
      type: "taskPlanEdge",
      selectable: false,
      reconnectable: false,
      animated: runtimeEdgeState === "active" || runtimeEdgeState === "approval" || runtimeEdgeState === "input",
      zIndex: 6,
      pathOptions: { borderRadius: 0, offset: EDGE_OFFSET },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: (runtimeStyle ?? baseStyle).stroke,
      },
      style: {
        ...(runtimeStyle ?? baseStyle),
        opacity: runtimeStyle || (edge.emphasis ?? "normal") !== "normal"
          ? 1
          : focusSet.size > 0 && !focusSet.has(from) && !focusSet.has(to)
            ? 0.35
            : 1,
      },
      data: {
        stableLabel: edge.label ?? undefined,
        bypassOffset: edgeMinLength(nodeById.get(from), nodeById.get(to)) > 1 ? EDGE_OFFSET + 10 : EDGE_OFFSET,
      },
    };
  });

  return { nodes, edges, contentWidth, contentHeight, viewportHeight };
}

export function buildFallbackFlowLayout(input: LayoutInput): FlowLayout {
  const nodeCount = input.plan.nodes.length;
  const denseGraph = nodeCount >= 8;
  const compactNodeSep = denseGraph ? Math.max(24, LAYOUT_NODE_SEP - 10) : LAYOUT_NODE_SEP;
  const compactRankSep = denseGraph ? Math.max(58, LAYOUT_RANK_SEP - 8) : LAYOUT_RANK_SEP;

  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: LAYOUT_DIRECTION,
    align: "UL",
    acyclicer: "greedy",
    ranker: "tight-tree",
    nodesep: compactNodeSep,
    ranksep: compactRankSep,
    marginx: LAYOUT_PADDING,
    marginy: LAYOUT_PADDING,
  });

  for (const node of input.plan.nodes) {
    graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  const nodeById = new Map(input.plan.nodes.map((node) => [node.id, node]));

  for (const edge of input.plan.edges) {
    const from = edge.from ?? edge.fromNodeId;
    const to = edge.to ?? edge.toNodeId;
    if (!from || !to) continue;
    graph.setEdge(from, to, { minlen: edgeMinLength(nodeById.get(from), nodeById.get(to)), weight: edge.kind === "sequential" ? 3 : 1 });
  }

  dagre.layout(graph);

  const layoutNodes = new Map<string, LayoutNodePosition>();
  for (const node of input.plan.nodes) {
    const layoutNode = graph.node(node.id);
    if (!layoutNode) continue;
    layoutNodes.set(node.id, {
      x: layoutNode.x - layoutNode.width / 2,
      y: layoutNode.y - layoutNode.height / 2,
      width: layoutNode.width,
      height: layoutNode.height,
    });
  }

  const metadata = applyHybridLayout(input, layoutNodes);
  return materializeFlowLayout(input, layoutNodes, metadata);
}

export async function buildFlowLayout(input: LayoutInput): Promise<FlowLayout> {
  const nodeCount = input.plan.nodes.length;
  const denseGraph = nodeCount >= 8;
  const compactNodeSep = denseGraph ? Math.max(28, LAYOUT_NODE_SEP - 6) : LAYOUT_NODE_SEP;
  const compactRankSep = denseGraph ? Math.max(60, LAYOUT_RANK_SEP - 6) : LAYOUT_RANK_SEP;

  try {
    const graph = await elk.layout({
      id: "task-plan-graph",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "DOWN",
        "elk.aspectRatio": "1.45",
        "elk.layered.spacing.nodeNodeBetweenLayers": String(compactRankSep),
        "elk.spacing.nodeNode": String(compactNodeSep),
        "elk.spacing.edgeNode": "18",
        "elk.spacing.edgeEdge": "12",
        "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
        "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
        "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
        "elk.layered.edgeRouting": "ORTHOGONAL",
      },
      children: input.plan.nodes.map((node) => ({
        id: node.id,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      })),
      edges: input.plan.edges.flatMap((edge) => {
        const from = edge.from ?? edge.fromNodeId;
        const to = edge.to ?? edge.toNodeId;
        return from && to
          ? [{ id: edge.id, sources: [from], targets: [to] }]
          : [];
      }),
    });

    const layoutNodes = new Map<string, LayoutNodePosition>();
    for (const node of graph.children ?? []) {
      if (typeof node.x !== "number" || typeof node.y !== "number") continue;
      layoutNodes.set(node.id, {
        x: node.x,
        y: node.y,
        width: typeof node.width === "number" ? node.width : NODE_WIDTH,
        height: typeof node.height === "number" ? node.height : NODE_HEIGHT,
      });
    }

    const metadata = applyHybridLayout(input, layoutNodes);
    return materializeFlowLayout(input, layoutNodes, metadata);
  } catch {
    return buildFallbackFlowLayout(input);
  }
}

export function syncNodeState(
  nodes: FlowGraphNode[],
  input: { selectedNodeId: string | null; graphCopy: GraphCopy; onSelect: (nodeId: string) => void; focusNodeIds: string[] },
) {
  const focusSet = new Set(input.focusNodeIds);
  return nodes.map((node) => {
    const isSelected = node.id === input.selectedNodeId;
    const isFocus = focusSet.size === 0 || focusSet.has(node.id) || node.data.node.status === "blocked";
    return {
      ...node,
      draggable: false,
      selectable: false,
      zIndex: isSelected ? SELECTED_NODE_Z_INDEX : 1,
      style: {
        ...node.style,
        zIndex: isSelected ? SELECTED_NODE_Z_INDEX : 1,
        opacity: isFocus ? 1 : 0.48,
      },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      data: {
        ...node.data,
        isSelected,
        isCurrent: node.data.isCurrent,
        isFocus,
        graphCopy: input.graphCopy,
        onSelect: input.onSelect,
      },
    };
  });
}
