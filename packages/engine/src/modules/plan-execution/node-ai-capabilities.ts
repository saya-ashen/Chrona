import { RunStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import {
  buildCheckpointNodeReviewFeatureSpec,
  buildConditionNodeEvaluationFeatureSpec,
  buildTaskNodeExecutionFeatureSpec,
  type CheckpointConfig,
  type CheckpointNodeAiResult,
  type ConditionConfig,
  type ConditionNodeAiResult,
  type EffectivePlanGraph,
  type EffectivePlanNode,
  type PreparedAiFeatureSpec,
  type TaskConfig,
  type TaskNodeAiResult,
  validatePreparedFeaturePayload,
} from "@chrona/contracts/ai";
import type { AiRuntimeInvocation, AiRuntimeInvoker } from "./ai-runtime-invoker";
import type { NodeExecutionResult } from "./node-executors/types";

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
};

function completedNodeTitles(plan: EffectivePlanGraph): string[] {
  return plan.nodes
    .filter((node) => node.status === "completed" || node.status === "skipped")
    .map((node) => node.title);
}

function getNodeObjective(node: EffectivePlanNode): string {
  const nodeConfig =
    node.config && typeof node.config === "object"
      ? (node.config as Record<string, unknown>)
      : {};
  const definitionObjective =
    node.definition && typeof node.definition === "object"
      ? node.definition.objective
      : undefined;
  const legacyNode = node as unknown as Record<string, unknown>;
  const legacyObjective =
    typeof legacyNode.objective === "string" ? legacyNode.objective : undefined;
  return typeof nodeConfig.objective === "string"
    ? nodeConfig.objective
    : typeof definitionObjective === "string"
      ? definitionObjective
      : typeof legacyObjective === "string"
        ? legacyObjective
        : node.title;
}

function buildAttemptId(input: NodeAiCapabilityInput): string {
  return `${input.plan.graphId}:${input.node.id}:${input.node.attempts + 1}`;
}

function buildContextSnapshotId(input: NodeAiCapabilityInput): string {
  return `${input.plan.graphId}:${input.plan.resolvedVersion}:${input.node.id}`;
}

