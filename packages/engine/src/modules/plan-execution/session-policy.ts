import type { EffectivePlanNode, EffectivePlanGraph } from "@chrona/contracts/ai";

export type NodeSessionDecision =
  | { kind: "main_session"; reason: string }
  | { kind: "wait_for_user"; reason: string }
  | { kind: "wait_for_approval"; reason: string }
  | { kind: "manual_only"; reason: string };

type SessionPolicyInput = {
  node: EffectivePlanNode;
  plan: EffectivePlanGraph;
  parentTaskId: string;
};

function isUserTask(node: EffectivePlanNode): boolean {
  return node.executor === "user";
}

function needsApproval(node: EffectivePlanNode): boolean {
  if (node.type !== "checkpoint") return false;
  const config = node.config as Record<string, unknown>;
  const checkpointType = config.checkpointType;
  return checkpointType === "approve" || checkpointType === "confirm";
}

export function decideNodeExecutionSession(input: SessionPolicyInput): NodeSessionDecision {
  const { node } = input;

  if (node.status === "completed" || node.status === "skipped") {
    return { kind: "main_session", reason: "Node already completed" };
  }

  if (node.status === "running") {
    return { kind: "main_session", reason: "Node already executing" };
  }

  if (needsApproval(node)) {
    return {
      kind: "wait_for_approval",
      reason: `Node ${node.id} requires human approval`,
    };
  }

  if (node.mode === "manual") {
    return {
      kind: "manual_only",
      reason: `Node ${node.id} execution mode is manual`,
    };
  }

  if (isUserTask(node)) {
    return {
      kind: "manual_only",
      reason: `Node ${node.id} is performed by the user`,
    };
  }

  return {
    kind: "main_session",
    reason: `Node ${node.id} is an automatic step, using main session`,
  };
}
