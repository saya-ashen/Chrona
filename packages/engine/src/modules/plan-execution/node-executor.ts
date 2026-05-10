import type { EffectivePlanNode, EffectivePlanGraph, PlanPatch } from "@chrona/contracts/ai";
import type { NodeSessionDecision } from "./session-policy";
import { startRuntimeRun } from "@/modules/task-execution/start-runtime-run";

type NodeExecutionEvidence = {
  sessionId?: string;
  runId?: string;
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
      selectedBranch?: {
        label: string;
        nextNodeId: string;
        source: "user" | "ai" | "system" | "default";
      };
    }
  | { status: "waiting_for_user"; prompt: string; reason: string; evidence?: NodeExecutionEvidence }
  | { status: "waiting_for_approval"; prompt: string; reason: string; evidence?: NodeExecutionEvidence }
  | { status: "blocked"; reason: string; evidence?: NodeExecutionEvidence }
  | { status: "replan_required"; reason: string; evidence?: NodeExecutionEvidence; proposedPatch?: PlanPatch }
  | { status: "failed"; error: string; evidence?: NodeExecutionEvidence };

type NodeExecutorInput = {
  taskId: string;
  planId: string;
  mainSession: {
    id: string;
    taskId: string;
    sessionKey: string;
  };
  node: EffectivePlanNode;
  plan: EffectivePlanGraph;
  sessionDecision: NodeSessionDecision;
  trigger: "manual" | "scheduler" | "system" | "auto";
  runtimeName: string;
};

function buildInstructions(input: NodeExecutorInput): string {
  const completedNodes = input.plan.nodes
    .filter((n) => n.status === "completed" || n.status === "skipped")
    .map((n) => n.title);

  const nodeConfig =
    input.node.config && typeof input.node.config === "object"
      ? (input.node.config as Record<string, unknown>)
      : {};
  const definitionObjective =
    input.node.definition && typeof input.node.definition === "object"
      ? input.node.definition.objective
      : undefined;
  const legacyNode = input.node as unknown as Record<string, unknown>;
  const legacyObjective =
    typeof legacyNode.objective === "string" ? legacyNode.objective : undefined;
  const objective =
    typeof nodeConfig.objective === "string"
      ? nodeConfig.objective
      : typeof definitionObjective === "string"
        ? definitionObjective
        : typeof legacyObjective === "string"
          ? legacyObjective
        : input.node.title;

  return [
    `Task: ${input.plan.planId}`,
    `Current node: [${input.node.id}] ${input.node.title}`,
    `Objective: ${objective}`,
    completedNodes.length > 0
      ? `Already completed: ${completedNodes.join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function executePlanNode(
  input: NodeExecutorInput,
): Promise<NodeExecutionResult> {
  const { node, sessionDecision, runtimeName } = input;

  // Guard: already done
  if (node.status === "completed" || node.status === "skipped") {
    const nodeConfig = input.node.config as Record<string, unknown>;
    const summary = typeof nodeConfig.completionSummary === "string" ? nodeConfig.completionSummary : `Node ${node.id} was already completed`;
    return { status: "done", summary, evidence: {} };
  }

  switch (sessionDecision.kind) {
    case "wait_for_user":
      return {
        status: "waiting_for_user",
        prompt: `Please provide input for: ${node.title}`,
        reason: sessionDecision.reason,
        evidence: { sessionId: input.mainSession.id },
      };

    case "wait_for_approval":
      return {
        status: "waiting_for_approval",
        prompt: `Please approve: ${node.title}`,
        reason: sessionDecision.reason,
        evidence: { sessionId: input.mainSession.id },
      };

    case "manual_only":
      return {
        status: "blocked",
        reason: sessionDecision.reason,
        evidence: { sessionId: input.mainSession.id },
      };

    case "main_session": {
      const instructions = buildInstructions(input);

      try {
        const started = await startRuntimeRun({
          taskId: input.taskId,
          taskSessionId: input.mainSession.id,
          runtimeName,
          runtimeSessionKey: input.mainSession.sessionKey,
          runtimeInput: {},
          prompt: instructions,
          triggeredBy: "system",
          mode: "require_sync_output",
        });

        if (!started.runStarted) {
          return {
            status: "failed",
            error: `Runtime refused to start main session run for node ${node.id}`,
            evidence: { sessionId: input.mainSession.id, runId: started.runId },
          };
        }

        if (started.status === "Failed") {
          return {
            status: "failed",
            error: `Runtime produced no assistant output for node ${node.id}`,
            evidence: { sessionId: input.mainSession.id, runId: started.runId },
          };
        }

        return {
          status: "done",
          summary: `Started node ${node.id} execution in main session`,
          evidence: {
            sessionId: input.mainSession.id,
            runId: started.runId,
            conversationEntryIds: started.conversationEntryIds,
          },
          output: {
            instructions,
            runId: started.runId,
            runtimeRunRef: started.runtimeRunRef,
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to start main session run";
        return {
          status: "failed",
          error: `Failed to start main session execution for node ${node.id}: ${message}`,
          evidence: { sessionId: input.mainSession.id },
        };
      }
    }

    default:
      return {
        status: "failed",
        error: `Unknown session decision kind: ${(sessionDecision as { kind: string }).kind}`,
      };
  }
}
