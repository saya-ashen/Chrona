import { saveTaskPlanGraph, getAcceptedTaskPlanGraph } from "@/modules/tasks/task-plan-graph-store";

export async function updateTaskPlanNodeSummary(input: {
  taskId: string;
  nodeId: string;
  completionSummary: string | null;
}) {
  const acceptedPlan = await getAcceptedTaskPlanGraph(input.taskId);
  if (!acceptedPlan) {
    throw new Error("Accepted task plan graph not found");
  }

  const nextPlan = {
    ...acceptedPlan.plan,
    nodes: acceptedPlan.plan.nodes.map((node) =>
      node.id === input.nodeId
        ? {
            ...node,
            completionSummary:
              typeof input.completionSummary === "string" && input.completionSummary.trim().length > 0
                ? input.completionSummary.trim()
                : null,
          }
        : node,
    ),
  };

  await saveTaskPlanGraph({
    workspaceId: acceptedPlan.workspaceId,
    taskId: acceptedPlan.taskId,
    plan: nextPlan,
    prompt: acceptedPlan.prompt,
    status: acceptedPlan.status,
    source: acceptedPlan.source,
    generatedBy: acceptedPlan.generatedBy,
    summary: acceptedPlan.summary,
    changeSummary: acceptedPlan.changeSummary,
  });

  return { taskId: input.taskId, nodeId: input.nodeId };
}
