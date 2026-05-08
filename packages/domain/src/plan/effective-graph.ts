import type {
  CompiledPlan,
  CompiledNode,
  PlanGraph,
  PlanNode,
  PlanEdge,
  NodeLayer,
  PlanOverlayLayer,
  StructuralLayer,
  RuntimeLayer,
  ResultLayer,
  StructuralOperation,
  EffectivePlanGraph,
  EffectivePlanNode,
  EffectivePlanEdge,
  NodeResult,
  NodeAttempt,
  ResolveEffectivePlanGraphInput,
  WaitKind,
} from "@chrona/contracts/ai";

// ─── Resolve ───

/**
 * Resolves a CompiledPlan (immutable base) + ordered PlanOverlayLayers
 * into an EffectivePlanGraph.
 *
 * Resolution algorithm:
 * 1. Start with base nodes/edges (identity from CompiledNode.id)
 * 2. Apply active StructuralLayers in version order:
 *    - add_node: pushes a new EffectivePlanNode (without dependencies yet)
 *    - update_node: patches title, type, config, executor, mode, estimatedMinutes
 *    - delete_node: removes node + connected edges
 *    - add_edge: pushes a new edge
 *    - delete_edge: removes matching edge
 * 3. Recompute dependencies/dependents from current edges (Kahn-compatible)
 * 4. Apply active RuntimeLayers in version order (latest active wins per node)
 * 5. Apply active ResultLayers in version order (latest active wins per node)
 * 6. Compute ready/blocked/completed subsets
 *
 * Only active layers participate. Inactive layers are preserved in storage
 * but ignored during resolution.
 *
 * Pure function — no I/O, no mutation of inputs.
 */
export function resolveEffectivePlanGraph(
  basePlan: CompiledPlan,
  layers: PlanOverlayLayer[],
): EffectivePlanGraph;
export function resolveEffectivePlanGraph(
  input: ResolveEffectivePlanGraphInput,
): EffectivePlanGraph;
export function resolveEffectivePlanGraph(
  basePlanOrInput: CompiledPlan | ResolveEffectivePlanGraphInput,
  layers: PlanOverlayLayer[] = [],
): EffectivePlanGraph {
  if (isResolveInput(basePlanOrInput)) {
    return resolveMutableEffectivePlanGraph(basePlanOrInput);
  }

  return resolveLegacyEffectivePlanGraph(basePlanOrInput, layers);
}

