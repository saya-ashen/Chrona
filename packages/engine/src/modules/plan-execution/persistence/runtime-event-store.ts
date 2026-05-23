import type { GraphExecutionEvent } from "@chrona/graph-runtime";
import { appendMainSessionEvent } from "../plan-state-store";

export async function appendGraphRuntimeEvents(input: {
  taskId: string;
  planId: string;
  sessionId: string;
  events: GraphExecutionEvent[];
}) {
  for (const event of input.events) {
    switch (event.type) {
      case "command_received":
      case "command_unsupported":
      case "command_validation_failed":
        break;
      case "executable_path_computed":
        await appendMainSessionEvent({
          taskId: input.taskId,
          planId: input.planId,
          sessionId: input.sessionId,
          eventType: "executable_path_computed",
          payload: {
            readyCount: event.effective.readyNodeIds.length,
            blockedCount: event.effective.blockedNodeIds.length,
            completedCount: event.effective.completedNodeIds.length,
            runningCount: event.effective.runningNodeIds.length,
            failedCount: event.effective.failedNodeIds.length,
            pendingCount: event.effective.pendingNodeIds.length,
          },
        });
        break;
      case "node_started":
        await appendMainSessionEvent({
          taskId: input.taskId,
          planId: input.planId,
          sessionId: input.sessionId,
          eventType: "node_started",
          nodeId: event.node.id,
          nodeTitle: event.node.title,
          payload: {
            nodeType: event.node.type,
          },
        });
        break;
      case "node_completed":
        if (event.result.status !== "done") break;
        await appendMainSessionEvent({
          taskId: input.taskId,
          planId: input.planId,
          sessionId: input.sessionId,
          eventType: "node_completed",
          nodeId: event.node.id,
          nodeTitle: event.node.title,
          payload: { summary: event.result.summary },
        });
        break;
      case "node_waiting_for_user":
        if (event.result.status !== "waiting_for_user") break;
        await appendMainSessionEvent({
          taskId: input.taskId,
          planId: input.planId,
          sessionId: input.sessionId,
          eventType: "node_waiting_for_user",
          nodeId: event.node.id,
          nodeTitle: event.node.title,
          payload: { prompt: event.result.prompt },
        });
        break;
      case "node_waiting_for_approval":
        if (event.result.status !== "waiting_for_approval") break;
        await appendMainSessionEvent({
          taskId: input.taskId,
          planId: input.planId,
          sessionId: input.sessionId,
          eventType: "node_waiting_for_approval",
          nodeId: event.node.id,
          nodeTitle: event.node.title,
          payload: { prompt: event.result.prompt },
        });
        break;
      case "node_blocked":
        if (event.result.status !== "blocked") break;
        await appendMainSessionEvent({
          taskId: input.taskId,
          planId: input.planId,
          sessionId: input.sessionId,
          eventType: "node_blocked",
          nodeId: event.node.id,
          nodeTitle: event.node.title,
          payload: { reason: event.result.reason },
        });
        break;
      case "replan_proposed":
        if (event.result.status !== "replan_required") break;
        await appendMainSessionEvent({
          taskId: input.taskId,
          planId: input.planId,
          sessionId: input.sessionId,
          eventType: "replan_proposed",
          nodeId: event.node.id,
          nodeTitle: event.node.title,
          payload: { reason: event.result.reason },
        });
        break;
      case "graph_mutation_applied":
        await appendMainSessionEvent({
          taskId: input.taskId,
          planId: input.planId,
          sessionId: input.sessionId,
          eventType: "graph_mutation_applied",
          payload: {
            mutationId: event.mutationId,
            affectedNodeIds: event.affectedNodeIds,
          },
        });
        break;
      case "external_result_synced":
        await appendMainSessionEvent({
          taskId: input.taskId,
          planId: input.planId,
          sessionId: input.sessionId,
          eventType: "external_result_synced",
          nodeId: event.nodeId,
          payload: { status: event.status },
        });
        break;
    }
  }
}
