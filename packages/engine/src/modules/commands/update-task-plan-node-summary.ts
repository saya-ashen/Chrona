import { getAcceptedCompiledPlan } from "@/modules/plan-execution/compiled-plan-store";
import { appendLayer } from "@/modules/plan-execution/plan-run-store";
import type { ResultLayer, NodeResult } from "@chrona/contracts/ai";

export async function updateTaskPlanNodeSummary(input: {
  taskId: string;
  nodeId: string;
  completionSummary: string | null;
}) {
  const accepted = await getAcceptedCompiledPlan(input.taskId);
  if (!accepted) {
    throw new Error("Accepted compiled plan not found");
  }

  const summary = typeof input.completionSummary === "string" &&
    input.completionSummary.trim().length > 0
    ? input.completionSummary.trim()
    : undefined;

  const layer: ResultLayer = {
    type: "result",
    planId: accepted.planId,
    timestamp: new Date().toISOString(),
    layerId: `result_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    version: 1,
    active: true,
    source: "user",
    nodeResults: {
      [input.nodeId]: {
        outputSummary: summary ?? null,
      } as NodeResult,
    },
  };

  await appendLayer({
    workspaceId: accepted.workspaceId,
    taskId: input.taskId,
    planId: accepted.planId,
    layer,
  });

  return { taskId: input.taskId, nodeId: input.nodeId };
}
