import type { TaskPlanNode, TaskPlanGraph } from "@chrona/contracts/ai";

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
  node: TaskPlanNode;
  plan: TaskPlanGraph;
  parentTaskId: string;
};

const LONG_ESTIMATED_MINUTES = 20;

const CHILD_SESSION_NODE_TYPES = new Set<string>(["task"]);

function looksLikeMultiStep(node: TaskPlanNode): boolean {
  const text = `${node.title} ${node.objective} ${node.description ?? ""}`.toLowerCase();
  const multiStepTerms = [
    "implement",
    "refactor",
    "build",
    "create",
    "develop",
    "migrate",
    "deploy",
    "integrate",
    "rewrite",
    "restructure",
    "investigate",
    "audit",
    "review",
  ];
  return multiStepTerms.some((term) => text.includes(term));
}

function readSessionStrategy(node: TaskPlanNode): string | undefined {
  if (node.metadata && typeof node.metadata === "object" && !Array.isArray(node.metadata)) {
    const raw = (node.metadata as Record<string, unknown>).sessionStrategy;
    if (typeof raw === "string") return raw;
  }
  return undefined;
}

export function decideNodeExecutionSession(input: SessionPolicyInput): NodeSessionDecision {
  const { node } = input;

  if (node.status === "done" || node.status === "skipped") {
    return { kind: "main_session", reason: "Node already completed" };
  }

  if (node.status === "in_progress" || node.status === "waiting_for_child") {
    return { kind: "main_session", reason: "Node already executing, let it continue" };
  }

  if (node.requiresHumanInput) {
    return {
      kind: "wait_for_user",
      reason: `Node ${node.id} requires human input: ${node.objective}`,
    };
  }

  if (!node.autoRunnable) {
    return {
      kind: "manual_only",
      reason: `Node ${node.id} is not auto-runnable`,
    };
  }

  if (node.requiresHumanApproval) {
    return {
      kind: "manual_only",
      reason: `Node ${node.id} requires human approval`,
    };
  }

  if (node.executionMode === "manual") {
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

  if (node.linkedTaskId) {
    return {
      kind: "child_session",
      reason: `Node ${node.id} already linked to child task`,
      childTaskMode: "session_only",
    };
  }

  if (
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
        reason: `Node ${node.id} type ${node.type} is short (${node.estimatedMinutes}min) and simple, running in main session`,
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
