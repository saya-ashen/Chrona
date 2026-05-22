import { RunStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import {
  type EffectivePlanGraph,
  type EffectivePlanNode,
  type PreparedAiFeatureSpec,
} from "@chrona/contracts/ai";
import type { AiRuntimeInvocation, AiRuntimeInvoker } from "./ai-runtime-invoker";
import type { NodeExecutionResult } from "./node-executors/types";
import type { ProviderRunEvent } from "@chrona/providers-foundation";
import { buildNodeRuntimePrompt, NODE_RUNTIME_TERMINAL_TOOLS } from "./node-runtime-prompts";

type NodeExecutionEvidence = NonNullable<
  Extract<NodeExecutionResult, { evidence?: unknown }>["evidence"]
>;

export type NodeAiCapabilityInput = {
  taskId: string;
  mainSession: {
    id: string;
    taskId: string;
    sessionKey: string;
  };
  node: EffectivePlanNode;
  plan: EffectivePlanGraph;
  runtimeName: string;
  aiRuntimeInvoker: AiRuntimeInvoker;
  onRuntimeEvent?: (event: ProviderRunEvent) => Promise<void> | void;
};

function buildFailureDetails(input: {
  node: EffectivePlanNode;
  runtimeName: string;
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
    runtimeRunRef: input.runtimeRunRef ?? null,
    runId: input.runId ?? null,
    runtimeSessionKey: input.runtimeSessionKey ?? null,
    message: input.message,
  };
}

async function runTaskNodeFeature(
  input: NodeAiCapabilityInput & {
    featureSpec: PreparedAiFeatureSpec;
    providerInput: Record<string, unknown>;
  },
): Promise<NodeExecutionResult> {
  try {
    const invocation = await input.aiRuntimeInvoker.invoke({
      taskId: input.taskId,
      taskSessionId: input.mainSession.id,
      runtimeName: input.runtimeName,
      runtimeSessionKey: input.mainSession.sessionKey,
      runtimeInput: input.providerInput,
      instructions: input.featureSpec.instructions,
      featureSpec: input.featureSpec,
      triggeredBy: "system",
      onRuntimeEvent: input.onRuntimeEvent,
    });

    const evidence: NodeExecutionEvidence = {
      sessionId: input.mainSession.id,
      runId: invocation.runId,
      runtimeName: input.runtimeName,
      runtimeRunRef: invocation.runtimeRunRef,
      conversationEntryIds: invocation.conversationEntryIds,
    };

    if (invocation.response.error) {
      const message = `Runtime provider failed while executing node ${input.node.id}: ${invocation.response.error}`;
      return {
        status: "failed",
        error: message,
        evidence,
        details: buildFailureDetails({
          node: input.node,
          runtimeName: input.runtimeName,
          runtimeRunRef: invocation.runtimeRunRef,
          runId: invocation.runId,
          runtimeSessionKey: invocation.runtimeSessionKey,
          message,
        }),
      };
    }

    const nodeResult: NodeExecutionResult = {
      status: "started",
      summary:
        invocation.response.outputText?.trim() ||
        `Runtime run ${invocation.runtimeRunRef ?? invocation.runId} started`,
      evidence,
      output: {
        runtimeRunRef: invocation.runtimeRunRef,
        runtimeName: input.runtimeName,
        provider: invocation.response.provider,
      },
    };
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
      },
      details: buildFailureDetails({
        node: input.node,
        runtimeName: input.runtimeName,
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
  const status = runStatusFromNodeResult(result);
  await db.run.update({
    where: { id: invocation.runId },
    data: {
      status,
      endedAt: status === RunStatus.Completed ? new Date() : null,
      errorSummary: errorSummaryFromNodeResult(result),
    },
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
    default:
      return null;
  }
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
    terminalToolName: NODE_RUNTIME_TERMINAL_TOOLS[input.node.type][0],
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
