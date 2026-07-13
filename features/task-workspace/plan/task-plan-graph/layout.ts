import { MarkerType, Position } from "@xyflow/react";
import ELK from "elkjs/lib/elk.bundled.js";
import {
  EDGE_OFFSET,
  LAYOUT_DIRECTION,
  LAYOUT_PADDING,
  MAX_VIEWPORT_HEIGHT,
  MIN_VIEWPORT_HEIGHT,
  NODE_HEIGHT,
  NODE_WIDTH,
  SELECTED_NODE_Z_INDEX,
} from "./constants";
import { buildEdgeStyle, getNodeTone, nodeShapeForKind } from "./logic";
import type {
  FlowGraphEdge,
  FlowGraphNode,
  GraphCopy,
  TaskPlanGraphPlan,
} from "./types";
import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api";

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

type LayoutEdgeRoute = {
  path: string;
  labelPoint: { x: number; y: number };
};

type LayoutLink = {
  id: string;
  source: string;
  target: string;
  weight: number;
};

type LayoutInput = {
  plan: TaskPlanGraphPlan;
  selectedNodeId: string | null;
  graphCopy: GraphCopy;
  onSelect: (nodeId: string) => void;
};

type LayoutMode = "horizontal" | "hybrid";

type GraphMaps = {
  incomingById: Map<string, string[]>;
  outgoingById: Map<string, string[]>;
  nodeById: Map<string, TaskPlanGraphPlan["nodes"][number]>;
};

function isTerminalNodeStatus(status: TaskPlanGraphPlan["nodes"][number]["status"]) {
  return status === "done" ||
    status === "completed" ||
    status === "skipped" ||
    status === "cancelled" ||
    status === "invalidated";
}

function isCompletedNodeStatus(status: TaskPlanGraphPlan["nodes"][number]["status"]) {
  return status === "done" || status === "completed";
}

function isAttentionNodeStatus(status: TaskPlanGraphPlan["nodes"][number]["status"]) {
  return status === "waiting" ||
    status === "waiting_for_user" ||
    status === "waiting_for_approval" ||
    status === "blocked" ||
    status === "failed" ||
    status === "degraded";
}

function resolveNodeFocusState(
  node: TaskPlanGraphPlan["nodes"][number],
  focusSet: Set<string>,
): { isFocus: boolean; visualWeight: FlowGraphNode["data"]["visualWeight"] } {
  const isCurrentOrAttention =
    node.status === "active" ||
    node.status === "in_progress" ||
    isAttentionNodeStatus(node.status);
  const isTerminal = isTerminalNodeStatus(node.status);
  const isCompleted = isCompletedNodeStatus(node.status);
  const isInActivePath = focusSet.has(node.id);
  const isFocus = isCurrentOrAttention || (!isTerminal && (isInActivePath || focusSet.size === 0));
  const visualWeight = isCurrentOrAttention ? "primary" : isTerminal && !isCompleted ? "muted" : isInActivePath ? "primary" : "normal";

  return { isFocus, visualWeight };
}

type HybridLayoutMetadata = {
  roleById: Map<string, FlowGraphNode["data"]["layoutRole"]>;
  horizontalRunByNodeId: Map<string, string[]>;
  horizontalEdgeIds: Set<string>;
  layoutMode: LayoutMode;
};

type OrderedNodeEntry = {
  id: string;
  index: number;
};

const MIN_HORIZONTAL_RUN_LENGTH = 4;
const ELK_NODE_NODE_SPACING = 96;
const ELK_LAYER_SPACING = 96;
const ELK_EDGE_NODE_SPACING = 48;
const ELK_EDGE_EDGE_SPACING = 20;
const EDGE_SIDE_ROUTE_GAP = 24;
const elk = new ELK();

function edgeEndpoints(edge: TaskPlanGraphPlan["edges"][number]) {
  return {
    from: edge.from ?? edge.fromNodeId ?? "",
    to: edge.to ?? edge.toNodeId ?? "",
  };
}

