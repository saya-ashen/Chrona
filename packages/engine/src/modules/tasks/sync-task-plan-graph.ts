import type { SavedTaskPlanGraph, TaskPlanGraph, TaskPlanNode } from "@chrona/contracts/ai";
import { saveTaskPlanGraph } from "@/modules/tasks/task-plan-graph-store";

type SyncPlanNodeFromTaskInput = {
  plan: TaskPlanGraph;
  linkedTaskId: string;
  taskStatus: string;
  completionSummary?: string | null;
};

function mapTaskStatusToPlanNodeStatus(taskStatus: string): TaskPlanNode["status"] | null {
  switch (taskStatus) {
    case "Running":
      return "in_progress";
    case "WaitingForInput":
      return "waiting_for_user";
    case "Blocked":
    case "Failed":
      return "blocked";
    case "Completed":
    case "Done":
      return "done";
    default:
      return null;
  }
}

export function syncTaskPlanNodeFromTask(input: SyncPlanNodeFromTaskInput): TaskPlanGraph {
  const nextStatus = mapTaskStatusToPlanNodeStatus(input.taskStatus);
  if (!nextStatus) {
    return input.plan;
  }

  return {
    ...input.plan,
    nodes: input.plan.nodes.map((node) => {
      if (node.linkedTaskId !== input.linkedTaskId) {
        return node;
      }
      return {
        ...node,
        status: nextStatus,
        completionSummary:
          nextStatus === "done"
            ? input.completionSummary?.trim() || "Awaiting agent-authored completion summary."
            : node.completionSummary,
      };
    }),
  };
}

export async function syncAcceptedTaskPlanForTask(input: {
  savedPlan: SavedTaskPlanGraph & { taskId: string };
  linkedTaskId: string;
  taskStatus: string;
  completionSummary?: string | null;
}) {
  const nextPlan = syncTaskPlanNodeFromTask({
    plan: input.savedPlan.plan,
    linkedTaskId: input.linkedTaskId,
    taskStatus: input.taskStatus,
    completionSummary: input.completionSummary,
  });

  await saveTaskPlanGraph({
    workspaceId: input.savedPlan.workspaceId,
    taskId: input.savedPlan.taskId,
    plan: nextPlan,
    prompt: input.savedPlan.prompt ?? undefined,
    status: input.savedPlan.status,
    source: input.savedPlan.source,
    generatedBy: input.savedPlan.generatedBy ?? undefined,
    summary: input.savedPlan.summary ?? undefined,
    changeSummary: input.savedPlan.changeSummary ?? undefined,
  });

  return nextPlan;
}