function buildInstructions(input: NodeAiCapabilityInput): string {
  return [
    `Task: ${input.plan.planId}`,
    `Current node: [${input.node.id}] ${input.node.title}`,
    `Objective: ${getNodeObjective(input.node)}`,
    completedNodeTitles(input.plan).length > 0
      ? `Already completed: ${completedNodeTitles(input.plan).join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildTaskNodeProviderInput(
  input: NodeAiCapabilityInput,
): Record<string, unknown> {
  const config = input.node.config as TaskConfig;
  return {
    graphId: input.plan.graphId,
    nodeId: input.node.id,
    nodeLayerId: input.node.activeLayerId ?? input.node.id,
    attemptId: buildAttemptId(input),
    contextSnapshotId: buildContextSnapshotId(input),
    taskId: input.taskId,
    planTitle: input.plan.planId,
    nodeTitle: input.node.title,
    nodeObjective: getNodeObjective(input.node),
    expectedOutput: config.expectedOutput,
    completionCriteria: config.completionCriteria,
    completedNodeTitles: completedNodeTitles(input.plan),
  };
}

function buildConditionNodeProviderInput(
  input: NodeAiCapabilityInput,
): Record<string, unknown> {
  const config = input.node.config as ConditionConfig;
  return {
    graphId: input.plan.graphId,
    nodeId: input.node.id,
    nodeLayerId: input.node.activeLayerId ?? input.node.id,
    taskId: input.taskId,
    planTitle: input.plan.planId,
    nodeTitle: input.node.title,
    condition: config.condition,
    branches: config.branches,
    defaultNextNodeId: config.defaultNextNodeId,
    completedNodeTitles: completedNodeTitles(input.plan),
  };
}

function buildCheckpointNodeProviderInput(
  input: NodeAiCapabilityInput,
): Record<string, unknown> {
  const config = input.node.config as CheckpointConfig;
  return {
    graphId: input.plan.graphId,
    nodeId: input.node.id,
    nodeLayerId: input.node.activeLayerId ?? input.node.id,
    taskId: input.taskId,
    planTitle: input.plan.planId,
    nodeTitle: input.node.title,
    checkpointType: config.checkpointType,
    prompt: config.prompt,
    options: config.options,
    completedNodeTitles: completedNodeTitles(input.plan),
  };
}

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

function structuredPayload<T>(input: {
  featureSpec: PreparedAiFeatureSpec;
  response: {
    structured: unknown;
  };
}):
  | { ok: true; parsed: T }
  | { ok: false; error: string; validationIssues?: unknown } {
  const structured = input.response.structured as {
    ok?: boolean;
    parsed?: T | null;
    error?: string | null;
    validationIssues?: unknown;
  } | null;
  const parsedFromStructured = structured?.ok ? structured.parsed : null;
  const parsed = parsedFromStructured;

  if (parsed != null) {
    const validation = validatePreparedFeaturePayload(
      input.featureSpec,
      parsed,
    );
    if (validation.ok) {
      return { ok: true, parsed: parsed as T };
    }
    return {
      ok: false,
      error: validation.error,
      validationIssues: structured?.validationIssues,
    };
  }
  return {
    ok: false,
    error:
      structured?.error ??
      `OpenClaw did not return ${input.featureSpec.structuredOutputSchema.name}`,
    validationIssues: structured?.validationIssues,
  };
}

async function runNodeFeature<T>(
  input: NodeAiCapabilityInput & {
    featureSpec: PreparedAiFeatureSpec;
    providerInput: Record<string, unknown>;
  },
): Promise<
  | {
      ok: true;
      parsed: T;
      evidence: NodeExecutionEvidence;
      invocation: AiRuntimeInvocation;
    }
  | { ok: false; result: NodeExecutionResult }
> {
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
        ok: false,
        result: {
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
        },
      };
    }

    const payload = structuredPayload<T>({
      featureSpec: input.featureSpec,
      response: invocation.response,
    });
    if (!payload.ok) {
      await db.run.update({
        where: { id: invocation.runId },
        data: { status: RunStatus.Failed, errorSummary: payload.error },
      });
      return {
        ok: false,
        result: {
          status: "failed",
          error: payload.error,
          evidence,
          details: { validationIssues: payload.validationIssues },
        },
      };
    }

    return { ok: true, parsed: payload.parsed, evidence, invocation };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to run node AI capability";
    const fullMessage = `Failed to execute AI capability for node ${input.node.id}: ${message}`;
    return {
      ok: false,
      result: {
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
      },
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
  const config = input.node.config as TaskConfig;
  const instructions = buildInstructions(input);
  const featureSpec = buildTaskNodeExecutionFeatureSpec({
    graphId: input.plan.graphId,
    nodeId: input.node.id,
    nodeLayerId: input.node.activeLayerId ?? input.node.id,
    attemptId: buildAttemptId(input),
    contextSnapshotId: buildContextSnapshotId(input),
    taskId: input.taskId,
    planTitle: input.plan.planId,
    nodeTitle: input.node.title,
    nodeObjective: getNodeObjective(input.node),
    expectedOutput: config.expectedOutput,
    completionCriteria: config.completionCriteria,
    completedNodeTitles: completedNodeTitles(input.plan),
    instructions,
  });

  const result = await runNodeFeature<TaskNodeAiResult>({
    ...input,
    featureSpec,
    providerInput: buildTaskNodeProviderInput(input),
  });
  if (!result.ok) return result.result;

  let nodeResult: NodeExecutionResult;
  switch (result.parsed.outcome) {
    case "completed":
      nodeResult = {
        status: "done",
        summary: result.parsed.summary,
        output: result.parsed.output,
        evidence: result.evidence,
      };
      break;
    case "external_running":
      nodeResult = {
        status: "started",
        summary: result.parsed.summary,
        output: result.parsed.output,
        evidence: result.evidence,
      };
      break;
    case "needs_input":
      nodeResult = {
        status: "waiting_for_user",
        prompt:
          result.parsed.prompt ?? result.parsed.reason ?? "Input required",
        reason: result.parsed.reason ?? result.parsed.summary,
        evidence: result.evidence,
      };
      break;
    case "blocked":
      nodeResult = {
        status: "blocked",
        reason: result.parsed.reason ?? result.parsed.summary,
        evidence: result.evidence,
      };
      break;
    case "failed":
      nodeResult = {
        status: "failed",
        error: result.parsed.reason ?? result.parsed.summary,
        evidence: result.evidence,
      };
      break;
  }
  await updateInvocationRunFromNodeResult(result.invocation, nodeResult);
  return nodeResult;
}

export async function evaluateConditionNodeCapability(
  input: NodeAiCapabilityInput,
): Promise<NodeExecutionResult> {
  const config = input.node.config as ConditionConfig;
  const instructions = buildInstructions(input);
  const featureSpec = buildConditionNodeEvaluationFeatureSpec({
    graphId: input.plan.graphId,
    nodeId: input.node.id,
    nodeLayerId: input.node.activeLayerId ?? input.node.id,
    taskId: input.taskId,
    planTitle: input.plan.planId,
    nodeTitle: input.node.title,
    condition: config.condition,
    branches: config.branches,
    defaultNextNodeId: config.defaultNextNodeId,
    completedNodeTitles: completedNodeTitles(input.plan),
    instructions,
  });

  const result = await runNodeFeature<ConditionNodeAiResult>({
    ...input,
    featureSpec,
    providerInput: buildConditionNodeProviderInput(input),
  });
  if (!result.ok) return result.result;

  const branch = config.branches.find(
    (candidate) => candidate.label === result.parsed.selectedBranchLabel,
  );
  if (!branch) {
    const nodeResult: NodeExecutionResult = {
      status: "failed",
      error: `AI selected unknown branch '${result.parsed.selectedBranchLabel}' for node ${input.node.id}`,
      evidence: result.evidence,
      details: {
        availableBranches: config.branches.map((candidate) => candidate.label),
      },
    };
    await updateInvocationRunFromNodeResult(result.invocation, nodeResult);
    return nodeResult;
  }

  const nodeResult: NodeExecutionResult = {
    status: "done",
    summary: `Condition resolved to branch: ${branch.label}`,
    evidence: result.evidence,
    output: {
      reason: result.parsed.reason,
      confidence: result.parsed.confidence,
    },
    selectedBranch: {
      label: branch.label,
      nextNodeId:
        input.plan.nodes.find((node) => node.localId === branch.nextNodeId)
          ?.id ?? branch.nextNodeId,
      source: "ai",
    },
  };
  await updateInvocationRunFromNodeResult(result.invocation, nodeResult);
  return nodeResult;
}

export async function reviewCheckpointNodeCapability(
  input: NodeAiCapabilityInput,
): Promise<NodeExecutionResult> {
  const config = input.node.config as CheckpointConfig;
  const instructions = buildInstructions(input);
  const featureSpec = buildCheckpointNodeReviewFeatureSpec({
    graphId: input.plan.graphId,
    nodeId: input.node.id,
    nodeLayerId: input.node.activeLayerId ?? input.node.id,
    taskId: input.taskId,
    planTitle: input.plan.planId,
    nodeTitle: input.node.title,
    checkpointType: config.checkpointType,
    prompt: config.prompt,
    options: config.options,
    completedNodeTitles: completedNodeTitles(input.plan),
    instructions,
  });

  const result = await runNodeFeature<CheckpointNodeAiResult>({
    ...input,
    featureSpec,
    providerInput: buildCheckpointNodeProviderInput(input),
  });
  if (!result.ok) return result.result;

  let nodeResult: NodeExecutionResult;
  switch (result.parsed.recommendation) {
    case "approve":
      nodeResult = {
        status: "done",
        summary: result.parsed.summary,
        output: {
          reason: result.parsed.reason,
          recommendation: result.parsed.recommendation,
        },
        evidence: result.evidence,
      };
      break;
    case "request_changes":
      nodeResult = {
        status: "waiting_for_user",
        prompt: result.parsed.reason,
        reason: result.parsed.summary,
        evidence: result.evidence,
      };
      break;
    case "block":
      nodeResult = {
        status: "blocked",
        reason: result.parsed.reason,
        evidence: result.evidence,
      };
      break;
  }
  await updateInvocationRunFromNodeResult(result.invocation, nodeResult);
  return nodeResult;
}
