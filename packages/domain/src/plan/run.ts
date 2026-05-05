import type {
  CompiledPlan,
  PlanRun,
  NodeRuntimeState,
  RuntimeCommand,
  PlanOverlayLayer,
} from "@chrona/contracts/ai";
import { nodeStateToRuntimeLayer, nodeResultToResultLayer } from "./effective-graph";

/**
 * Creates a new PlanRun from a CompiledPlan.
 * - Status: "pending"
 * - Entry nodes (no dependencies): "ready"
 * - Other nodes: "pending"
 * - All attempts = 0
 */
export function createPlanRun(compiledPlan: CompiledPlan): PlanRun {
  const now = new Date().toISOString();

  const nodeStates: Record<string, NodeRuntimeState> = {};

  for (const node of compiledPlan.nodes) {
    const isEntry = compiledPlan.entryNodeIds.includes(node.id);

    nodeStates[node.id] = {
      nodeId: node.id,
      status: isEntry ? "ready" : "pending",
      attempts: 0,
    };
  }

  return {
    id: `run_${compiledPlan.id}_${Date.now()}`,
    compiledPlanId: compiledPlan.id,
    editablePlanId: compiledPlan.editablePlanId,
    sourceVersion: compiledPlan.sourceVersion,
    status: "pending",
    nodeStates,
    checkpointResponses: [],
    artifactRefs: [],
    attempts: [],
    createdAt: now,
  };
}

export type RuntimeCommandResult = {
  ok: boolean;
  run?: PlanRun;
  layers?: PlanOverlayLayer[];
  error?: string;
};

/**
 * Apply a RuntimeCommand to a PlanRun, returning the updated PlanRun.
 * Commands only modify PlanRun state, never the CompiledPlan or EditablePlan.
 *
 * When `layerVersion` is provided, also produces PlanOverlayLayers
 * reflecting the node state changes caused by the command.
 *
 * Returns RuntimeCommandResult.
 */
