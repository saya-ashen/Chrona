import { resolveEffectivePlanGraph } from "@chrona/graph-runtime";
import type { GraphDispatchOutcome, GraphExecutionEvent } from "@chrona/graph-runtime";
import type {
  EffectivePlanGraph,
  NodeAttempt,
  NodeResult,
  PlanGraph,
} from "@chrona/contracts/ai";
import type { ExecutionSessionRow } from "../persistence/execution-session-store";

export function completedExecutionNodeIds(effective: EffectivePlanGraph) {
  return effective.nodes
    .filter((node) => node.status === "completed")
    .map((node) => node.id);
}

export function toEffectivePlanGraph(input: {
  graph: PlanGraph;
  attempts: NodeAttempt[];
  results: NodeResult[];
}): EffectivePlanGraph {
  return resolveEffectivePlanGraph({
    graph: input.graph,
    attempts: input.attempts,
    results: input.results,
  }) as unknown as EffectivePlanGraph;
}

export function currentNodeFromEffective(effective: EffectivePlanGraph) {
  return (
    effective.nodes.find((node) => node.status === "running") ??
    effective.nodes.find(
      (node) =>
        node.status === "waiting_for_user" ||
        node.status === "waiting_for_approval" ||
        node.status === "blocked" ||
        node.status === "failed",
    ) ??
    null
  );
}

export function currentNodeFromOutcome(outcome: GraphDispatchOutcome): string | null {
  if (outcome.status === "running" && outcome.currentNodeId === null) {
    return null;
  }
  return (
    outcome.currentNodeId ??
    currentNodeFromEffective(outcome.effective as unknown as EffectivePlanGraph)?.id ??
    null
  );
}

export function latestStartedNodeId(events: GraphExecutionEvent[]): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === "node_started") {
      return event.node.id;
    }
  }
  return null;
}

export function currentNodeFromState(input: {
  effective: EffectivePlanGraph;
  executionSession: ExecutionSessionRow;
  nodeId?: string;
}) {
  return (
    (input.nodeId
      ? input.effective.nodes.find((node) => node.id === input.nodeId)
      : null) ??
    input.effective.nodes.find(
      (node) => node.id === input.executionSession.currentNodeId,
    ) ??
    input.effective.nodes.find((node) => node.status === "running") ??
    input.effective.nodes.find(
      (node) =>
        node.status === "waiting_for_user" ||
        node.status === "waiting_for_approval" ||
        node.status === "blocked" ||
        node.status === "failed",
    ) ??
    null
  );
}
