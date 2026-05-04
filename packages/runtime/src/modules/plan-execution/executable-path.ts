import type { TaskPlanGraph } from "@chrona/contracts/ai";

export type PlanExecutablePath = {
  readyNodeIds: string[];
  waitingForChildNodeIds: string[];
  waitingForDependencyNodeIds: string[];
  waitingForUserNodeIds: string[];
  waitingForApprovalNodeIds: string[];
  blockedNodeIds: string[];
  doneNodeIds: string[];
  skippedNodeIds: string[];
  inProgressNodeIds: string[];
  pendingNodeIds: string[];
  currentNodeId: string | null;
  terminalReason:
    | "has_ready_nodes"
    | "waiting_for_child"
    | "waiting_for_dependencies"
    | "waiting_for_user"
    | "waiting_for_approval"
    | "blocked"
    | "all_done"
    | "empty_plan";
  nodeReasons: Record<string, string>;
};

type TopoState = {
  completedIds: Set<string>;
  blockedIds: Set<string>;
  incomingEdges: Map<string, string[]>;
};

function buildTopoState(graph: TaskPlanGraph): TopoState {
  const completedIds = new Set(
    graph.nodes
      .filter((n) => n.status === "done" || n.status === "skipped")
      .map((n) => n.id),
  );
  const incomingEdges = new Map<string, string[]>();

  for (const edge of graph.edges) {
    const list = incomingEdges.get(edge.toNodeId);
    if (list) {
      list.push(edge.fromNodeId);
    } else {
      incomingEdges.set(edge.toNodeId, [edge.fromNodeId]);
    }
  }

  for (const node of graph.nodes) {
    if (!incomingEdges.has(node.id)) {
      incomingEdges.set(node.id, []);
    }
  }

  return { completedIds, blockedIds: new Set<string>(), incomingEdges };
}

function predecessorsSatisfied(
  nodeId: string,
  topo: TopoState,
): boolean {
  const deps = topo.incomingEdges.get(nodeId) ?? [];
  return deps.every((depId) => topo.completedIds.has(depId));
}

export function computeExecutablePath(plan: TaskPlanGraph): PlanExecutablePath {
  const topo = buildTopoState(plan);

  if (plan.nodes.length === 0) {
    return {
      readyNodeIds: [],
      waitingForChildNodeIds: [],
      waitingForDependencyNodeIds: [],
      waitingForUserNodeIds: [],
      waitingForApprovalNodeIds: [],
      blockedNodeIds: [],
      doneNodeIds: [],
      skippedNodeIds: [],
      inProgressNodeIds: [],
      pendingNodeIds: [],
      currentNodeId: null,
      terminalReason: "empty_plan",
      nodeReasons: {},
    };
  }

  const doneNodeIds: string[] = [];
  const skippedNodeIds: string[] = [];
  const inProgressNodeIds: string[] = [];
  const waitingForChildNodeIds: string[] = [];
  const pendingNodeIds: string[] = [];
  const readyNodeIds: string[] = [];
  const waitingForUserNodeIds: string[] = [];
  const waitingForApprovalNodeIds: string[] = [];
  const waitingForDependencyNodeIds: string[] = [];
  const blockedNodeIds: string[] = [];
  const nodeReasons: Record<string, string> = {};

  for (const node of plan.nodes) {
    switch (node.status) {
      case "done":
        doneNodeIds.push(node.id);
        break;
      case "skipped":
        skippedNodeIds.push(node.id);
        break;
      case "in_progress":
        inProgressNodeIds.push(node.id);
        break;
      case "waiting_for_child":
        waitingForChildNodeIds.push(node.id);
        break;
      case "waiting_for_user":
        waitingForUserNodeIds.push(node.id);
        break;
      case "waiting_for_approval":
        waitingForApprovalNodeIds.push(node.id);
        break;
      case "blocked":
        blockedNodeIds.push(node.id);
        break;
      default:
        pendingNodeIds.push(node.id);
        break;
    }
  }

  const currentNodeId =
    inProgressNodeIds.length > 0 ? inProgressNodeIds[0] : null;

  const sortedPending = [...pendingNodeIds].sort((a, b) => a.localeCompare(b));

  for (const nodeId of sortedPending) {
    const node = plan.nodes.find((n) => n.id === nodeId);
    if (!node) continue;

    const depsOkay = predecessorsSatisfied(nodeId, topo);

    if (!depsOkay) {
      const deps = topo.incomingEdges.get(nodeId) ?? [];
      const unmet = deps.filter((depId) => !topo.completedIds.has(depId));

      nodeReasons[nodeId] = `Waiting for dependencies: ${unmet.join(", ")}`;
      waitingForDependencyNodeIds.push(nodeId);
      topo.blockedIds.add(nodeId);
      continue;
    }

    if (node.requiresHumanInput) {
      nodeReasons[nodeId] = `Requires human input: ${node.objective}`;
      waitingForUserNodeIds.push(nodeId);
      continue;
    }

    if (node.requiresHumanApproval) {
      nodeReasons[nodeId] = `Requires human approval`;
      waitingForApprovalNodeIds.push(nodeId);
      continue;
    }

    if (!node.autoRunnable) {
      nodeReasons[nodeId] = `Node is not auto-runnable`;
      blockedNodeIds.push(nodeId);
      topo.blockedIds.add(nodeId);
      continue;
    }

    if (node.executionMode === "manual") {
      nodeReasons[nodeId] = `Node execution mode is manual`;
      blockedNodeIds.push(nodeId);
      topo.blockedIds.add(nodeId);
      continue;
    }

    readyNodeIds.push(nodeId);
  }

  const terminalReason = ((): PlanExecutablePath["terminalReason"] => {
    const nonDone = plan.nodes.filter(
      (n) => n.status !== "done" && n.status !== "skipped",
    );

    if (nonDone.length === 0) return "all_done";
    if (readyNodeIds.length > 0) return "has_ready_nodes";
    if (inProgressNodeIds.length > 0 || waitingForChildNodeIds.length > 0) {
      return "waiting_for_child";
    }
    if (waitingForUserNodeIds.length > 0) return "waiting_for_user";
    if (waitingForApprovalNodeIds.length > 0) return "waiting_for_approval";
    if (blockedNodeIds.length > 0) return "blocked";
    if (waitingForDependencyNodeIds.length > 0) return "waiting_for_dependencies";
    return "blocked";
  })();

  return {
    readyNodeIds,
    waitingForChildNodeIds,
    waitingForDependencyNodeIds,
    waitingForUserNodeIds,
    waitingForApprovalNodeIds,
    blockedNodeIds,
    doneNodeIds,
    skippedNodeIds,
    inProgressNodeIds,
    pendingNodeIds,
    currentNodeId,
    terminalReason,
    nodeReasons,
  };
}