function resolveLegacyEffectivePlanGraph(
  basePlan: CompiledPlan,
  layers: PlanOverlayLayer[],
): EffectivePlanGraph {
  // ── Step 1: copy base nodes + edges ──
  const nodeMap = new Map<string, EffectivePlanNode>();
  const edgeMap = new Map<string, EffectivePlanEdge>();

  for (const n of basePlan.nodes) {
    nodeMap.set(n.id, cloneBaseNode(n));
  }
  for (const e of basePlan.edges) {
    const key = edgeKey(e.from, e.to);
    edgeMap.set(key, { id: e.id, from: e.from, to: e.to, label: e.label, active: true });
  }

  // ── Step 2: apply active structural layers ──
  const activeStructural = layers
    .filter((l): l is StructuralLayer => l.type === "structural" && l.active)
    .sort((a, b) => a.version - b.version);

  for (const layer of activeStructural) {
    applyStructuralLayer(nodeMap, edgeMap, layer.operations);
  }

  // ── Step 3: apply active runtime layers (latest active wins per node) ──
  const activeRuntime = layers
    .filter((l): l is RuntimeLayer => l.type === "runtime" && l.active)
    .sort((a, b) => a.version - b.version);

  for (const layer of activeRuntime) {
    for (const [nodeId, state] of Object.entries(layer.nodeStates)) {
      const node = nodeMap.get(nodeId);
      if (!node) continue;
      node.status = state.status;
      if (state.linkedTaskId !== undefined) node.linkedTaskId = state.linkedTaskId;
      if (state.attempts !== undefined) node.attempts = state.attempts;
      if (state.lastError !== undefined) node.lastError = state.lastError;
      if (state.startedAt !== undefined) node.startedAt = state.startedAt;
      if (state.completedAt !== undefined) node.completedAt = state.completedAt;
    }
  }

  // ── Step 4: apply active result layers (latest active wins per node) ──
  const activeResult = layers
    .filter((l): l is ResultLayer => l.type === "result" && l.active)
    .sort((a, b) => a.version - b.version);

  for (const layer of activeResult) {
    for (const [nodeId, result] of Object.entries(layer.nodeResults)) {
      const node = nodeMap.get(nodeId);
      if (!node) continue;
      if (!node.result) node.result = {} as NodeResult;
      if (result.outputSummary !== undefined) node.result.outputSummary = result.outputSummary;
      if (result.artifactRefs !== undefined) node.result.artifactRefs = result.artifactRefs;
      if (result.checkpointResponse !== undefined) node.result.checkpointResponse = result.checkpointResponse;
      if (result.error !== undefined) node.result.error = result.error;
      if (result.selectedBranch !== undefined) node.result.selectedBranch = result.selectedBranch;
    }
  }

  // ── Step 5: prune inactive branches, then recompute reachability/dependencies ──
  applyConditionBranchSelections(nodeMap, edgeMap);
  const reachableNodeIds = computeReachableNodeIds(basePlan.entryNodeIds, edgeMap);
  rebuildDependencies(nodeMap, edgeMap, reachableNodeIds);
  markPrunedNodesSkipped(nodeMap, reachableNodeIds);

  // ── Step 6: compute ready/blocked/completed ──
  const entryNodeIds: string[] = [];
  const terminalNodeIds: string[] = [];
  const readyNodeIds: string[] = [];
  const blockedNodeIds: string[] = [];
  const completedNodeIds: string[] = [];
  const runningNodeIds: string[] = [];
  const failedNodeIds: string[] = [];
  const pendingNodeIds: string[] = [];

  for (const [id, node] of nodeMap) {
    const hasIncomingEdges = [...edgeMap.values()].some((e) => e.active && e.to === id);
    const hasOutgoingEdges = [...edgeMap.values()].some((e) => e.active && e.from === id);

    node.reachable = reachableNodeIds.has(id);

    if (node.reachable && !hasIncomingEdges) entryNodeIds.push(id);
    if (node.reachable && !hasOutgoingEdges) terminalNodeIds.push(id);

    // Compute dependenciesSatisfied + ready
    const allDepsSatisfied = node.dependencies.every((depId: string) => {
      const dep = nodeMap.get(depId);
      return dep?.status === "completed" || dep?.status === "skipped";
    });

    node.dependenciesSatisfied = allDepsSatisfied;

    // Ready: status is already "ready", OR (pending + all deps satisfied)
    if (node.reachable && node.status === "ready") {
      node.ready = true;
      readyNodeIds.push(id);
    } else if (node.reachable && node.status === "pending" && allDepsSatisfied) {
      node.ready = true;
      readyNodeIds.push(id);
    } else {
      node.ready = false;
    }

    switch (node.status) {
      case "completed":
      case "skipped":
        completedNodeIds.push(id);
        break;
      case "running":
        runningNodeIds.push(id);
        break;
      case "failed":
        failedNodeIds.push(id);
        break;
      case "blocked":
        blockedNodeIds.push(id);
        break;
      default:
        if (!node.ready && node.status !== "ready") {
          pendingNodeIds.push(id);
        }
        break;
    }
  }

  const resolvedVersion =
    layers.length > 0
      ? Math.max(...layers.filter((l) => l.active).map((l) => l.version))
      : basePlan.sourceVersion;

  return {
    graphId: basePlan.editablePlanId,
    planId: basePlan.editablePlanId,
    basePlanId: basePlan.id,
    resolvedAt: new Date().toISOString(),
    resolvedVersion,
    nodes: [...nodeMap.values()],
    edges: [...edgeMap.values()],
    entryNodeIds,
    terminalNodeIds,
    readyNodeIds,
    blockedNodeIds,
    completedNodeIds,
    runningNodeIds,
    invalidatedNodeIds: [],
    failedNodeIds,
    pendingNodeIds,
  };
}

