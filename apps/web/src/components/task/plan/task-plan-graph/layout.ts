import dagre from "@dagrejs/dagre";
import { MarkerType, Position } from "@xyflow/react";
import {
  EDGE_OFFSET,
  EXPANDED_LINKED_NODE_EXTRA_HEIGHT,
  EXPANDED_NODE_EXTRA_HEIGHT,
  LAYOUT_DIRECTION,
  LAYOUT_NODE_SEP,
  LAYOUT_PADDING,
  LAYOUT_RANK_SEP,
  MIN_VIEWPORT_HEIGHT,
  NODE_HEIGHT,
  NODE_WIDTH,
  SELECTED_NODE_Z_INDEX,
} from "./constants";
import {
  buildEdgeStyle,
  getNodeTone,
} from "./logic";
import type {
  FlowGraphEdge,
  FlowGraphNode,
  GraphCopy,
  PlanEdge,
  PlanStep,
} from "./types";

function calculateNodeHeight(step: PlanStep, isSelected: boolean) {
  if (!isSelected) return NODE_HEIGHT;
  return (
    NODE_HEIGHT +
    EXPANDED_NODE_EXTRA_HEIGHT +
    (step.linkedTaskId ? EXPANDED_LINKED_NODE_EXTRA_HEIGHT : 0)
  );
}

export function buildFlowLayout(input: {
  steps: PlanStep[];
  edges: PlanEdge[];
  currentStepId: string | null;
  selectedStepId: string | null;
  graphCopy: GraphCopy;
  onToggle: (nodeId: string) => void;
  maxViewportHeight: number;
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

  for (const step of input.steps) {
    graph.setNode(step.id, {
      width: NODE_WIDTH,
      height: calculateNodeHeight(step, input.selectedStepId === step.id),
    });
  }

  for (const edge of input.edges) {
    graph.setEdge(edge.fromNodeId, edge.toNodeId);
  }

  dagre.layout(graph);

  let minLeft = Number.POSITIVE_INFINITY;
  let minTop = Number.POSITIVE_INFINITY;
  let maxRight = Number.NEGATIVE_INFINITY;
  let maxBottom = Number.NEGATIVE_INFINITY;

  for (const step of input.steps) {
    const layoutNode = graph.node(step.id);
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

  if (
    !Number.isFinite(minLeft) ||
    !Number.isFinite(minTop) ||
    !Number.isFinite(maxRight) ||
    !Number.isFinite(maxBottom)
  ) {
    minLeft = 0;
    minTop = 0;
    maxRight = NODE_WIDTH;
    maxBottom = NODE_HEIGHT;
  }

  const contentWidth = Math.max(
    Math.ceil(maxRight - minLeft + LAYOUT_PADDING * 2),
    NODE_WIDTH + LAYOUT_PADDING * 2,
  );
  const contentHeight = Math.max(
    Math.ceil(maxBottom - minTop + LAYOUT_PADDING * 2 + (input.selectedStepId ? 32 : 0)),
    NODE_HEIGHT + LAYOUT_PADDING * 2,
  );
  const viewportHeight = Math.min(
    Math.max(contentHeight, MIN_VIEWPORT_HEIGHT),
    input.maxViewportHeight,
  );

  const nodes: FlowGraphNode[] = input.steps.map((step) => {
    const layoutNode = graph.node(step.id) ?? {
      x: 0,
      y: 0,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    };
    const isSelected = step.id === input.selectedStepId;
    return {
      id: step.id,
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
      },
      data: {
        step,
        tone: getNodeTone(step),
        isCurrent: step.id === input.currentStepId,
        isSelected,
        graphCopy: input.graphCopy,
        onToggle: input.onToggle,
      },
    };
  });

  const edges: FlowGraphEdge[] = input.edges.map((edge) => ({
    id: edge.id,
    source: edge.fromNodeId,
    target: edge.toNodeId,
    type: "smoothstep",
    selectable: false,
    reconnectable: false,
    animated: false,
    pathOptions: {
      borderRadius: 0,
      offset: EDGE_OFFSET,
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: buildEdgeStyle(edge.type).stroke,
    },
    style: buildEdgeStyle(edge.type),
    label: edge.label ?? undefined,
  }));

  return { nodes, edges, contentWidth, contentHeight, viewportHeight };
}

export function syncNodeState(
  nodes: FlowGraphNode[],
  input: {
    currentStepId: string | null;
    selectedStepId: string | null;
    graphCopy: GraphCopy;
    onToggle: (nodeId: string) => void;
  },
) {
  return nodes.map((node) => {
    const isSelected = node.id === input.selectedStepId;
    return {
      ...node,
      draggable: false,
      selectable: false,
      zIndex: isSelected ? SELECTED_NODE_Z_INDEX : 1,
      style: {
        ...node.style,
        zIndex: isSelected ? SELECTED_NODE_Z_INDEX : 1,
      },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      data: {
        ...node.data,
        isCurrent: node.id === input.currentStepId,
        isSelected,
        graphCopy: input.graphCopy,
        onToggle: input.onToggle,
      },
    };
  });
}
