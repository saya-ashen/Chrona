import type { EffectivePlanGraph } from "@chrona/contracts/ai";
import {
  getLatestCompiledPlan,
  type SavedCompiledPlan,
} from "@/modules/plan-execution/persistence/compiled-plan-store";
import { resolveSavedPlanEffectiveGraph } from "./task-plan-read-model";

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

export async function getLatestTaskPlanGraph(
  taskId: string,
): Promise<CompatPlan | null> {
  const result = await getLatestCompiledPlan(taskId);
  if (!result) return null;
  return toCompatPlan(result);
}

export function getReadyAutoRunnableNodes(
  effectivePlan: EffectivePlanGraph,
): Array<{ nodeId: string; title: string; type: string; isReady: true }> {
  return effectivePlan.nodes
    .filter((node) => node.ready && node.mode !== "manual")
    .map((node) => ({
      nodeId: node.id,
      title: node.title,
      type: node.type,
      isReady: true,
    }));
}