function resolveMutableEffectivePlanGraph(
  input: ResolveEffectivePlanGraphInput,
): EffectivePlanGraph {
  const { graph, attempts = [], results = [] } = input;
  const edgeMap = new Map<string, EffectivePlanEdge>();
  const nodeMap = new Map<string, EffectivePlanNode>();

  for (const edge of graph.edges) {
    edgeMap.set(edge.id, {
      id: edge.id,
      from: edge.fromNodeId,
      to: edge.toNodeId,
      label: edge.label,
      active: edge.active,
    });
  }

  for (const node of graph.nodes) {
    const effectiveNode = buildEffectiveNodeFromGraphNode(node, attempts, results);
    if (effectiveNode) {
      nodeMap.set(node.id, effectiveNode);
    }
  }

  const entryNodeIds = computeGraphEntryNodeIds(nodeMap, edgeMap);
  const reachableNodeIds = computeReachableNodeIds(entryNodeIds, edgeMap);
  rebuildDependencies(nodeMap, edgeMap, reachableNodeIds);

  const terminalNodeIds: string[] = [];
  const readyNodeIds: string[] = [];
  const blockedNodeIds: string[] = [];
  const completedNodeIds: string[] = [];
  const runningNodeIds: string[] = [];
  const invalidatedNodeIds: string[] = [];
  const failedNodeIds: string[] = [];
  const pendingNodeIds: string[] = [];

  for (const [nodeId, node] of nodeMap) {
    const hasOutgoingEdges = [...edgeMap.values()].some(
      (edge) => edge.active && edge.from === nodeId,
    );
    node.reachable = reachableNodeIds.has(nodeId);

    if (node.reachable && !hasOutgoingEdges) {
      terminalNodeIds.push(nodeId);
    }

    const allDepsSatisfied = node.dependencies.every((depId) => {
      const dep = nodeMap.get(depId);
      return (
        dep?.status === "completed" ||
        dep?.status === "skipped" ||
        dep?.status === "invalidated"
      );
    });

    node.dependenciesSatisfied = allDepsSatisfied;
    node.ready =
      node.reachable &&
      allDepsSatisfied &&
      (node.status === "pending" || node.status === "ready");

    if (node.ready) {
      readyNodeIds.push(nodeId);
    }

    switch (node.status) {
      case "completed":
      case "skipped":
        completedNodeIds.push(nodeId);
        break;
      case "running":
        runningNodeIds.push(nodeId);
        break;
      case "invalidated":
        invalidatedNodeIds.push(nodeId);
        break;
      case "waiting":
      case "waiting_for_user":
      case "waiting_for_approval":
      case "blocked":
        blockedNodeIds.push(nodeId);
        break;
      case "failed":
        failedNodeIds.push(nodeId);
        break;
      default:
        if (!node.ready) {
          pendingNodeIds.push(nodeId);
        }
        break;
    }

    if (node.ready) {
      node.status = "ready";
    }
  }

  return {
    graphId: graph.id,
    planId: graph.id,
    basePlanId: graph.id,
    resolvedAt: new Date().toISOString(),
    resolvedVersion: graph.mutations.length,
    nodes: [...nodeMap.values()],
    edges: [...edgeMap.values()],
    entryNodeIds,
    terminalNodeIds,
    readyNodeIds,
    blockedNodeIds,
    completedNodeIds,
    runningNodeIds,
    invalidatedNodeIds,
    failedNodeIds,
    pendingNodeIds,
  };
}

// ─── Helpers ───

