import dagre from "@dagrejs/dagre";
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

export function buildFlowLayout(input: {
  plan: TaskPlanGraphPlan;
  selectedNodeId: string | null;
  graphCopy: GraphCopy;
  onSelect: (nodeId: string) => void;
}) {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: LAYOUT_DIRECTION,
    align: "UL",
    nodesep: LAYOUT_NODE_SEP,
    ranksep: LAYOUT_RANK_SEP,
    marginx: LAYOUT_PADDING,
    marginy: LAYOUT_PADDING,
  });

  for (const node of input.plan.nodes) {
    graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  for (const edge of input.plan.edges) {
    const from = edge.from ?? edge.fromNodeId;
    const to = edge.to ?? edge.toNodeId;
    if (!from || !to) continue;
    graph.setEdge(from, to);
  }

  dagre.layout(graph);

  let minLeft = Number.POSITIVE_INFINITY;
  let minTop = Number.POSITIVE_INFINITY;
  let maxRight = Number.NEGATIVE_INFINITY;
  let maxBottom = Number.NEGATIVE_INFINITY;

  for (const node of input.plan.nodes) {
    const layoutNode = graph.node(node.id);
    if (!layoutNode) continue;
    const left = layoutNode.x - layoutNode.width / 2;
    const top = layoutNode.y - layoutNode.height / 2;
    const right = layoutNode.x + layoutNode.width / 2;
    const bottom = layoutNode.y + layoutNode.height / 2;
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
  const contentHeight = Math.max(Math.ceil(maxBottom - minTop + LAYOUT_PADDING * 2), NODE_HEIGHT + LAYOUT_PADDING * 2);
  const viewportHeight = Math.max(Math.min(contentHeight, MAX_VIEWPORT_HEIGHT), MIN_VIEWPORT_HEIGHT);

  const focusSet = new Set(input.plan.analytics.reachableFromActiveIds);
  const nodeById = new Map(input.plan.nodes.map((node) => [node.id, node]));

  const nodes: FlowGraphNode[] = input.plan.nodes.map((node) => {
    const layoutNode = graph.node(node.id) ?? { x: 0, y: 0, width: NODE_WIDTH, height: NODE_HEIGHT };
    const isSelected = node.id === input.selectedNodeId;
    return {
      id: node.id,
      type: "taskPlanNode",
      position: {
        x: layoutNode.x - layoutNode.width / 2 - minLeft + LAYOUT_PADDING,
        y: layoutNode.y - layoutNode.height / 2 - minTop + LAYOUT_PADDING,
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
        tone: getNodeTone(node),
        shape: nodeShapeForKind(node.kind === "step" || node.kind === "user_input" ? "task" : (node.kind ?? node.type ?? "task")),
        isSelected,
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
      ? { stroke: "rgba(14, 165, 233, 0.96)", strokeWidth: 3.1, strokeDasharray: undefined }
      : runtimeEdgeState === "approval"
        ? { stroke: "rgba(217, 70, 239, 0.92)", strokeWidth: 3, strokeDasharray: "8 4" }
        : runtimeEdgeState === "input"
          ? { stroke: "rgba(245, 158, 11, 0.92)", strokeWidth: 3, strokeDasharray: "8 4" }
          : runtimeEdgeState === "blocked"
            ? { stroke: "rgba(244, 63, 94, 0.94)", strokeWidth: 3, strokeDasharray: undefined }
            : null;

    return {
      id: edge.id,
      source: from,
      target: to,
      type: "smoothstep",
      selectable: false,
      reconnectable: false,
      animated: runtimeEdgeState === "active" || runtimeEdgeState === "approval" || runtimeEdgeState === "input",
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
      label: edge.label ?? undefined,
    };
  });

  return { nodes, edges, contentWidth, contentHeight, viewportHeight };
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
        isFocus,
        graphCopy: input.graphCopy,
        onSelect: input.onSelect,
      },
    };
  });
}