function buildGraphMaps(plan: TaskPlanGraphPlan): GraphMaps {
  const nodeById = new Map(plan.nodes.map((node) => [node.id, node]));
  const incomingById = new Map(
    plan.nodes.map((node) => [node.id, [] as string[]]),
  );
  const outgoingById = new Map(
    plan.nodes.map((node) => [node.id, [] as string[]]),
  );

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

    let shouldContinue = true;
    while (shouldContinue) {
      const outgoing = mainOutgoingIds(current, maps);
      if (outgoing.length !== 1) break;

      const next = outgoing[0];
      if (visited.has(next)) break;
      if (!isHorizontalChainNode(next, maps)) break;
      if (mainIncomingIds(next, maps).length !== 1) break;

      run.push(next);
      current = next;
      shouldContinue = Boolean(current);
    }

    if (run.length >= MIN_HORIZONTAL_RUN_LENGTH) {
      for (const id of run) visited.add(id);
      runs.push(run);
    }
  }

  return runs;
}

function chooseLayoutMode(
  plan: TaskPlanGraphPlan,
  maps: GraphMaps,
): LayoutMode {
  const hasBranching = plan.nodes.some(
    (node) =>
      mainOutgoingIds(node.id, maps).length > 1 ||
      mainIncomingIds(node.id, maps).length > 1,
  );
  const hasSidecars = plan.nodes.some(isSidecarNode);
  const hasLongRun = findLinearRuns(plan, maps).length > 0;

  return hasBranching || hasSidecars || hasLongRun ? "hybrid" : "horizontal";
}

function rankForNode(id: string, plan: TaskPlanGraphPlan) {
  const rank = plan.analytics.rankByNodeId[id];
  return typeof rank === "number" ? rank : Number.POSITIVE_INFINITY;
}

function laneForNode(id: string, plan: TaskPlanGraphPlan) {
  const lane = plan.analytics.laneByNodeId[id];
  return typeof lane === "number" ? lane : 0;
}

function layoutRoleOrder(role: FlowGraphNode["data"]["layoutRole"]) {
  if (role === "primary" || role === "chain") return 0;
  if (role === "branch") return 1;
  if (role === "parallel") return 2;
  if (role === "sidecar") return 3;
  return 4;
}

function compareNodeLayoutOrder(
  left: OrderedNodeEntry,
  right: OrderedNodeEntry,
  plan: TaskPlanGraphPlan,
  maps: GraphMaps,
  metadata: HybridLayoutMetadata,
) {
  const leftRank = rankForNode(left.id, plan);
  const rightRank = rankForNode(right.id, plan);
  if (leftRank !== rightRank) return leftRank - rightRank;

  const laneDelta = laneForNode(left.id, plan) - laneForNode(right.id, plan);
  if (laneDelta !== 0) return laneDelta;

  const roleDelta =
    layoutRoleOrder(metadata.roleById.get(left.id)) -
    layoutRoleOrder(metadata.roleById.get(right.id));
  if (roleDelta !== 0) return roleDelta;

  const leftOutgoing = mainOutgoingIds(left.id, maps).length;
  const rightOutgoing = mainOutgoingIds(right.id, maps).length;
  if (leftOutgoing !== rightOutgoing) return rightOutgoing - leftOutgoing;

  return left.index - right.index;
}

function orderedNodeIds(
  plan: TaskPlanGraphPlan,
  maps: GraphMaps,
  metadata: HybridLayoutMetadata,
) {
  return plan.nodes
    .map((node, index) => ({ id: node.id, index }))
    .sort((left, right) =>
      compareNodeLayoutOrder(left, right, plan, maps, metadata),
    )
    .map(({ id }) => id);
}

function primaryPathIds(plan: TaskPlanGraphPlan, maps: GraphMaps) {
  const explicitPath = plan.analytics.criticalPathNodeIds.filter((id) =>
    maps.nodeById.has(id),
  );
  if (explicitPath.length > 1) return explicitPath;

  const path: string[] = [];
  const entryNodeId = plan.analytics.entryNodeIds.find((id) =>
    maps.nodeById.has(id),
  );
  const firstNodeId = plan.nodes.at(0)?.id;
  let current: string | null =
    plan.currentStepId && maps.nodeById.has(plan.currentStepId)
      ? plan.currentStepId
      : (entryNodeId ?? firstNodeId ?? null);
  const seen = new Set<string>();

  while (current && !seen.has(current)) {
    seen.add(current);
    path.push(current);
    const next: string | undefined = (
      maps.outgoingById.get(current) ?? []
    ).find((id) => {
      const candidate = maps.nodeById.get(id);
      return candidate ? !isSidecarNode(candidate) : false;
    });
    current = next ?? null;
  }

  return path.length > 0 ? path : plan.nodes.map((node) => node.id);
}

