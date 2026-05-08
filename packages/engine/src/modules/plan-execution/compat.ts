import type { EffectivePlanGraph } from "@chrona/contracts/ai";
import { getAcceptedCompiledPlan, getLatestCompiledPlan, type SavedCompiledPlan } from "./compiled-plan-store";
import { resolveSavedPlanEffectiveGraph } from "@/modules/queries/task-plan-read-model";

type CompatPlan = SavedCompiledPlan & {
  id: string;
  planId: string;
  revision: number;
  plan: SavedCompiledPlan["compiledPlan"];
  effectivePlan: EffectivePlanGraph;
};

async function toCompatPlan(savedPlan: SavedCompiledPlan): Promise<CompatPlan> {
  return {
    ...savedPlan,
    id: savedPlan.recordId,
    planId: savedPlan.compiledPlan.editablePlanId,
    revision: savedPlan.compiledPlan.sourceVersion,
    plan: savedPlan.compiledPlan,
    effectivePlan: await resolveSavedPlanEffectiveGraph(savedPlan),
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

export function enrichPlanGraphNodes(effectivePlan: EffectivePlanGraph) {
  return effectivePlan.nodes.map((node) => ({
    ...node,
    isReady: node.ready,
    isDone: ["completed", "skipped"].includes(node.status),
    isBlocked:
      node.status === "blocked" ||
      node.status === "waiting" ||
      node.status === "waiting_for_user" ||
      node.status === "waiting_for_approval",
    executionClassification:
      node.waitKind === "approval" || node.waitKind === "review"
        ? "review_gate"
        : node.waitKind === "user_input"
          ? "human_dependent"
          : "automatic_standalone",
    readiness:
      node.ready
        ? "ready"
        : node.status === "waiting" ||
            node.status === "waiting_for_user" ||
            node.status === "waiting_for_approval"
          ? "waiting"
          : node.dependencies.length > 0
            ? "blocked"
            : "ready",
    nextAction:
      node.waitKind === "approval" || node.waitKind === "review"
        ? "Review and approve this step's output before continuing"
        : node.waitKind === "user_input"
          ? "Provide required information to proceed"
          : node.dependencies.length > 0 && !node.ready
            ? "Blocked: resolve dependencies first"
            : "Ready to auto-start",
  }));
}

export function getReadyAutoRunnableNodes(
  effectivePlan: EffectivePlanGraph,
): Array<{ nodeId: string; title: string; type: string; isReady: true }> {
  return effectivePlan.nodes
    .filter((node) => node.ready && node.mode !== "manual")
    .map((node) => ({ nodeId: node.id, title: node.title, type: node.type, isReady: true }));
}
