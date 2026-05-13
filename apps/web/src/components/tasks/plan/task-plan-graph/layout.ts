import { coordGreedy, decrossDfs, graphConnect, sugiyama, tweakDirection } from "d3-dag";
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

export type FlowLayout = {
  nodes: FlowGraphNode[];
  edges: FlowGraphEdge[];
  contentWidth: number;
  contentHeight: number;
  viewportHeight: number;
  layoutDirection: "TB" | "LR";
};

type LayoutNodePosition = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type DagLayoutNode = {
  id: string;
};

type DagLayoutLink = {
  edge: TaskPlanGraphPlan["edges"][number];
  source: string;
  target: string;
};

type LayoutInput = {
  plan: TaskPlanGraphPlan;
  selectedNodeId: string | null;
  graphCopy: GraphCopy;
  onSelect: (nodeId: string) => void;
};

type LayoutMode = "horizontal";

type GraphMaps = {
  incomingById: Map<string, string[]>;
  outgoingById: Map<string, string[]>;
  nodeById: Map<string, TaskPlanGraphPlan["nodes"][number]>;
};

type HybridLayoutMetadata = {
  roleById: Map<string, FlowGraphNode["data"]["layoutRole"]>;
  horizontalRunByNodeId: Map<string, string[]>;
  horizontalEdgeIds: Set<string>;
  layoutMode: LayoutMode;
};

const MIN_HORIZONTAL_RUN_LENGTH = 4;

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

function mainOutgoingIds(id: string, maps: GraphMaps) {
  return (maps.outgoingById.get(id) ?? []).filter((targetId) => {
    const target = maps.nodeById.get(targetId);
    return target && !isSidecarNode(target);
  });
}

function mainIncomingIds(id: string, maps: GraphMaps) {
  return (maps.incomingById.get(id) ?? []).filter((sourceId) => {
    const source = maps.nodeById.get(sourceId);
    return source && !isSidecarNode(source);
  });
}

function isConditionNode(node: TaskPlanGraphPlan["nodes"][number] | undefined) {
  return Boolean(node?.kind === "condition" || node?.type === "condition");
}

function isHorizontalChainNode(id: string, maps: GraphMaps) {
  const node = maps.nodeById.get(id);
  if (!node) return false;
  if (isSidecarNode(node)) return false;
  if (isConditionNode(node)) return false;
  if (mainIncomingIds(id, maps).length > 1) return false;
  if (mainOutgoingIds(id, maps).length > 1) return false;
  return true;
}

function findLinearRuns(plan: TaskPlanGraphPlan, maps: GraphMaps) {
  const visited = new Set<string>();
  const runs: string[][] = [];

  for (const node of plan.nodes) {
    if (visited.has(node.id)) continue;
    if (!isHorizontalChainNode(node.id, maps)) continue;

    const incoming = mainIncomingIds(node.id, maps);
    const isMiddleOfRun =
      incoming.length === 1 &&
      mainOutgoingIds(incoming[0], maps).length === 1 &&
      isHorizontalChainNode(incoming[0], maps);

    if (isMiddleOfRun) continue;

    const run = [node.id];
    let current = node.id;

    while (true) {
      const outgoing = mainOutgoingIds(current, maps);
      if (outgoing.length !== 1) break;

      const next = outgoing[0];
      if (visited.has(next)) break;
      if (!isHorizontalChainNode(next, maps)) break;
      if (mainIncomingIds(next, maps).length !== 1) break;

      run.push(next);
      current = next;
    }

    if (run.length >= MIN_HORIZONTAL_RUN_LENGTH) {
      for (const id of run) visited.add(id);
      runs.push(run);
    }
  }

  return runs;
}