function applyHorizontalRunsToMetadata(
  plan: TaskPlanGraphPlan,
  maps: GraphMaps,
  metadata: HybridLayoutMetadata,
) {
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

function inferHybridLayoutMetadata(
  plan: TaskPlanGraphPlan,
  maps: GraphMaps,
  layoutMode: LayoutMode,
): HybridLayoutMetadata {
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
    const children = (maps.outgoingById.get(node.id) ?? []).filter(
      (id) => !primary.has(id) && roleById.get(id) !== "sidecar",
    );
    if (
      children.length < 2 &&
      node.kind !== "condition" &&
      node.type !== "condition"
    )
      continue;

    children.forEach((childId) => {
      roleById.set(childId, "branch");

      let current = childId;
      const seen = new Set<string>();
      while (!seen.has(current)) {
        seen.add(current);
        const nextCandidates = (maps.outgoingById.get(current) ?? []).filter(
          (id) => !primary.has(id),
        );
        if (nextCandidates.length !== 1) break;
        const next = nextCandidates[0];
        if (
          (maps.incomingById.get(next) ?? []).length > 1 ||
          roleById.get(next) === "sidecar"
        )
          break;
        roleById.set(next, "branch");
        current = next;
      }
    });
  }

  applyHorizontalRunsToMetadata(plan, maps, metadata);

  return metadata;
}

