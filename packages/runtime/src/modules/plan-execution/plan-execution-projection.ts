import { computeExecutablePath } from "./executable-path";
import { getAcceptedTaskPlanGraph } from "@/modules/tasks/task-plan-graph-store";
import type { PlanExecutablePath } from "./executable-path";

export type PlanExecutionProjection = {
  planId: string;
  revision: number;
  executablePath: PlanExecutablePath;
  nextRunnableNodeId: string | null;
  terminalReason: PlanExecutablePath["terminalReason"];
  updatedAt: string;
};

export async function recomputePlanExecutionProjection(input: {
  taskId: string;
  planId: string;
}): Promise<PlanExecutionProjection | null> {
  const saved = await getAcceptedTaskPlanGraph(input.taskId);
  if (!saved || saved.id !== input.planId) {
    return null;
  }

  const path = computeExecutablePath(saved.plan);

  return {
    planId: saved.id,
    revision: saved.revision,
    executablePath: path,
    nextRunnableNodeId: path.readyNodeIds.length > 0 ? path.readyNodeIds[0]! : null,
    terminalReason: path.terminalReason,
    updatedAt: new Date().toISOString(),
  };
}