export function applyRuntimeCommand(
  run: PlanRun,
  compiledPlan: CompiledPlan,
  command: RuntimeCommand,
  layerVersion?: number,
): RuntimeCommandResult {
  const now = new Date().toISOString();
  const newRun = structuredClone(run);

  const layers: PlanOverlayLayer[] = [];

  function recordRuntimeLayer(nodeId: string) {
    if (layerVersion === undefined) return;
    const nodeState = newRun.nodeStates[nodeId];
    if (nodeState) {
      layers.push(
        nodeStateToRuntimeLayer(compiledPlan.editablePlanId, nodeId, nodeState, layerVersion),
      );
    }
  }

  switch (command.type) {
    case "start_plan": {
      if (run.status !== "pending" && run.status !== "paused") {
        return { ok: false, error: `Cannot start plan in status '${run.status}'` };
      }
      newRun.status = "running";
      newRun.startedAt = newRun.startedAt ?? now;
      return { ok: true, run: newRun };
    }

    case "pause_plan": {
      if (run.status !== "running") {
        return { ok: false, error: `Cannot pause plan in status '${run.status}'` };
      }
      newRun.status = "paused";
      return { ok: true, run: newRun };
    }

    case "resume_plan": {
      if (run.status !== "paused") {
        return { ok: false, error: `Cannot resume plan in status '${run.status}'` };
      }
      newRun.status = "running";
      return { ok: true, run: newRun };
    }

    case "cancel_plan": {
      if (run.status === "completed" || run.status === "cancelled") {
        return { ok: false, error: `Plan is already ${run.status}` };
      }
      newRun.status = "cancelled";
      newRun.completedAt = now;
      return { ok: true, run: newRun };
    }

    case "mark_user_task_completed": {
      const nodeState = newRun.nodeStates[command.nodeId];
      if (!nodeState) {
        return { ok: false, error: `Node '${command.nodeId}' not found` };
      }
      if (nodeState.status !== "ready" && nodeState.status !== "running") {
        return {
          ok: false,
          error: `Cannot mark node '${command.nodeId}' completed — current status is '${nodeState.status}'`,
        };
      }
      nodeState.status = "completed";
      nodeState.attempts += 1;
      nodeState.completedAt = now;

      recordRuntimeLayer(command.nodeId);

      // Check if downstream nodes can become ready
      unlockDownstreamNodes(newRun, compiledPlan, command.nodeId);

      // Record downstream node state changes in additional runtime layers
      if (layerVersion !== undefined) {
        for (const nodeId of Object.keys(newRun.nodeStates)) {
          if (nodeId === command.nodeId) continue;
          const prev = run.nodeStates[nodeId];
          const next = newRun.nodeStates[nodeId];
          if (prev && next && prev.status !== next.status) {
            layers.push(
              nodeStateToRuntimeLayer(compiledPlan.editablePlanId, nodeId, next, layerVersion),
            );
          }
        }
      }

      // Check if plan is complete
      checkPlanCompletion(newRun, compiledPlan);

      return { ok: true, run: newRun, ...(layers.length > 0 ? { layers } : {}) };
    }

    case "approve_checkpoint": {
      const nodeState = newRun.nodeStates[command.nodeId];
      if (!nodeState) {
        return { ok: false, error: `Node '${command.nodeId}' not found` };
      }
      if (nodeState.status !== "ready" && nodeState.status !== "running") {
        return {
          ok: false,
          error: `Cannot approve checkpoint '${command.nodeId}' — current status is '${nodeState.status}'`,
        };
      }
      nodeState.status = "completed";
      nodeState.attempts += 1;
      nodeState.completedAt = now;

      recordRuntimeLayer(command.nodeId);

      // Record checkpoint response
      if (command.response !== undefined) {
        newRun.checkpointResponses.push({
          id: `cr_${command.nodeId}_${Date.now()}`,
          planRunId: run.id,
          nodeId: command.nodeId,
          response: command.response,
          submittedAt: now,
        });
      }

      // Unlock downstream
      unlockDownstreamNodes(newRun, compiledPlan, command.nodeId);

      // Record downstream node state changes
      if (layerVersion !== undefined) {
        for (const nodeId of Object.keys(newRun.nodeStates)) {
          if (nodeId === command.nodeId) continue;
          const prev = run.nodeStates[nodeId];
          const next = newRun.nodeStates[nodeId];
          if (prev && next && prev.status !== next.status) {
            layers.push(
              nodeStateToRuntimeLayer(compiledPlan.editablePlanId, nodeId, next, layerVersion),
            );
          }
        }
      }

      // Record checkpoint response as a ResultLayer
      if (layerVersion !== undefined && command.response !== undefined) {
        layers.push(
          nodeResultToResultLayer(compiledPlan.editablePlanId, command.nodeId, {
            checkpointResponse: command.response,
          }, layerVersion),
        );
      }

      checkPlanCompletion(newRun, compiledPlan);

      return { ok: true, run: newRun, ...(layers.length > 0 ? { layers } : {}) };
    }

    case "reject_checkpoint": {
      const nodeState = newRun.nodeStates[command.nodeId];
      if (!nodeState) {
        return { ok: false, error: `Node '${command.nodeId}' not found` };
      }
      if (nodeState.status !== "ready" && nodeState.status !== "running") {
        return {
          ok: false,
          error: `Cannot reject checkpoint '${command.nodeId}' — current status is '${nodeState.status}'`,
        };
      }

      // Mark failed and pause the plan
      nodeState.status = "failed";
      nodeState.lastError = command.reason ?? "Checkpoint rejected";
      nodeState.attempts += 1;
      newRun.status = "paused";

      recordRuntimeLayer(command.nodeId);

      return { ok: true, run: newRun, ...(layers.length > 0 ? { layers } : {}) };
    }

    case "retry_node": {
      const nodeState = newRun.nodeStates[command.nodeId];
      if (!nodeState) {
        return { ok: false, error: `Node '${command.nodeId}' not found` };
      }
      if (nodeState.status !== "failed") {
        return {
          ok: false,
          error: `Cannot retry node '${command.nodeId}' — current status is '${nodeState.status}'`,
        };
      }

      nodeState.status = "ready";
      nodeState.lastError = undefined;

      recordRuntimeLayer(command.nodeId);

      return { ok: true, run: newRun, ...(layers.length > 0 ? { layers } : {}) };
    }

    default:
      return { ok: false, error: `Unknown command type` };
  }
}

/**
 * After a node completes, check if any downstream nodes have all
 * their dependencies satisfied, and mark them as "ready".
 */
function unlockDownstreamNodes(
  run: PlanRun,
  compiledPlan: CompiledPlan,
  completedNodeId: string,
): void {
  const completedNode = compiledPlan.nodes.find((n) => n.id === completedNodeId);
  if (!completedNode) return;

  for (const dependentId of completedNode.dependents) {
    const dependentNode = compiledPlan.nodes.find((n) => n.id === dependentId);
    const state = run.nodeStates[dependentId];
    if (!dependentNode || !state) continue;

    // Only check nodes that are still pending
    if (state.status !== "pending" && state.status !== "blocked") continue;

    const allDepsCompleted = dependentNode.dependencies.every((depId) => {
      const depState = run.nodeStates[depId];
      return (
        depState?.status === "completed" ||
        depState?.status === "skipped"
      );
    });

    if (allDepsCompleted) {
      state.status = "ready";
    }
  }
}

/**
 * Check if all nodes are completed/cancelled/skipped, and mark plan as completed.
 */
function checkPlanCompletion(run: PlanRun, compiledPlan: CompiledPlan): void {
  if (compiledPlan.completionPolicy.type !== "all_tasks_completed") return;

  const allDone = compiledPlan.nodes.every((node) => {
    const state = run.nodeStates[node.id];
    return (
      state?.status === "completed" ||
      state?.status === "cancelled" ||
      state?.status === "skipped"
    );
  });

  if (allDone) {
    run.status = "completed";
    run.completedAt = new Date().toISOString();
  }
}
