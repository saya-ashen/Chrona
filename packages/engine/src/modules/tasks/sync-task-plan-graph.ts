import { getAcceptedCompiledPlan } from "@/modules/plan-execution/compiled-plan-store";
import { getLayers, appendLayer } from "@/modules/plan-execution/plan-run-store";
import { resolveEffectivePlanGraph } from "@chrona/domain";
import type { RuntimeLayer, EffectivePlanNode } from "@chrona/contracts/ai";

function mapTaskStatusToNodeStatus(taskStatus: string): EffectivePlanNode["status"] | null {
  switch (taskStatus) {
    case "Running":
      return "running";
    case "WaitingForInput":
      return "waiting_for_user";
    case "Blocked":
    case "Failed":
      return "blocked";
    case "Completed":
    case "Done":
      return "completed";
    default:
      return null;
  }
}

export async function syncAcceptedTaskPlanForTask(input: {
  taskId: string;
  linkedTaskId: string;
  taskStatus: string;
  completionSummary?: string | null;
}) {
  const accepted = await getAcceptedCompiledPlan(input.taskId);
  if (!accepted) {
    throw new Error("Accepted compiled plan not found");
  }

  const layers = await getLayers(input.taskId, accepted.planId);
  const effective = resolveEffectivePlanGraph(accepted.compiledPlan, layers);

  // Find the node linked to this child task
  const linkedNode = effective.nodes.find(
    (n) => n.linkedTaskId === input.linkedTaskId,
  );

  if (!linkedNode) {
    return; // Node not found in plan — nothing to sync
  }

  const nextStatus = mapTaskStatusToNodeStatus(input.taskStatus);
  if (!nextStatus) {
    return; // No status change needed
  }

  const layer: RuntimeLayer = {
    type: "runtime",
    planId: accepted.planId,
    timestamp: new Date().toISOString(),
    layerId: `sync_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    version: 1,
    active: true,
    source: "system",
    nodeStates: {
      [linkedNode.id]: {
        status: nextStatus,
        ...(nextStatus === "completed" && input.completionSummary
          ? { output: { completionSummary: input.completionSummary } }
          : {}),
      },
    },
  };

  await appendLayer({
    workspaceId: accepted.workspaceId,
    taskId: input.taskId,
    planId: accepted.planId,
    layer,
  });
}
