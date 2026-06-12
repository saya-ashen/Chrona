import type { GraphExecutionEvent } from "@chrona/graph-runtime";
import { appendMainSessionEvent } from "./plan-state-store";
import type { PlanGraphCommandEnvelope } from "../types";

export async function appendGraphRuntimeEvents(input: {
  taskId: string;
  planId: string;
  workBlockId?: string | null;
  sessionId: string;
  events: GraphExecutionEvent[];
  envelope?: PlanGraphCommandEnvelope;
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
          workBlockId: input.workBlockId,
          eventType: "executable_path_computed",
          rawEvent: event,
          payload: {
            readyCount: event.effective.readyNodeIds.length,
            blockedCount: event.effective.blockedNodeIds.length,
            completedCount: event.effective.completedNodeIds.length,
            runningCount: event.effective.runningNodeIds.length,
            failedCount: event.effective.failedNodeIds.length,
            pendingCount: event.effective.pendingNodeIds.length,
          },
          envelope: input.envelope,
        });
        break;
      case "node_started":
        await appendMainSessionEvent({
          taskId: input.taskId,
          planId: input.planId,
          sessionId: input.sessionId,
          workBlockId: input.workBlockId,
          eventType: "node_started",
          nodeId: event.node.id,
          nodeTitle: event.node.title,
          rawEvent: event,
          payload: {
            nodeType: event.node.type,
          },
          envelope: input.envelope,
        });
        break;
      case "node_completed":
        if (event.result.status !== "done") break;
        await appendMainSessionEvent({
          taskId: input.taskId,
          planId: input.planId,
          sessionId: input.sessionId,
          workBlockId: input.workBlockId,
          eventType: "node_completed",
          nodeId: event.node.id,
          nodeTitle: event.node.title,
          rawEvent: event,
          payload: { summary: event.result.summary },
          envelope: input.envelope,
        });
        break;
      case "node_waiting_for_user":
        if (event.result.status !== "waiting_for_user") break;
        await appendMainSessionEvent({
          taskId: input.taskId,
          planId: input.planId,
          sessionId: input.sessionId,
          workBlockId: input.workBlockId,
          eventType: "node_waiting_for_user",
          nodeId: event.node.id,
          nodeTitle: event.node.title,
          rawEvent: event,
          payload: { prompt: event.result.prompt },
          envelope: input.envelope,
        });
        break;
      case "node_waiting_for_approval":
        if (event.result.status !== "waiting_for_approval") break;
        await appendMainSessionEvent({
          taskId: input.taskId,
          planId: input.planId,
          sessionId: input.sessionId,
          workBlockId: input.workBlockId,
          eventType: "node_waiting_for_approval",
          nodeId: event.node.id,
          nodeTitle: event.node.title,
          rawEvent: event,
          payload: { prompt: event.result.prompt },
          envelope: input.envelope,
        });
        break;
      case "node_blocked":
        if (event.result.status !== "blocked") break;
        await appendMainSessionEvent({
          taskId: input.taskId,
          planId: input.planId,
          sessionId: input.sessionId,
          workBlockId: input.workBlockId,
          eventType: "node_blocked",
          nodeId: event.node.id,
          nodeTitle: event.node.title,
          rawEvent: event,
          payload: { reason: event.result.reason },
          envelope: input.envelope,
        });
        break;
      case "replan_proposed":
        if (event.result.status !== "replan_required") break;
        await appendMainSessionEvent({
          taskId: input.taskId,
          planId: input.planId,
          sessionId: input.sessionId,
          workBlockId: input.workBlockId,
          eventType: "replan_proposed",
          nodeId: event.node.id,
          nodeTitle: event.node.title,
          rawEvent: event,
          payload: { reason: event.result.reason },
          envelope: input.envelope,
        });
        break;
      case "graph_mutation_applied":
        await appendMainSessionEvent({
          taskId: input.taskId,
          planId: input.planId,
          sessionId: input.sessionId,
          workBlockId: input.workBlockId,
          eventType: "graph_mutation_applied",
          rawEvent: event,
          payload: {
            mutationId: event.mutationId,
            affectedNodeIds: event.affectedNodeIds,
          },
          envelope: input.envelope,
        });
        break;
      case "node_result_submitted":
        await appendMainSessionEvent({
          taskId: input.taskId,
          planId: input.planId,
          sessionId: input.sessionId,
          workBlockId: input.workBlockId,
          eventType: "node_result_submitted",
          nodeId: event.nodeId,
          rawEvent: event,
          payload: { status: event.status },
          envelope: input.envelope,
        });
        break;
    }
  }
}
