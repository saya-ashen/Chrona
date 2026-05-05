import type { EffectivePlanNode, EffectivePlanGraph } from "@chrona/contracts/ai";

export type NodeSessionDecision =
  | { kind: "main_session"; reason: string }
  | {
      kind: "child_session";
      reason: string;
      childTaskMode?: "materialize_task" | "session_only";
    }
  | { kind: "wait_for_user"; reason: string }
  | { kind: "manual_only"; reason: string };

export type SessionPolicyInput = {
  node: EffectivePlanNode;
  plan: EffectivePlanGraph;
  parentTaskId: string;
};

const LONG_ESTIMATED_MINUTES = 20;
const CHILD_SESSION_NODE_TYPES = new Set<string>(["task"]);

function looksLikeMultiStep(node: EffectivePlanNode): boolean {
  const config = node.config as Record<string, unknown>;
  const objective = typeof config.objective === "string" ? config.objective : "";
  const text = `${node.title} ${objective}`.toLowerCase();
  const multiStepTerms = [
    "implement", "refactor", "build", "create",
    "develop", "migrate", "deploy", "integrate",
    "rewrite", "restructure", "investigate", "audit", "review",
  ];
  return multiStepTerms.some((term) => text.includes(term));
}

function readSessionStrategy(node: EffectivePlanNode): string | undefined {
  const config = node.config as Record<string, unknown>;
  const strategy = config.sessionStrategy;
  return typeof strategy === "string" ? strategy : undefined;
}

function isUserTask(node: EffectivePlanNode): boolean {
  return node.executor === "user" || node.mode === "manual";
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

  if (isUserTask(node)) {
    return {
      kind: "wait_for_user",
      reason: `Node ${node.id} requires human input: ${node.title}`,
    };
  }

  if (needsApproval(node)) {
    return {
      kind: "manual_only",
      reason: `Node ${node.id} requires human approval`,
    };
  }

  if (node.mode === "manual") {
    return {
      kind: "manual_only",
      reason: `Node ${node.id} execution mode is manual`,
    };
  }

  const strategy = readSessionStrategy(node);
  if (strategy === "per_subtask") {
    return {
      kind: "child_session",
      reason: `Node ${node.id} session strategy is per_subtask`,
      childTaskMode: "materialize_task",
    };
  }

  const config = node.config as Record<string, unknown>;
  if (typeof config.linkedTaskId === "string" && config.linkedTaskId.length > 0) {
    return {
      kind: "child_session",
      reason: `Node ${node.id} already linked to child task`,
      childTaskMode: "session_only",
    };
  }

  if (
    node.estimatedMinutes !== undefined &&
    node.estimatedMinutes !== null &&
    node.estimatedMinutes >= LONG_ESTIMATED_MINUTES
  ) {
    return {
      kind: "child_session",
      reason: `Node ${node.id} estimated at ${node.estimatedMinutes}min, qualifies for child session`,
      childTaskMode: "materialize_task",
    };
  }

  if (looksLikeMultiStep(node)) {
    return {
      kind: "child_session",
      reason: `Node ${node.id} appears to be multi-step, using child session`,
      childTaskMode: "materialize_task",
    };
  }

  if (CHILD_SESSION_NODE_TYPES.has(node.type)) {
    const isShort = (node.estimatedMinutes ?? 0) < LONG_ESTIMATED_MINUTES;
    if (isShort) {
      return {
        kind: "main_session",
        reason: `Node ${node.id} type ${node.type} is short and simple, running in main session`,
      };
    }
    return {
      kind: "child_session",
      reason: `Node ${node.id} type ${node.type} qualifies for child session`,
      childTaskMode: node.type === "task" ? "materialize_task" : "session_only",
    };
  }

  return {
    kind: "main_session",
    reason: `Node ${node.id} is a short automatic step, using main session`,
  };
}
