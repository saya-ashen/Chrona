import type {
  PlanRun,
  CompiledPlan,
  CompiledNode,
  RuntimeCommand,
  TaskPlanGraph,
  TaskPlanNode,
  TaskPlanNodeStatus,
} from "@chrona/contracts/ai";
import {
  createPlanRun,
  applyRuntimeCommand,
  compileEditablePlan,
} from "@chrona/domain";
import { upgradeBlueprintToEditable } from "@chrona/contracts/ai";

/**
 * Build a mapping from localId (original node ID) → compiled node ID.
 */
function buildLocalToCompiledMap(compiled: CompiledPlan): Map<string, string> {
  const map = new Map<string, string>();
  for (const node of compiled.nodes) {
    map.set(node.localId, node.id);
  }
  return map;
}

/**
 * Build a mapping from compiled node ID → CompiledNode.
 */
function buildCompiledNodeMap(compiled: CompiledPlan): Map<string, CompiledNode> {
  const map = new Map<string, CompiledNode>();
  for (const node of compiled.nodes) {
    map.set(node.id, node);
  }
  return map;
}

/**
 * Create a PlanRun from an accepted TaskPlanGraph.
 * Upgrades blueprint → EditablePlan → CompiledPlan → PlanRun.
 * Syncs current node states from TaskPlanGraph nodes to PlanRun states.
 * Returns { run, compiled } or null if the plan has no blueprint or compilation fails.
 */
export function createPlanRunFromGraph(graph: TaskPlanGraph): {
  run: PlanRun;
  compiled: CompiledPlan;
} | null {
  if (!graph.blueprint) return null;

  try {
    const editable = upgradeBlueprintToEditable(graph.blueprint, graph.id);
    const compiled = compileEditablePlan(editable);
    const run = createPlanRun(compiled);

    // Build compiledId → localId reverse lookup
    const compiledToLocal = new Map<string, string>();
    for (const node of compiled.nodes) {
      compiledToLocal.set(node.id, node.localId);
    }

    // Sync current node states from TaskPlanGraph
    for (const graphNode of graph.nodes) {
      // Find the compiled node with matching localId
      const compiledNode = compiled.nodes.find((cn) => cn.localId === graphNode.id);
      if (!compiledNode) continue;

      const runState = run.nodeStates[compiledNode.id];
      if (!runState) continue;

      const mapped = mapGraphStatusToRunStatus(graphNode.status);
      if (mapped) {
        runState.status = mapped;
      }
    }

    return { run, compiled };
  } catch {
    return null;
  }
}

/**
 * Apply a RuntimeCommand to a PlanRun and sync the resulting state
 * back to the TaskPlanGraph nodes.
 */
export function applyCommandAndSyncGraph(
  run: PlanRun,
  compiled: CompiledPlan,
  command: RuntimeCommand,
  graph: TaskPlanGraph,
): { ok: boolean; run?: PlanRun; graph?: TaskPlanGraph; error?: string } {
  const result = applyRuntimeCommand(run, compiled, command);

  if (!result.ok || !result.run) {
    return result;
  }

  // Build compiledId → localId map
  const compiledToLocal = new Map<string, string>();
  for (const node of compiled.nodes) {
    compiledToLocal.set(node.id, node.localId);
  }

  // Sync run status → graph node statuses
  const updatedNodes = graph.nodes.map((node): TaskPlanNode => {
    // Find compiled ID for this graph node
    const compiledNode = compiled.nodes.find((cn) => cn.localId === node.id);
    if (!compiledNode) return node;

    const runState = result.run!.nodeStates[compiledNode.id];
    if (!runState) return node;

    const mapped = mapRunStatusToGraphStatus(runState.status);
    if (mapped === node.status) return node;

    return {
      ...node,
      status: mapped,
      ...(runState.completedAt ? { completionSummary: node.completionSummary ?? `Completed at ${runState.completedAt}` } : {}),
    };
  });

  return {
    ok: true,
    run: result.run,
    graph: { ...graph, nodes: updatedNodes },
  };
}

/**
 * Sync PlanRun node states → TaskPlanGraph node statuses.
 * Mutates graph in place. Returns the mutated graph.
 */
function syncRunStateToGraph(
  run: PlanRun,
  compiled: CompiledPlan,
  graph: TaskPlanGraph,
): TaskPlanGraph {
  const updatedNodes = graph.nodes.map((node): TaskPlanNode => {
    const compiledNode = compiled.nodes.find((cn) => cn.localId === node.id);
    if (!compiledNode) return node;

    const runState = run.nodeStates[compiledNode.id];
    if (!runState) return node;

    const mapped = mapRunStatusToGraphStatus(runState.status);
    if (mapped === node.status) return node;

    return { ...node, status: mapped };
  });

  return { ...graph, nodes: updatedNodes };
}

/**
 * Sync TaskPlanGraph node statuses → PlanRun node states.
 * Mutates run in place. Returns the mutated run.
 */
export function syncGraphStateToRun(
  graph: TaskPlanGraph,
  compiled: CompiledPlan,
  run: PlanRun,
): PlanRun {
  for (const graphNode of graph.nodes) {
    const compiledNode = compiled.nodes.find((cn) => cn.localId === graphNode.id);
    if (!compiledNode) continue;

    const runState = run.nodeStates[compiledNode.id];
    if (!runState) continue;

    const mapped = mapGraphStatusToRunStatus(graphNode.status);
    if (mapped && mapped !== runState.status) {
      runState.status = mapped;
    }
  }

  return run;
}

function mapGraphStatusToRunStatus(status: TaskPlanNodeStatus): PlanRun["nodeStates"][string]["status"] | null {
  switch (status) {
    case "pending":
      return "pending";
    case "in_progress":
      return "running";
    case "done":
      return "completed";
    case "blocked":
      return "failed";
    case "skipped":
      return "skipped";
    case "waiting_for_user":
    case "waiting_for_approval":
      return "ready";
    case "waiting_for_child":
      return "running";
    default:
      return null;
  }
}

function mapRunStatusToGraphStatus(status: PlanRun["nodeStates"][string]["status"]): TaskPlanNodeStatus {
  switch (status) {
    case "ready":
    case "pending":
      return "pending";
    case "running":
      return "in_progress";
    case "completed":
      return "done";
    case "failed":
      return "blocked";
    case "skipped":
      return "skipped";
    case "cancelled":
      return "skipped";
    case "blocked":
      return "blocked";
  }
}