function resolveRuntimeEdgeState(
  sourceNode: TaskPlanGraphPlan["nodes"][number] | undefined,
  targetNode: TaskPlanGraphPlan["nodes"][number] | undefined,
) {
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

function edgeMinLength(
  sourceNode: TaskPlanGraphPlan["nodes"][number] | undefined,
  targetNode: TaskPlanGraphPlan["nodes"][number] | undefined,
) {
  if (!sourceNode || !targetNode) return 1;
  if (sourceNode.kind === "condition" || sourceNode.type === "condition")
    return 2;
  if (targetNode.status === "blocked" || targetNode.requiresHumanInput)
    return 2;
  return 1;
}

function edgeRoute(
  sourceNode: LayoutNodePosition | undefined,
  targetNode: LayoutNodePosition | undefined,
  graphIsHorizontal: boolean,
  preferSideRoute = false,
) {
  if (!sourceNode || !targetNode) {
    return graphIsHorizontal
      ? {
          sourceHandle: "right-source",
          targetHandle: "left-target",
          orientation: "horizontal" as const,
        }
      : {
          sourceHandle: "bottom-center-source",
          targetHandle: "top-center-target",
          orientation: "vertical" as const,
        };
  }

  const sourceCenterX = sourceNode.x + sourceNode.width / 2;
  const sourceCenterY = sourceNode.y + sourceNode.height / 2;
  const targetCenterX = targetNode.x + targetNode.width / 2;
  const targetCenterY = targetNode.y + targetNode.height / 2;
  const horizontalDelta = targetCenterX - sourceCenterX;
  const verticalDelta = targetCenterY - sourceCenterY;
  const isSameLayer = Math.abs(verticalDelta) < sourceNode.height * 0.6;
  const useHorizontal =
    graphIsHorizontal ||
    (preferSideRoute && isSameLayer) ||
    (isSameLayer && Math.abs(horizontalDelta) >= EDGE_SIDE_ROUTE_GAP);

  if (useHorizontal) {
    return horizontalDelta >= 0
      ? {
          sourceHandle: "right-source",
          targetHandle: "left-target",
          orientation: "horizontal" as const,
        }
      : {
          sourceHandle: "left-source",
          targetHandle: "right-target",
          orientation: "horizontal" as const,
        };
  }

  return verticalDelta >= 0
    ? {
        sourceHandle: "bottom-center-source",
        targetHandle: "top-center-target",
        orientation: "vertical" as const,
      }
    : {
        sourceHandle: "top-center-source",
        targetHandle: "bottom-center-target",
        orientation: "vertical" as const,
      };
}

function pointPath(points: { x: number; y: number }[]) {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`)
    .join("");
}

function edgeLabelPoint(points: { x: number; y: number }[]) {
  const middle = points[Math.floor(points.length / 2)];
  if (middle) return middle;
  return { x: 0, y: 0 };
}

function materializeElkEdgeRoutes(
  edges: ElkExtendedEdge[] | undefined,
  minLeft: number,
  minTop: number,
) {
  const routes = new Map<string, LayoutEdgeRoute>();

  for (const edge of edges ?? []) {
    const section = edge.sections?.[0];
    if (!section?.startPoint || !section.endPoint) continue;

    const points = [
      section.startPoint,
      ...(section.bendPoints ?? []),
      section.endPoint,
    ]
      .map((point) => ({
        x: point.x - minLeft + LAYOUT_PADDING,
        y: point.y - minTop + LAYOUT_PADDING,
      }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));

    const deduped = points.filter((point, index) => {
      const previous = points[index - 1];
      return !previous || previous.x !== point.x || previous.y !== point.y;
    });

    if (deduped.length < 2) continue;
    routes.set(edge.id, {
      path: pointPath(deduped),
      labelPoint: edgeLabelPoint(deduped),
    });
  }

  return routes;
}

function materializeFlowLayout(
  input: LayoutInput,
  layoutNodes: Map<string, LayoutNodePosition>,
  layoutEdges: ElkExtendedEdge[] | undefined,
  metadata: HybridLayoutMetadata,
): FlowLayout {
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
  const rawContentHeight = Math.max(
    Math.ceil(maxBottom - minTop + LAYOUT_PADDING * 2),
    NODE_HEIGHT + LAYOUT_PADDING * 2,
  );
  const viewportHeight = Math.max(
    Math.min(rawContentHeight, MAX_VIEWPORT_HEIGHT),
    MIN_VIEWPORT_HEIGHT,
  );
  const contentHeight = Math.max(rawContentHeight, viewportHeight);
  const elkEdgeRoutes = materializeElkEdgeRoutes(layoutEdges, minLeft, minTop);

  const focusSet = new Set(input.plan.analytics.reachableFromActiveIds);
  const nodeById = new Map(input.plan.nodes.map((node) => [node.id, node]));
  const sourceCountByNodeId = new Map<string, number>();
  const targetCountByNodeId = new Map<string, number>();

  for (const edge of input.plan.edges) {
    const from = edge.from ?? edge.fromNodeId ?? "";
    const to = edge.to ?? edge.toNodeId ?? "";
    if (from)
      sourceCountByNodeId.set(from, (sourceCountByNodeId.get(from) ?? 0) + 1);
    if (to) targetCountByNodeId.set(to, (targetCountByNodeId.get(to) ?? 0) + 1);
  }

  const nodes: FlowGraphNode[] = input.plan.nodes.map((node, index) => {
    const layoutNode = layoutNodes.get(node.id) ?? {
      x: 0,
      y: 0,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    };
    const isSelected = node.id === input.selectedNodeId;
    const focusState = resolveNodeFocusState(node, focusSet);
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
        opacity: focusState.visualWeight === "muted" ? 0.58 : 1,
      },
      data: {
        node,
        stepNumber: index + 1,
        layoutRole: metadata.roleById.get(node.id),
        tone: getNodeTone(node),
        shape: nodeShapeForKind(
          node.kind === "step" || node.kind === "user_input"
            ? "task"
            : (node.kind ?? node.type ?? "task"),
        ),
        isSelected,
        isCurrent: node.id === input.plan.currentStepId,
        isFocus: focusState.isFocus,
        visualWeight: focusState.visualWeight,
        graphCopy: input.graphCopy,
        onSelect: input.onSelect,
      },
    };
  });

  const edges: FlowGraphEdge[] = input.plan.edges.map((edge) => {
    const { from, to } = edgeEndpoints(edge);
    const isInactiveEdge =
      edge.active === false || edge.emphasis === "inactive";
    const baseStyle = buildEdgeStyle(
      edge.kind ?? "sequential",
      edge.emphasis ?? "normal",
    );
    const runtimeEdgeState = isInactiveEdge
      ? null
      : resolveRuntimeEdgeState(nodeById.get(from), nodeById.get(to));
    const route = edgeRoute(
      layoutNodes.get(from),
      layoutNodes.get(to),
      false,
      isConditionNode(nodeById.get(from)) &&
        (sourceCountByNodeId.get(from) ?? 0) > 1,
    );
    const runtimeStyle =
      runtimeEdgeState === "active"
        ? {
            stroke: "rgba(14, 165, 233, 0.9)",
            strokeWidth: 2.35,
            strokeDasharray: undefined,
          }
        : runtimeEdgeState === "approval"
          ? {
              stroke: "rgba(217, 70, 239, 0.84)",
              strokeWidth: 2.2,
              strokeDasharray: "7 5",
            }
          : runtimeEdgeState === "input"
            ? {
                stroke: "rgba(245, 158, 11, 0.84)",
                strokeWidth: 2.2,
                strokeDasharray: "7 5",
              }
            : runtimeEdgeState === "blocked"
              ? {
                  stroke: "rgba(244, 63, 94, 0.88)",
                  strokeWidth: 2.3,
                  strokeDasharray: undefined,
                }
              : null;

    return {
      id: edge.id,
      source: from,
      target: to,
      type: "taskPlanEdge",
      sourceHandle: route.sourceHandle,
      targetHandle: route.targetHandle,
      selectable: false,
      reconnectable: false,
      animated:
        !isInactiveEdge &&
        (runtimeEdgeState === "active" ||
          runtimeEdgeState === "approval" ||
          runtimeEdgeState === "input"),
      zIndex: isInactiveEdge ? 3 : 6,
      pathOptions: { borderRadius: 0, offset: EDGE_OFFSET },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: (runtimeStyle ?? baseStyle).stroke,
      },
      style: {
        ...(runtimeStyle ?? baseStyle),
        opacity: isInactiveEdge
          ? 0.58
          : runtimeStyle || (edge.emphasis ?? "normal") !== "normal"
            ? 1
            : focusSet.size > 0 && !focusSet.has(from) && !focusSet.has(to)
              ? 0.35
              : 1,
      },
      data: {
        stableLabel: edge.label ?? undefined,
        orientation: route.orientation,
        elkPath: elkEdgeRoutes.get(edge.id)?.path,
        elkLabelPoint: elkEdgeRoutes.get(edge.id)?.labelPoint,
        fanOut: (sourceCountByNodeId.get(from) ?? 0) > 1,
        fanIn: (targetCountByNodeId.get(to) ?? 0) > 1,
        routeOffset:
          edgeMinLength(nodeById.get(from), nodeById.get(to)) > 1
            ? EDGE_OFFSET + 10
            : 0,
      },
    };
  });

  return {
    nodes,
    edges,
    contentWidth,
    contentHeight,
    viewportHeight,
    layoutDirection: "TB",
  };
}

function elkDirection() {
  const direction: string = LAYOUT_DIRECTION;
  return direction === "LR" ? "RIGHT" : "DOWN";
}

function buildElkGraph(
  orderedIds: string[],
  links: LayoutLink[],
) : ElkNode {
  const children: ElkNode[] = orderedIds.map((id) => ({
    id,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
  }));
  const edges: ElkExtendedEdge[] = links.map((link) => ({
    id: link.id,
    sources: [link.source],
    targets: [link.target],
    layoutOptions: {
      "elk.priority": String(link.weight),
    },
  }));

  return {
    id: "task-plan-layout-root",
    children,
    edges,
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": elkDirection(),
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": String(ELK_NODE_NODE_SPACING),
      "elk.layered.spacing.nodeNodeBetweenLayers": String(ELK_LAYER_SPACING),
      "elk.layered.spacing.edgeNodeBetweenLayers": String(ELK_EDGE_NODE_SPACING),
      "elk.layered.spacing.edgeEdgeBetweenLayers": String(ELK_EDGE_EDGE_SPACING),
      "elk.layered.cycleBreaking.strategy": "GREEDY",
      "elk.layered.layering.strategy": "NETWORK_SIMPLEX",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    },
  };
}

export async function buildFlowLayout(input: LayoutInput): Promise<FlowLayout> {
  const maps = buildGraphMaps(input.plan);
  const layoutMode = chooseLayoutMode(input.plan, maps);
  const metadata = inferHybridLayoutMetadata(input.plan, maps, layoutMode);
  const orderedIds = orderedNodeIds(input.plan, maps, metadata);
  const orderById = new Map(orderedIds.map((id, index) => [id, index]));

  const links = input.plan.edges
    .flatMap<LayoutLink>((edge) => {
      const { from, to } = edgeEndpoints(edge);
      return from && to
        ? [
            {
              id: edge.id,
              source: from,
              target: to,
              weight:
                edge.emphasis === "inactive" || edge.active === false ? 1 : 2,
            },
          ]
        : [];
    })
    .sort((left, right) => {
      const sourceDelta =
        (orderById.get(left.source) ?? 0) - (orderById.get(right.source) ?? 0);
      if (sourceDelta !== 0) return sourceDelta;
      return (
        (orderById.get(left.target) ?? 0) - (orderById.get(right.target) ?? 0)
      );
    });
  const constrainedLinks = [...links];
  const existingLinkIds = new Set(
    links.map((link) => `${link.source}->${link.target}`),
  );
  const primaryPath = primaryPathIds(input.plan, maps);
  for (let index = 0; index < primaryPath.length - 1; index += 1) {
    const source = primaryPath[index];
    const target = primaryPath[index + 1];
    const linkId = `${source}->${target}`;
    if (existingLinkIds.has(linkId)) continue;
    constrainedLinks.push({
      id: `layout-primary-${source}-${target}`,
      source,
      target,
      weight: 3,
    });
    existingLinkIds.add(linkId);
  }

  const elkLayout = await elk.layout(buildElkGraph(orderedIds, constrainedLinks));
  const layoutNodes = new Map<string, LayoutNodePosition>();
  for (const node of elkLayout.children ?? []) {
    layoutNodes.set(node.id, {
      x: node.x ?? 0,
      y: node.y ?? 0,
      width: node.width ?? NODE_WIDTH,
      height: node.height ?? NODE_HEIGHT,
    });
  }

  return materializeFlowLayout(input, layoutNodes, elkLayout.edges, metadata);
}

export function syncNodeState(
  nodes: FlowGraphNode[],
  input: {
    selectedNodeId: string | null;
    graphCopy: GraphCopy;
    onSelect: (nodeId: string) => void;
    focusNodeIds: string[];
  },
) {
  const focusSet = new Set(input.focusNodeIds);
  let changed = false;
  const nextNodes = nodes.map((node) => {
    const isSelected = node.id === input.selectedNodeId;
    const focusState = resolveNodeFocusState(node.data.node, focusSet);
    const isFocus = focusState.isFocus;
    const zIndex = isSelected ? SELECTED_NODE_Z_INDEX : 1;
    const opacity = focusState.visualWeight === "muted" ? 0.58 : 1;
    if (
      node.draggable === false &&
      node.selectable === false &&
      node.zIndex === zIndex &&
      node.style?.zIndex === zIndex &&
      node.style?.opacity === opacity &&
      node.data.isSelected === isSelected &&
      node.data.isFocus === isFocus &&
      node.data.visualWeight === focusState.visualWeight &&
      node.data.graphCopy === input.graphCopy &&
      node.data.onSelect === input.onSelect
    ) {
      return node;
    }
    changed = true;
    return {
      ...node,
      draggable: false,
      selectable: false,
      zIndex,
      style: {
        ...node.style,
        zIndex,
        opacity,
      },
      sourcePosition: node.sourcePosition,
      targetPosition: node.targetPosition,
      data: {
        ...node.data,
        isSelected,
        isCurrent: node.data.isCurrent,
        isFocus,
        visualWeight: focusState.visualWeight,
        graphCopy: input.graphCopy,
        onSelect: input.onSelect,
      },
    };
  });
  return changed ? nextNodes : nodes;
}