function cloneBaseNode(n: CompiledNode): EffectivePlanNode {
  return {
    id: n.id,
    nodeId: n.id,
    activeLayerId: null,
    semanticKey: n.localId,
    definition: {
      title: n.title,
      objective: n.description ?? n.title,
      description: n.description,
      semantics: {
        type: n.type,
        priority: n.priority,
        mode: n.mode,
        linkedTaskId: n.linkedTaskId,
      },
      executor: n.executor,
      estimatedMinutes: n.estimatedMinutes,
    },
    invalidated: false,
    localId: n.localId,
    type: n.type,
    title: n.title,
    description: n.description,
    priority: n.priority,
    linkedTaskId: n.linkedTaskId,
    config: structuredClone(n.config),
    executor: n.executor,
    mode: n.mode,
    estimatedMinutes: n.estimatedMinutes,
    metadata: (n as unknown as Record<string, unknown>).metadata as Record<string, unknown> ?? {},
    dependencies: [],     // recomputed after structural layers
    dependents: [],       // recomputed after structural layers
    status: "pending",
    attempts: 0,
    dependenciesSatisfied: false,
    ready: false,
    reachable: true,
    reviewRequired: false,
  };
}

function isResolveInput(
  value: CompiledPlan | ResolveEffectivePlanGraphInput,
): value is ResolveEffectivePlanGraphInput {
  return "graph" in value;
}

function buildEffectiveNodeFromGraphNode(
  node: PlanNode,
  attempts: NodeAttempt[],
  results: NodeResult[],
): EffectivePlanNode | null {
  const activeDefinitionLayer = getActiveDefinitionLayer(node.layers);
  if (!activeDefinitionLayer) {
    return null;
  }

  const latestInvalidation = getLatestLayer(node.layers, "invalidation");
  const latestCancellation = getLatestLayer(node.layers, "cancellation");
  const nodeResults = results.filter((result) => result.nodeId === node.id);
  const currentResult =
    nodeResults.find(
      (result) =>
        result.nodeLayerId === activeDefinitionLayer.id &&
        result.status === "current",
    ) ??
    [...nodeResults]
      .filter((result) => result.nodeLayerId === activeDefinitionLayer.id)
      .at(-1);
  const activeAttempt = [...attempts]
    .filter(
      (attempt) =>
        attempt.nodeId === node.id && attempt.nodeLayerId === activeDefinitionLayer.id,
    )
    .sort((a, b) => b.attemptNumber - a.attemptNumber)[0];
  const semantics = activeDefinitionLayer.definition.semantics;
  const status = deriveNodeStatus({
    invalidated: Boolean(latestInvalidation),
    cancelled: Boolean(latestCancellation),
    activeAttempt,
    result: currentResult,
  });

  return {
    id: node.id,
    nodeId: node.id,
    activeLayerId: activeDefinitionLayer.id,
    semanticKey: node.semanticKey,
    definition: activeDefinitionLayer.definition,
    invalidated: Boolean(latestInvalidation),
    invalidationReason: latestInvalidation?.reason,
    waitKind: currentResult?.waitKind,
    reviewRequired: activeDefinitionLayer.definition.reviewRequired ?? false,
    localId: node.semanticKey,
    type: semantics.type,
    title: activeDefinitionLayer.definition.title,
    description: activeDefinitionLayer.definition.description,
    priority: semantics.priority,
    linkedTaskId: semantics.linkedTaskId,
    config: (activeDefinitionLayer.definition.metadata ?? {}) as EffectivePlanNode["config"],
    executor: activeDefinitionLayer.definition.executor,
    mode: semantics.mode,
    estimatedMinutes: activeDefinitionLayer.definition.estimatedMinutes,
    dependencies: [],
    dependents: [],
    status,
    attempts: activeAttempt?.attemptNumber ?? 0,
    lastError: currentResult?.error ?? activeAttempt?.error?.message,
    startedAt: activeAttempt?.startedAt,
    completedAt: activeAttempt?.finishedAt,
    result: currentResult,
    blockedReason: currentResult?.error ?? latestInvalidation?.reason,
    metadata: {
      ...(semantics.metadata ?? {}),
      ...(activeDefinitionLayer.definition.metadata ?? {}),
    },
    dependenciesSatisfied: false,
    ready: false,
    reachable: true,
  };
}

