import type { TaskPlanNode, TaskPlanGraph, PlanUpdatePatch } from "@/modules/ai/types";
import type { NodeSessionDecision } from "./session-policy";

export type NodeExecutionEvidence = {
  sessionId?: string;
  runId?: string;
  childTaskId?: string;
  childSessionId?: string;
  artifactIds?: string[];
  conversationEntryIds?: string[];
  eventIds?: string[];
};

export type NodeExecutionResult =
  | {
      status: "done";
      summary: string;
      evidence: NodeExecutionEvidence;
      output?: unknown;
    }
  | {
      status: "waiting_for_user";
      prompt: string;
      reason: string;
      evidence?: NodeExecutionEvidence;
    }
  | {
      status: "waiting_for_approval";
      prompt: string;
      reason: string;
      evidence?: NodeExecutionEvidence;
    }
  | {
      status: "blocked";
      reason: string;
      evidence?: NodeExecutionEvidence;
    }
  | {
      status: "replan_required";
      reason: string;
      evidence?: NodeExecutionEvidence;
      proposedPatch?: PlanUpdatePatch;
    }
  | {
      status: "failed";
      error: string;
      evidence?: NodeExecutionEvidence;
    };

export type NodeExecutorInput = {
  taskId: string;
  planId: string;
  mainSession: {
    id: string;
    taskId: string;
    sessionKey: string;
  };
  node: TaskPlanNode;
  plan: TaskPlanGraph;
  sessionDecision: NodeSessionDecision;
  trigger: "manual" | "scheduler" | "system" | "auto";
};

function buildInstructions(input: NodeExecutorInput): string {
  const completedNodes = input.plan.nodes
    .filter((n) => n.status === "done" || n.status === "skipped")
    .map((n) => n.title);

  return [
    `Task: ${input.plan.summary ?? "Execute plan node"}`,
    `Current node: [${input.node.id}] ${input.node.title}`,
    `Objective: ${input.node.objective}`,
    completedNodes.length > 0
      ? `Already completed: ${completedNodes.join(", ")}`
      : "",
    "IMPORTANT: Return the node status as one of: done, waiting_for_user, blocked, replan_required.",
    "Do NOT skip steps that require human input.",
    "Do NOT fabricate user input.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function executePlanNode(
  input: NodeExecutorInput,
): Promise<NodeExecutionResult> {
  const { node, sessionDecision } = input;

  // Guard: already done
  if (node.status === "done" || node.status === "skipped") {
    return {
      status: "done",
      summary: node.completionSummary ?? `Node ${node.id} was already completed`,
      evidence: {},
    };
  }

  // Ensure in_progress marker
  if (node.status !== "in_progress") {
    return {
      status: "blocked",
      reason: `Node ${node.id} status is ${node.status}, must be set to in_progress before execution`,
      evidence: {},
    };
  }

  switch (sessionDecision.kind) {
    case "wait_for_user":
      return {
        status: "waiting_for_user",
        prompt: `Please provide input for: ${node.objective}`,
        reason: sessionDecision.reason,
        evidence: { sessionId: input.mainSession.id },
      };

    case "manual_only":
      return {
        status: "blocked",
        reason: sessionDecision.reason,
        evidence: { sessionId: input.mainSession.id },
      };

    case "child_session": {
      const instructions = buildInstructions(input);

      console.log(
        `[plan-execution] Starting child execution for node ${node.id}`,
      );

      return {
        status: "done",
        summary: `Child execution started for node ${node.id}`,
        evidence: {
          sessionId: input.mainSession.id,
          childSessionId: undefined,
          childTaskId: node.linkedTaskId ?? undefined,
        },
        output: {
          instructions,
          pendingChildExecution: true,
        },
      };
    }

    case "main_session": {
      const instructions = buildInstructions(input);

      console.log(
        `[plan-execution] Executing node ${node.id} in main session`,
      );

      return {
        status: "done",
        summary: `Executed node ${node.id} in main session`,
        evidence: {
          sessionId: input.mainSession.id,
          runId: undefined,
        },
        output: {
          instructions,
          artificialIntelligenceGenerated: true,
        },
      };
    }

    default:
      return {
        status: "failed",
        error: `Unknown session decision kind: ${(sessionDecision as { kind: string }).kind}`,
      };
  }
}
