/**
 * Compatibility re-exports for transitional consumers during the task-plan
 * graph migration. Current engine code should prefer direct compiled-plan,
 * effective-graph, and saved-plan snapshot modules instead of importing here.
 */
export { createPlanRunFromCompiledPlan } from "./plan-runner";

export { savePlanRun as saveTaskPlanGraph } from "./plan-run-store";
export { getCompiledPlan as acceptTaskPlanGraph } from "./compiled-plan-store";

import type { CompiledPlan, PlanOverlayLayer } from "@chrona/contracts/ai";
import { resolveEffectivePlanGraph } from "@chrona/domain";
import { getAcceptedCompiledPlan, getLatestCompiledPlan, type SavedCompiledPlan } from "./compiled-plan-store";
export { type SavedAiPlanSnapshot, getLatestSavedAiPlanSnapshot } from "./saved-plan-snapshot";
export { syncAcceptedTaskPlanForTask } from "./sync-accepted-plan";

type CompatPlan = SavedCompiledPlan & {
  id: string;
  planId: string;
  revision: number;
  plan: CompiledPlan;
};

function toCompatPlan(sp: SavedCompiledPlan): CompatPlan {
  return {
    ...sp,
    id: sp.memoryId,
    planId: sp.compiledPlan.editablePlanId,
    revision: sp.compiledPlan.sourceVersion,
    plan: sp.compiledPlan,
  };
}

export async function getAcceptedTaskPlanGraph(taskId: string): Promise<CompatPlan | null> {
  const result = await getAcceptedCompiledPlan(taskId);
  if (!result) return null;
  return toCompatPlan(result);
}

export async function getLatestTaskPlanGraph(taskId: string): Promise<CompatPlan | null> {
  const result = await getLatestCompiledPlan(taskId);
  if (!result) return null;
  return toCompatPlan(result);
}

export function enrichPlanGraphNodes(
  compiledPlan: { nodes: Array<{ id: string; title: string; type: string; config: Record<string, unknown> }>; edges: Array<{ from: string; to: string }> },
  _nodeStates?: Record<string, { status: string }>,
) {
  return compiledPlan.nodes.map((node) => ({
    ...node,
    status: _nodeStates?.[node.id]?.status ?? "pending",
    isReady: _nodeStates?.[node.id]?.status === "ready",
    isDone: ["completed", "skipped"].includes(_nodeStates?.[node.id]?.status ?? ""),
    isBlocked: _nodeStates?.[node.id]?.status === "blocked",
    dependencies: compiledPlan.edges.filter((edge) => edge.to === node.id).map((edge) => edge.from),
    executionClassification:
      node.config?.checkpointType === "approve"
        ? "review_gate"
        : node.config?.checkpointType === "input"
          ? "human_dependent"
          : _nodeStates?.[node.id]?.status === "waiting_for_approval"
            ? "review_gate"
            : _nodeStates?.[node.id]?.status === "waiting_for_user"
              ? "human_dependent"
              : "automatic_standalone",
    readiness:
      _nodeStates?.[node.id]?.status === "ready"
        ? "ready"
        : _nodeStates?.[node.id]?.status === "waiting_for_approval" || _nodeStates?.[node.id]?.status === "waiting_for_user"
          ? "waiting"
          : compiledPlan.edges.some((edge) => edge.to === node.id)
            ? "blocked"
            : "ready",
    nextAction:
      node.config?.checkpointType === "approve" || _nodeStates?.[node.id]?.status === "waiting_for_approval"
        ? "Review and approve this step's output before continuing"
        : node.config?.checkpointType === "input" || _nodeStates?.[node.id]?.status === "waiting_for_user"
          ? "Provide required information to proceed"
          : compiledPlan.edges.some((edge) => edge.to === node.id)
            ? "Blocked: resolve dependencies first"
            : "Ready to auto-start",
  }));
}

export function getReadyAutoRunnableNodes(
  compiledPlan: CompiledPlan,
  layers: PlanOverlayLayer[],
) {
  const effective = resolveEffectivePlanGraph(compiledPlan, layers);
  return effective.readyNodeIds.map((nodeId) => {
    const node = effective.nodes.find((n) => n.id === nodeId)!;
    return { nodeId, title: node.title, type: node.type, isReady: true };
  });
}