function getActiveDefinitionLayer(layers: NodeLayer[]) {
  return [...layers]
    .reverse()
    .find((layer): layer is Extract<NodeLayer, { type: "definition" }> => layer.type === "definition");
}

function getLatestLayer<TType extends NodeLayer["type"]>(
  layers: NodeLayer[],
  type: TType,
): Extract<NodeLayer, { type: TType }> | undefined {
  return [...layers]
    .reverse()
    .find((layer): layer is Extract<NodeLayer, { type: TType }> => layer.type === type);
}

function deriveNodeStatus(input: {
  invalidated: boolean;
  cancelled: boolean;
  activeAttempt?: NodeAttempt;
  result?: NodeResult;
}): EffectivePlanNode["status"] {
  if (input.invalidated || input.result?.status === "invalidated") {
    return "invalidated";
  }
  if (input.cancelled) {
    return "cancelled";
  }
  if (input.activeAttempt?.status === "running") {
    return "running";
  }
  if (input.result?.waitKind) {
    return mapWaitKindToNodeStatus(input.result.waitKind);
  }
  if (input.result?.status === "rejected" || input.activeAttempt?.status === "failed") {
    return "failed";
  }
  if (
    input.result?.outputSummary !== undefined ||
    input.result?.checkpointResponse !== undefined ||
    input.result?.artifactRefs?.length ||
    input.result?.selectedBranch !== undefined ||
    input.result?.status === "current" ||
    input.activeAttempt?.status === "succeeded"
  ) {
    return "completed";
  }
  return "pending";
}

function mapWaitKindToNodeStatus(waitKind: WaitKind): EffectivePlanNode["status"] {
  switch (waitKind) {
    case "user_input":
      return "waiting_for_user";
    case "approval":
    case "review":
      return "waiting_for_approval";
    default:
      return "waiting";
  }
}

function computeGraphEntryNodeIds(
  nodeMap: Map<string, EffectivePlanNode>,
  edgeMap: Map<string, EffectivePlanEdge>,
): string[] {
  const entryNodeIds: string[] = [];
  for (const nodeId of nodeMap.keys()) {
    const hasIncomingEdges = [...edgeMap.values()].some(
      (edge) => edge.active && edge.to === nodeId,
    );
    if (!hasIncomingEdges) {
      entryNodeIds.push(nodeId);
    }
  }
  return entryNodeIds;
}

function edgeKey(from: string, to: string): string {
  return `${from}→${to}`;
}

function applyStructuralLayer(
  nodeMap: Map<string, EffectivePlanNode>,
  edgeMap: Map<string, EffectivePlanEdge>,
  operations: StructuralOperation[],
): void {
  for (const op of operations) {
    switch (op.op) {
      case "add_node": {
        const description = (op as { description?: string }).description;
        const priority = (op as { priority?: string }).priority as import("@chrona/contracts/ai").TaskPriority | undefined;
        const linkedTaskId = (op as { linkedTaskId?: string }).linkedTaskId;
        nodeMap.set(op.nodeId, {
          id: op.nodeId,
          nodeId: op.nodeId,
          activeLayerId: null,
          semanticKey: op.localId,
          definition: {
            title: op.title,
            objective: description ?? op.title,
            description,
            semantics: {
              type: op.type,
              priority,
              mode: op.mode,
              linkedTaskId,
            },
            executor: op.executor,
            estimatedMinutes: op.estimatedMinutes,
          },
          invalidated: false,
          localId: op.localId,
          type: op.type,
          title: op.title,
          config: structuredClone(op.config),
          executor: op.executor,
          mode: op.mode,
          estimatedMinutes: op.estimatedMinutes,
          dependencies: [],
          dependents: [],
          status: "pending",
          attempts: 0,
          dependenciesSatisfied: false,
          ready: false,
          reachable: true,
          reviewRequired: false,
          metadata: {},
          description,
          priority,
          linkedTaskId,
        });
        break;
      }
      case "update_node": {
        const node = nodeMap.get(op.nodeId);
        if (!node) break;
        if (op.patch.title !== undefined) {
          node.title = op.patch.title;
          node.definition.title = op.patch.title;
        }
        if (op.patch.type !== undefined) {
          node.type = op.patch.type;
          node.definition.semantics.type = op.patch.type;
        }
        if (op.patch.config !== undefined) Object.assign(node.config, op.patch.config);
        if (op.patch.executor !== undefined) {
          node.executor = op.patch.executor;
          node.definition.executor = op.patch.executor;
        }
        if (op.patch.mode !== undefined) {
          node.mode = op.patch.mode;
          node.definition.semantics.mode = op.patch.mode;
        }
        if (op.patch.estimatedMinutes !== undefined) {
          node.estimatedMinutes = op.patch.estimatedMinutes;
          node.definition.estimatedMinutes = op.patch.estimatedMinutes;
        }
        break;
      }
      case "delete_node": {
        nodeMap.delete(op.nodeId);
        // Remove all edges involving this node
        for (const [key, edge] of edgeMap) {
          if (edge.from === op.nodeId || edge.to === op.nodeId) {
            edgeMap.delete(key);
          }
        }
        break;
      }
      case "add_edge": {
        const key = edgeKey(op.from, op.to);
        if (!edgeMap.has(key)) {
          edgeMap.set(key, {
            id: `edge_${op.from}_${op.to}`,
            from: op.from,
            to: op.to,
            label: op.label,
            active: true,
          });
        }
        break;
      }
      case "delete_edge": {
        const key = edgeKey(op.from, op.to);
        edgeMap.delete(key);
        break;
      }
    }
  }
}

