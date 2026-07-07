import { RunStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import {
  type EffectivePlanGraph,
  type EffectivePlanNode,
  type NodeAttempt,
  type PlanOutputState,
  type PreparedAiFeatureSpec,
} from "@chrona/contracts/ai";
import type { AiRuntimeInvocation, AiRuntimeInvoker } from "../ai-runtime-invoker";
import type { NodeExecutionResult } from "../node-executors/types";
import type { ProviderRunEvent, ProviderRunSnapshot } from "@chrona/providers-foundation";
import { buildNodeRuntimePrompt, NODE_RUNTIME_TERMINAL_TOOLS } from "./node-runtime-prompts";
import { branchBindingForRef } from "./node-runtime-refs";
import { syncTaskRunState } from "../persistence/task-execution-store";

type NodeExecutionEvidence = NonNullable<
  Extract<NodeExecutionResult, { evidence?: unknown }>["evidence"]
>;

export type NodeAiCapabilityInput = {
  taskId: string;
  workBlockId?: string | null;
  mainSession: {
    id: string;
    taskId: string;
    sessionKey: string;
  };
  node: EffectivePlanNode;
  plan: EffectivePlanGraph;
  attempt: NodeAttempt;
  planOutput?: PlanOutputState;
  runtimeName: string;
  aiRuntimeInvoker: AiRuntimeInvoker;
  onRuntimeEvent?: (event: ProviderRunEvent) => Promise<void> | void;
  signal?: AbortSignal;
};

function recordValue(input: Record<string, unknown> | undefined, key: string): unknown {
  return input && Object.prototype.hasOwnProperty.call(input, key) ? input[key] : undefined;
}

function structuredPayload(input: AiRuntimeInvocation): Record<string, unknown> | undefined {
  const value = input.response.structuredPayload;
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}


function terminalToolNameFromSnapshot(response: ProviderRunSnapshot): string | undefined {
  const raw = asRecord(response.raw);
  const toolName = recordValue(asRecord(recordValue(raw, "terminalTool")), "name")
    ?? recordValue(asRecord(recordValue(raw, "terminal_tool")), "name")
    ?? recordValue(raw, "terminalToolName")
    ?? recordValue(raw, "terminal_tool_name")
    ?? recordValue(response.structuredPayload && typeof response.structuredPayload === "object"
      ? response.structuredPayload as Record<string, unknown>
      : undefined, "terminalToolName");
  return typeof toolName === "string" && toolName.trim() ? toolName : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function blockedReasonFromSnapshot(input: {
  response: ProviderRunSnapshot;
  structured: Record<string, unknown> | undefined;
  summary?: string;
}) {
  const structuredReason = recordValue(input.structured, "reason");
  if (typeof structuredReason === "string" && structuredReason.trim()) return structuredReason.trim();
  const structuredMessage = recordValue(input.structured, "message");
  if (typeof structuredMessage === "string" && structuredMessage.trim()) return structuredMessage.trim();
  return input.summary || `Runtime run ${input.response.runId} blocked the node`;
}

function failedErrorFromSnapshot(input: {
  response: ProviderRunSnapshot;
  structured: Record<string, unknown> | undefined;
  summary?: string;
}) {
  const structuredError = recordValue(input.structured, "error");
  if (typeof structuredError === "string" && structuredError.trim()) return structuredError.trim();
  const structuredMessage = recordValue(input.structured, "message");
  if (typeof structuredMessage === "string" && structuredMessage.trim()) return structuredMessage.trim();
  return input.summary || `Runtime run ${input.response.runId} failed the node`;
}

function terminalNodeResultFromSnapshot(input: {
  invocation: AiRuntimeInvocation;
  node: EffectivePlanNode;
  plan: EffectivePlanGraph;
  evidence: NodeExecutionEvidence;
  structured: Record<string, unknown> | undefined;
  summary?: string;
}): NodeExecutionResult | undefined {
  const terminalToolName = terminalToolNameFromSnapshot(input.invocation.response);
  switch (terminalToolName) {
    case "chrona_condition_select":
      return conditionSelectionResultFromSnapshot(input);
    case "chrona_node_block":
      return {
        status: "blocked",
        reason: blockedReasonFromSnapshot({
          response: input.invocation.response,
          structured: input.structured,
          summary: input.summary,
        }),
        evidence: input.evidence,
      };
    case "chrona_node_fail":
      return {
        status: "failed",
        error: failedErrorFromSnapshot({
          response: input.invocation.response,
          structured: input.structured,
          summary: input.summary,
        }),
        evidence: input.evidence,
      };
    case "chrona_node_complete":
    case "chrona_wait_complete":
      return {
        status: "done",
        summary:
          input.summary ||
          `Runtime run ${input.invocation.runtimeRunRef ?? input.invocation.runId} completed`,
        evidence: input.evidence,
      };
    case undefined:
      return undefined;
    default:
      return undefined;
  }
}


function missingTerminalToolResult(input: {
  invocation: AiRuntimeInvocation;
  node: EffectivePlanNode;
  evidence: NodeExecutionEvidence;
  summary?: string;
}): NodeExecutionResult {
  const message = `Runtime run ${input.invocation.runtimeRunRef ?? input.invocation.runId} completed without a Chrona terminal result action for node ${input.node.id}`;
  return {
    status: "failed",
    error: input.summary ? `${message}: ${input.summary}` : message,
    evidence: input.evidence,
    details: buildFailureDetails({
      node: input.node,
      runtimeName: input.evidence.runtimeName ?? "unknown",
      runtimeRunRef: input.invocation.runtimeRunRef,
      runId: input.invocation.runId,
      runtimeSessionKey: input.invocation.runtimeSessionKey,
      message,
    }),
  };
}

function conditionSelectionResultFromSnapshot(input: {
  node: EffectivePlanNode;
  plan: EffectivePlanGraph;
  evidence: NodeExecutionEvidence;
  structured: Record<string, unknown> | undefined;
  summary?: string;
}): NodeExecutionResult {
  const branchRef = recordValue(input.structured, "branchRef");
  if (input.node.type !== "condition" || typeof branchRef !== "string" || !branchRef.trim()) {
    return {
      status: "blocked",
      reason: "Condition selection terminal tool completed without a valid branchRef",
      evidence: input.evidence,
    };
  }
  try {
    const branch = branchBindingForRef({
      plan: input.plan,
      node: input.node,
      branchRef: branchRef.trim(),
    });
    return {
      status: "done",
      summary: input.summary || `Condition resolved to branch: ${branch.label}`,
      evidence: input.evidence,
      selectedBranch: {
        label: branch.label,
        nextNodeId: branch.nextNodeId!,
        source: "ai",
      },
    };
  } catch (error) {
    return {
      status: "blocked",
      reason: error instanceof Error ? error.message : "Condition branchRef could not be resolved",
      evidence: input.evidence,
    };
  }
}

function buildFailureDetails(input: {
  node: EffectivePlanNode;
  runtimeName: string;
  provider?: string;
  runtimeRunRef?: string | null;
  runId?: string;
  runtimeSessionKey?: string;
  message: string;
}): Record<string, unknown> {
  return {
    nodeId: input.node.id,
    nodeTitle: input.node.title,
    nodeType: input.node.type,
    nodeStatus: input.node.status,
    runtimeName: input.runtimeName,
    provider: input.provider ?? null,
    runtimeRunRef: input.runtimeRunRef ?? null,
    runId: input.runId ?? null,
    runtimeSessionKey: input.runtimeSessionKey ?? null,
    message: input.message,
  };
}


async function resolveTerminalNodeResult(input: {
  invocation: AiRuntimeInvocation;
  node: EffectivePlanNode;
  plan: EffectivePlanGraph;
  evidence: NodeExecutionEvidence;
  structured: Record<string, unknown> | undefined;
  summary?: string;
}): Promise<NodeExecutionResult | undefined> {
  return terminalNodeResultFromSnapshot({
    invocation: input.invocation,
    node: input.node,
    plan: input.plan,
    evidence: input.evidence,
    structured: input.structured,
    summary: input.summary,
  });
}
export async function runTaskNodeFeature(
  input: NodeAiCapabilityInput & {
    featureSpec: PreparedAiFeatureSpec;
    providerInput: Record<string, unknown>;
  },
): Promise<NodeExecutionResult> {
  try {
    const invocation = await input.aiRuntimeInvoker.invoke({
      taskId: input.taskId,
      workBlockId: input.workBlockId ?? null,
      taskSessionId: input.mainSession.id,
      runtimeName: input.runtimeName,
      runtimeSessionKey: input.mainSession.sessionKey,
      nodeContext: {
        nodeId: input.node.id,
        nodeTitle: input.node.title,
      },
      nodeAttemptId: input.attempt.id,
      nodeAttempt: input.attempt,
      providerRunIdempotencyKey: `provider-run:${input.attempt.idempotencyKey}`,
      runtimeInput: input.providerInput,
      instructions: input.featureSpec.instructions,
      featureSpec: input.featureSpec,
      triggeredBy: "system",
      onRuntimeEvent: input.onRuntimeEvent,
      signal: input.signal,
    });

    const evidence: NodeExecutionEvidence = {
      sessionId: input.mainSession.id,
      runId: invocation.runId,
      runtimeName: input.runtimeName,
      provider: invocation.providerName,
      runtimeRunRef: invocation.runtimeRunRef,
      conversationEntryIds: invocation.conversationEntryIds,
    };

    const structured = structuredPayload(invocation);
    const output = {
      runtimeName: input.runtimeName,
      provider: invocation.providerName,
      outputText: invocation.response.outputText,
      structuredPayload: invocation.response.structuredPayload,
    };
    const structuredSummary = recordValue(structured, "summary");
    const summary = invocation.response.outputText?.trim() ||
      (typeof structuredSummary === "string" ? structuredSummary.trim() : undefined);
    if (invocation.response.status === "cancelled") {
      const message = `Provider cancelled runtime run ${invocation.runtimeRunRef ?? invocation.runId}`;
      const cancelledResult: NodeExecutionResult = {
        status: "failed",
        error: message,
        evidence,
        details: buildFailureDetails({
          node: input.node,
          runtimeName: input.runtimeName,
          provider: invocation.providerName,
          runtimeSessionKey: input.mainSession.sessionKey,
          message,
        }),
      };
      await updateInvocationRunFromNodeResult(invocation, cancelledResult);
      return cancelledResult;
    }

    if (invocation.response.status === "failed") {
      const errorMessage = invocation.response.error
        || `Provider run ${invocation.runtimeRunRef ?? invocation.runId} failed`;
      const failedResult: NodeExecutionResult = {
        status: "failed",
        error: errorMessage,
        evidence,
        details: buildFailureDetails({
          node: input.node,
          runtimeName: input.runtimeName,
          provider: invocation.providerName,
          runtimeSessionKey: input.mainSession.sessionKey,
          message: errorMessage,
        }),
      };
      await updateInvocationRunFromNodeResult(invocation, failedResult);
      return failedResult;
    }

    const requiresTerminalAction = invocation.providerName === "claude_code";
    const terminalNodeResult = invocation.response.status === "completed"
      ? await resolveTerminalNodeResult({
          invocation,
          node: input.node,
          plan: input.plan,
          evidence,
          structured,
          summary,
        })
      : undefined;
    const nodeResult: NodeExecutionResult = terminalNodeResult ?? (invocation.response.status === "completed" && requiresTerminalAction
      ? missingTerminalToolResult({
          invocation,
          node: input.node,
          evidence,
          summary,
        })
      : {
          status: "started",
          summary:
            summary ||
            `Runtime run ${invocation.runtimeRunRef ?? invocation.runId} started`,
          evidence,
          output,
        });
    await updateInvocationRunFromNodeResult(invocation, nodeResult);
    return nodeResult;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to run node AI capability";
    const fullMessage = `Failed to execute AI capability for node ${input.node.id}: ${message}`;
    return {
      status: "failed",
      error: fullMessage,
      evidence: {
        sessionId: input.mainSession.id,
        runtimeName: input.runtimeName,
        provider: "unknown",
      },
      details: buildFailureDetails({
        node: input.node,
        runtimeName: input.runtimeName,
        provider: "unknown",
        runtimeSessionKey: input.mainSession.sessionKey,
        message: fullMessage,
      }),
    };
  }
}

async function updateInvocationRunFromNodeResult(
  invocation: AiRuntimeInvocation,
  result: NodeExecutionResult,
) {
  const status = invocation.response.status === "cancelled" ? RunStatus.Cancelled : runStatusFromNodeResult(result);
  const run = await db.run.update({
    where: { id: invocation.runId },
    data: {
      status,
      endedAt: status === RunStatus.Completed || status === RunStatus.Cancelled ? new Date() : null,
      errorSummary: errorSummaryFromNodeResult(result),
    },
    select: { taskId: true, taskSessionId: true, runtimeRunRef: true },
  });
  await syncTaskRunState({
    taskId: run.taskId,
    taskSessionId: run.taskSessionId,
    runId: invocation.runId,
    runStatus: status,
    runtimeRunRef: run.runtimeRunRef,
  });
}

function runStatusFromNodeResult(result: NodeExecutionResult): RunStatus {
  switch (result.status) {
    case "done":
      return RunStatus.Completed;
    case "started":
      return RunStatus.Running;
    case "waiting_for_user":
      return RunStatus.WaitingForInput;
    case "waiting_for_approval":
      return RunStatus.WaitingForApproval;
    case "blocked":
    case "failed":
    case "replan_required":
      return RunStatus.Failed;
  }
}

function errorSummaryFromNodeResult(result: NodeExecutionResult): string | null {
  switch (result.status) {
    case "failed":
      return result.error;
    case "blocked":
    case "replan_required":
      return result.reason;
    case "waiting_for_user":
    case "waiting_for_approval":
    case "done":
    case "started":
    default:
      return null;
  }
}

function defaultTerminalToolName(nodeType: EffectivePlanNode["type"]): string {
  return nodeType === "task" ? "chrona_node_complete" : NODE_RUNTIME_TERMINAL_TOOLS[nodeType][0];
}

export async function executeTaskNodeCapability(
  input: NodeAiCapabilityInput,
): Promise<NodeExecutionResult> {
  const runtime = buildNodeRuntimePrompt(input);
  const featureSpec: PreparedAiFeatureSpec = {
    feature: input.node.type === "condition"
      ? "evaluate_condition_node"
      : input.node.type === "checkpoint"
        ? "review_checkpoint_node"
        : "execute_task_node",
    instructions: runtime.instructions,
    inputText: JSON.stringify(runtime.runtimeInput, null, 2),
    terminalToolName: defaultTerminalToolName(input.node.type),
  };

  return runTaskNodeFeature({
    ...input,
    featureSpec: {
      ...featureSpec,
      structuredOutputSchema: undefined,
    },
    providerInput: runtime.runtimeInput as unknown as Record<string, unknown>,
  });
}

export async function evaluateConditionNodeCapability(
  input: NodeAiCapabilityInput,
): Promise<NodeExecutionResult> {
  return executeTaskNodeCapability(input);
}

export async function reviewCheckpointNodeCapability(
  input: NodeAiCapabilityInput,
): Promise<NodeExecutionResult> {
  return executeTaskNodeCapability(input);
}
