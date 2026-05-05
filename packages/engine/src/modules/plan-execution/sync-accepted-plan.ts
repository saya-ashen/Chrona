import type { RuntimeLayer } from "@chrona/contracts/ai";
import { resolveEffectivePlanGraph } from "@chrona/domain";
import { getAcceptedCompiledPlan } from "./compiled-plan-store";
import { getLayers, getPlanRun, savePlanRun } from "./plan-run-store";

export async function syncAcceptedTaskPlanForTask(input: {
  taskId: string;
}): Promise<void> {
  const saved = await getAcceptedCompiledPlan(input.taskId);
  if (!saved) return;
  const planId = saved.compiledPlan.editablePlanId;
  const layers = await getLayers(input.taskId, planId);
  const planRun = await getPlanRun(input.taskId, planId);
  if (!planRun) return;

  const effective = resolveEffectivePlanGraph(saved.compiledPlan, layers);
  const nodeStatuses: Record<string, { status: string }> = {};
  for (const node of effective.nodes) {
    nodeStatuses[node.id] = { status: node.status };
  }

  const syncLayer: RuntimeLayer = {
    type: "runtime",
    planId,
    timestamp: new Date().toISOString(),
    layerId: `sync_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    version: layers.length + 1,
    active: true,
    source: "system",
    nodeStates: nodeStatuses as RuntimeLayer["nodeStates"],
  };

  await savePlanRun({
    workspaceId: saved.workspaceId,
    taskId: input.taskId,
    planId,
    run: planRun.planRun,
    layers: [...layers, syncLayer],
  });
}