function rebuildDependencies(
  nodeMap: Map<string, EffectivePlanNode>,
  edgeMap: Map<string, EffectivePlanEdge>,
  reachableNodeIds: Set<string>,
): void {
  // Clear existing
  for (const node of nodeMap.values()) {
    node.dependencies = [];
    node.dependents = [];
  }

  for (const edge of edgeMap.values()) {
    if (!edge.active) continue;
    const fromNode = nodeMap.get(edge.from);
    const toNode = nodeMap.get(edge.to);
    if (!fromNode || !toNode) continue;
    if (!reachableNodeIds.has(edge.from) || !reachableNodeIds.has(edge.to)) continue;

    if (!fromNode.dependents.includes(edge.to)) {
      fromNode.dependents.push(edge.to);
    }
    if (!toNode.dependencies.includes(edge.from)) {
      toNode.dependencies.push(edge.from);
    }
  }
}

function applyConditionBranchSelections(
  nodeMap: Map<string, EffectivePlanNode>,
  edgeMap: Map<string, EffectivePlanEdge>,
) {
  for (const node of nodeMap.values()) {
    if (node.type !== "condition") continue;
    const selectedNextNodeId = node.result?.selectedBranch?.nextNodeId;
    if (!selectedNextNodeId) continue;

    for (const edge of edgeMap.values()) {
      if (edge.from !== node.id) continue;
      edge.active = edge.to === selectedNextNodeId;
    }
  }
}

function computeReachableNodeIds(
  entryNodeIds: string[],
  edgeMap: Map<string, EffectivePlanEdge>,
) {
  const adjacency = new Map<string, string[]>();
  for (const edge of edgeMap.values()) {
    if (!edge.active) continue;
    const next = adjacency.get(edge.from) ?? [];
    next.push(edge.to);
    adjacency.set(edge.from, next);
  }

  const reachable = new Set<string>();
  const queue = [...entryNodeIds];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || reachable.has(current)) continue;
    reachable.add(current);
    for (const next of adjacency.get(current) ?? []) {
      if (!reachable.has(next)) queue.push(next);
    }
  }

  return reachable;
}

function markPrunedNodesSkipped(
  nodeMap: Map<string, EffectivePlanNode>,
  reachableNodeIds: Set<string>,
) {
  for (const [nodeId, node] of nodeMap) {
    if (reachableNodeIds.has(nodeId)) continue;
    if (node.status === "pending" || node.status === "ready") {
      node.status = "skipped";
      node.ready = false;
    }
  }
}