function chooseLayoutMode(_plan: TaskPlanGraphPlan, _maps: GraphMaps): LayoutMode {
  return "horizontal";
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

function applyHorizontalRunsToMetadata(plan: TaskPlanGraphPlan, maps: GraphMaps, metadata: HybridLayoutMetadata) {
  const runs = findLinearRuns(plan, maps);

  for (const run of runs) {
    run.forEach((id) => {
      metadata.roleById.set(id, "chain");
      metadata.horizontalRunByNodeId.set(id, run);
    });

    if (metadata.layoutMode !== "horizontal") continue;

    for (let index = 0; index < run.length - 1; index += 1) {
      const from = run[index];
      const to = run[index + 1];
      const edge = plan.edges.find((item) => {
        const endpoints = edgeEndpoints(item);
        return endpoints.from === from && endpoints.to === to;
      });

      if (edge) metadata.horizontalEdgeIds.add(edge.id);
    }
  }
}

function inferHybridLayoutMetadata(plan: TaskPlanGraphPlan, maps: GraphMaps, layoutMode: LayoutMode): HybridLayoutMetadata {
  const roleById = new Map<string, FlowGraphNode["data"]["layoutRole"]>();
  const primary = new Set(primaryPathIds(plan, maps));
  const metadata: HybridLayoutMetadata = {
    roleById,
    horizontalRunByNodeId: new Map(),
    horizontalEdgeIds: new Set(),
    layoutMode,
  };

  for (const node of plan.nodes) {
    roleById.set(node.id, primary.has(node.id) ? "primary" : "parallel");
  }

  for (const node of plan.nodes) {
    if (!isSidecarNode(node) || primary.has(node.id)) continue;
    roleById.set(node.id, "sidecar");
  }

  for (const node of plan.nodes) {
    const children = (maps.outgoingById.get(node.id) ?? []).filter((id) => !primary.has(id) && roleById.get(id) !== "sidecar");
    if (children.length < 2 && node.kind !== "condition" && node.type !== "condition") continue;

    children.forEach((childId) => {
      roleById.set(childId, "branch");

      let current = childId;
      const seen = new Set<string>();
      while (!seen.has(current)) {
        seen.add(current);
        const nextCandidates = (maps.outgoingById.get(current) ?? []).filter((id) => !primary.has(id));
        if (nextCandidates.length !== 1) break;
        const next = nextCandidates[0];
        if ((maps.incomingById.get(next) ?? []).length > 1 || roleById.get(next) === "sidecar") break;
        roleById.set(next, "branch");
        current = next;
      }
    });
  }

  if (layoutMode === "horizontal" || layoutMode === "hybrid") applyHorizontalRunsToMetadata(plan, maps, metadata);

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

function materializeFlowLayout(input: LayoutInput, layoutNodes: Map<string, LayoutNodePosition>, metadata: HybridLayoutMetadata): FlowLayout {
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
  const graphIsHorizontal = metadata.layoutMode === "horizontal";
  const sourceCountByNodeId = new Map<string, number>();
  const targetCountByNodeId = new Map<string, number>();

  for (const edge of input.plan.edges) {
    const from = edge.from ?? edge.fromNodeId ?? "";
    const to = edge.to ?? edge.toNodeId ?? "";
    if (from) sourceCountByNodeId.set(from, (sourceCountByNodeId.get(from) ?? 0) + 1);
    if (to) targetCountByNodeId.set(to, (targetCountByNodeId.get(to) ?? 0) + 1);
  }

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
      sourcePosition: graphIsHorizontal ? Position.Right : Position.Bottom,
      targetPosition: graphIsHorizontal ? Position.Left : Position.Top,
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
    const isHorizontalEdge = graphIsHorizontal || metadata.horizontalEdgeIds.has(edge.id);
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
      sourceHandle: isHorizontalEdge ? "right-source" : "bottom-source",
      targetHandle: isHorizontalEdge ? "left-target" : "top-target",
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
        orientation: isHorizontalEdge ? "horizontal" : "vertical",
        fanOut: (sourceCountByNodeId.get(from) ?? 0) > 1,
        fanIn: (targetCountByNodeId.get(to) ?? 0) > 1,
        routeOffset: edgeMinLength(nodeById.get(from), nodeById.get(to)) > 1 ? EDGE_OFFSET + 10 : 0,
      },
    };
  });

  return { nodes, edges, contentWidth, contentHeight, viewportHeight, layoutDirection: graphIsHorizontal ? "LR" : "TB" };
}

export function buildFlowLayout(input: LayoutInput): FlowLayout {
  const nodeCount = input.plan.nodes.length;
  const denseGraph = nodeCount >= 8;
  const compactNodeSep = denseGraph ? Math.max(24, LAYOUT_NODE_SEP - 10) : LAYOUT_NODE_SEP;
  const compactRankSep = denseGraph ? Math.max(58, LAYOUT_RANK_SEP - 8) : LAYOUT_RANK_SEP;
  const maps = buildGraphMaps(input.plan);
  const layoutMode = chooseLayoutMode(input.plan, maps);

  const layoutDirection = LAYOUT_DIRECTION;
  const links = input.plan.edges.flatMap<DagLayoutLink>((edge) => {
    const { from, to } = edgeEndpoints(edge);
    return from && to ? [{ edge, source: from, target: to }] : [];
  });
  const singleNodeLinks = input.plan.nodes.map<DagLayoutLink>((node) => ({
    edge: { id: `node-${node.id}`, fromNodeId: node.id, toNodeId: node.id },
    source: node.id,
    target: node.id,
  }));
  const graph = graphConnect()
    .sourceId(({ source }: DagLayoutLink) => source)
    .targetId(({ target }: DagLayoutLink) => target)
    .nodeDatum((id): DagLayoutNode => ({ id }))
    .single(true)([...links, ...singleNodeLinks]);
  const layoutGraph = sugiyama()
    .nodeSize([NODE_WIDTH, NODE_HEIGHT])
    .gap([compactNodeSep, compactRankSep])
    .decross(denseGraph ? decrossDfs() : decrossDfs().topDown(false))
    .coord(coordGreedy())
    .tweaks([tweakDirection(layoutDirection)]);

  layoutGraph(graph);

  const layoutNodes = new Map<string, LayoutNodePosition>();
  for (const node of graph.nodes()) {
    layoutNodes.set(node.data.id, {
      x: node.x - NODE_WIDTH / 2,
      y: node.y - NODE_HEIGHT / 2,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    });
  }

  const metadata = inferHybridLayoutMetadata(input.plan, maps, layoutMode);
  return materializeFlowLayout(input, layoutNodes, metadata);
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
      sourcePosition: node.sourcePosition,
      targetPosition: node.targetPosition,
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
