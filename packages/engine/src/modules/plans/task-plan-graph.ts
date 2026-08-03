import type { EffectivePlanGraph } from "@chrona/contracts/ai";
import type { SavedCompiledPlan } from "@/modules/plan-execution/persistence/compiled-plan-store";
import { db } from "@/lib/db";
import { resolveScopeWorkBlockId } from "@/modules/plan-execution/persistence/execution-scope";
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
  workBlockId?: string | null,
): Promise<CompatPlan | null> {
  const scope = await resolveScopeWorkBlockId(taskId, { workBlockId });
  const head = await db.taskPlanGenerationHead.findUnique({
    where: { taskId_workBlockScopeKey: { taskId, workBlockScopeKey: scope ?? "" } },
    include: { currentPlan: true },
  });
  if (!head?.currentPlan) return null;
  const plan = head.currentPlan;
  return toCompatPlan({
    recordId: plan.id,
    workspaceId: plan.workspaceId,
    taskId: plan.taskId,
    workBlockId: plan.workBlockId,
    compiledPlan: plan.compiledPlan as unknown as SavedCompiledPlan["compiledPlan"],
    editablePlan: plan.editablePlan as unknown as SavedCompiledPlan["editablePlan"],
    status: plan.status === "Accepted" ? "accepted" : plan.status === "Draft" ? "draft" : plan.status === "Superseded" ? "superseded" : "archived",
    prompt: plan.prompt,
    summary: plan.summary,
    generatedBy: plan.generatedBy,
    changeSummary: null,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  });
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
