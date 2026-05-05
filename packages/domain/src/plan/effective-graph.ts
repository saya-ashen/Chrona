import type {
  CompiledPlan,
  CompiledNode,
  PlanOverlayLayer,
  StructuralLayer,
  RuntimeLayer,
  ResultLayer,
  StructuralOperation,
  EffectivePlanGraph,
  EffectivePlanNode,
  EffectivePlanEdge,
  NodeResult,
  NodeRuntimeState,
  PlanRun,
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
): EffectivePlanGraph {
  // ── Step 1: copy base nodes + edges ──
  const nodeMap = new Map<string, EffectivePlanNode>();
  const edgeMap = new Map<string, EffectivePlanEdge>();

  for (const n of basePlan.nodes) {
    nodeMap.set(n.id, cloneBaseNode(n));
  }
  for (const e of basePlan.edges) {
    const key = edgeKey(e.from, e.to);
    edgeMap.set(key, { id: e.id, from: e.from, to: e.to, label: e.label });
  }

  // ── Step 2: apply active structural layers ──
  const activeStructural = layers
    .filter((l): l is StructuralLayer => l.type === "structural" && l.active)
    .sort((a, b) => a.version - b.version);

  for (const layer of activeStructural) {
    applyStructuralLayer(nodeMap, edgeMap, layer.operations);
  }

  // ── Step 3: recompute dependencies/dependents from edges ──
  rebuildDependencies(nodeMap, edgeMap);

  // ── Step 4: apply active runtime layers (latest active wins per node) ──
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

  // ── Step 5: apply active result layers (latest active wins per node) ──
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
    }
  }

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
    const hasIncomingEdges = [...edgeMap.values()].some((e) => e.to === id);
    const hasOutgoingEdges = [...edgeMap.values()].some((e) => e.from === id);

    if (!hasIncomingEdges) entryNodeIds.push(id);
    if (!hasOutgoingEdges) terminalNodeIds.push(id);

    // Compute dependenciesSatisfied + ready
    const allDepsSatisfied = node.dependencies.every((depId: string) => {
      const dep = nodeMap.get(depId);
      return dep?.status === "completed" || dep?.status === "skipped";
    });

    node.dependenciesSatisfied = allDepsSatisfied;

    // Ready: status is already "ready", OR (pending + all deps satisfied)
    if (node.status === "ready") {
      node.ready = true;
      readyNodeIds.push(id);
    } else if (node.status === "pending" && allDepsSatisfied) {
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
    planId: basePlan.editablePlanId,
    basePlanId: basePlan.id,
    resolvedVersion,
    nodes: [...nodeMap.values()],
    edges: [...edgeMap.values()],
    entryNodeIds,
    terminalNodeIds,
    readyNodeIds,
    blockedNodeIds,
    completedNodeIds,
    runningNodeIds,
    failedNodeIds,
    pendingNodeIds,
  };
}

// ─── Helpers ───

function cloneBaseNode(n: CompiledNode): EffectivePlanNode {
  return {
    id: n.id,
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
  };
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
        nodeMap.set(op.nodeId, {
          id: op.nodeId,
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
          metadata: {},
          description: (op as { description?: string }).description,
          priority: (op as { priority?: string }).priority as import("@chrona/contracts/ai").TaskPriority | undefined,
          linkedTaskId: (op as { linkedTaskId?: string }).linkedTaskId,
        });
        break;
      }
      case "update_node": {
        const node = nodeMap.get(op.nodeId);
        if (!node) break;
        if (op.patch.title !== undefined) node.title = op.patch.title;
        if (op.patch.type !== undefined) node.type = op.patch.type;
        if (op.patch.config !== undefined) Object.assign(node.config, op.patch.config);
        if (op.patch.executor !== undefined) node.executor = op.patch.executor;
        if (op.patch.mode !== undefined) node.mode = op.patch.mode;
        if (op.patch.estimatedMinutes !== undefined) node.estimatedMinutes = op.patch.estimatedMinutes;
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
): void {
  // Clear existing
  for (const node of nodeMap.values()) {
    node.dependencies = [];
    node.dependents = [];
  }

  for (const edge of edgeMap.values()) {
    const fromNode = nodeMap.get(edge.from);
    const toNode = nodeMap.get(edge.to);
    if (!fromNode || !toNode) continue;

    if (!fromNode.dependents.includes(edge.to)) {
      fromNode.dependents.push(edge.to);
    }
    if (!toNode.dependencies.includes(edge.from)) {
      toNode.dependencies.push(edge.from);
    }
  }
}

// ─── Layer Constructors ───

function layerId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function nodeStateToRuntimeLayer(
  planId: string,
  nodeId: string,
  state: NodeRuntimeState,
  version: number,
): RuntimeLayer {
  return {
    type: "runtime",
    layerId: layerId("rl"),
    version,
    active: true,
    planId,
    timestamp: new Date().toISOString(),
    nodeStates: {
      [nodeId]: {
        status: state.status,
        attempts: state.attempts,
        lastError: state.lastError,
        startedAt: state.startedAt,
        completedAt: state.completedAt,
      },
    },
  };
}

export function nodeResultToResultLayer(
  planId: string,
  nodeId: string,
  result: NodeResult,
  version: number,
): ResultLayer {
  return {
    type: "result",
    layerId: layerId("resl"),
    version,
    active: true,
    planId,
    timestamp: new Date().toISOString(),
    nodeResults: {
      [nodeId]: result,
    },
  };
}

/**
 * Converts a PlanRun's current state into a sequence of versioned layers.
 * Produces one RuntimeLayer covering all node states, followed by
 * ResultLayers for nodes with checkpoint responses or artifacts.
 *
 * This is a bridge function — it snapshots existing PlanRun state
 * (which predates the append-only layer model) into layered form.
 */
export function planRunToLayers(
  run: PlanRun,
  compiled: CompiledPlan,
): PlanOverlayLayer[] {
  const layers: PlanOverlayLayer[] = [];
  let version = 1;

  if (Object.keys(run.nodeStates).length > 0) {
    layers.push({
      type: "runtime",
      layerId: `rl_bridge_${run.id}`,
      version: version++,
      active: true,
      planId: compiled.editablePlanId,
      timestamp: run.createdAt,
      nodeStates: Object.fromEntries(
        Object.entries(run.nodeStates).map(([id, s]) => [
          id,
          {
            status: s.status,
            attempts: s.attempts,
            lastError: s.lastError,
            startedAt: s.startedAt,
            completedAt: s.completedAt,
          },
        ]),
      ),
    });
  }

  const nodeResults = new Map<string, NodeResult>();

  for (const cr of run.checkpointResponses) {
    const existing = nodeResults.get(cr.nodeId) ?? {};
    existing.checkpointResponse = cr.response;
    nodeResults.set(cr.nodeId, existing);
  }

  for (const ar of run.artifactRefs) {
    const existing = nodeResults.get(ar.nodeId) ?? {};
    if (!existing.artifactRefs) existing.artifactRefs = [];
    existing.artifactRefs.push(ar);
    nodeResults.set(ar.nodeId, existing);
  }

  for (const [nodeId, result] of nodeResults) {
    layers.push({
      type: "result",
      layerId: `resl_bridge_${run.id}_${nodeId}`,
      version: version++,
      active: true,
      planId: compiled.editablePlanId,
      timestamp: run.completedAt ?? run.createdAt,
      nodeResults: {
        [nodeId]: result,
      },
    });
  }

  return layers;
}
