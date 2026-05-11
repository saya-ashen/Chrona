import { RunStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { aiClientRegistry } from "@/modules/ai/runtime/client-registry";
import {
  startRuntimeRun,
  type OpenClawResponseClient,
} from "@/modules/task-execution/start-runtime-run";
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
} from "@chrona/contracts/ai";
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
  openClawClient?: OpenClawResponseClient;
};

async function resolveDefaultOpenClawClient() {
  const client = await aiClientRegistry.get();
  if (!client) {
    throw new Error("Default AI client is required");
  }
  return aiClientRegistry.requireOpenClawClient(client).providerClient;
}

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

function buildFailureDetails(input: {
  node: EffectivePlanNode;
  runtimeName: string;
  runtimeRunRef?: string | null;
  runId?: string;
  runtimeSessionKey?: string;
  errorSummary?: string | null;
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
    errorSummary: input.errorSummary ?? null,
    message: input.message,
  };
}

function structuredPayload<T>(input: {
  featureSpec: PreparedAiFeatureSpec;
  response: { structured: unknown; feature?: { payload: unknown } | null };
}): { ok: true; parsed: T } | { ok: false; error: string; validationIssues?: unknown } {
  const structured = input.response.structured as {
    ok?: boolean;
    parsed?: T | null;
    error?: string | null;
    validationIssues?: unknown;
  } | null;
  if (structured?.ok && structured.parsed) {
    return { ok: true, parsed: structured.parsed };
  }
  if (input.response.feature?.payload) {
    return { ok: true, parsed: input.response.feature.payload as T };
  }
  return {
    ok: false,
    error:
      structured?.error ??
      `OpenClaw did not return ${input.featureSpec.requiredTool.name}`,
    validationIssues: structured?.validationIssues,
  };
}

async function runNodeFeature<T>(input: NodeAiCapabilityInput & {
  featureSpec: PreparedAiFeatureSpec;
  prompt: string;
}): Promise<
  | { ok: true; parsed: T; evidence: NodeExecutionEvidence }
  | { ok: false; result: NodeExecutionResult }
> {
  try {
    const client = input.openClawClient ?? (await resolveDefaultOpenClawClient());
    if (!client) {
      throw new Error("Default OpenClaw client is required");
    }

    const started = await startRuntimeRun({
      taskId: input.taskId,
      taskSessionId: input.mainSession.id,
      runtimeName: input.runtimeName,
      runtimeSessionKey: input.mainSession.sessionKey,
      runtimeInput: {},
      prompt: input.prompt,
      featureSpec: input.featureSpec,
      triggeredBy: "system",
      mode: "require_sync_output",
      client,
    });

    const evidence: NodeExecutionEvidence = {
      sessionId: input.mainSession.id,
      runId: started.runId,
      runtimeName: input.runtimeName,
      runtimeRunRef: started.runtimeRunRef,
      conversationEntryIds: started.conversationEntryIds,
    };

    if (!started.runStarted || started.status === RunStatus.Failed) {
      const message = [
        `Runtime failed while executing node ${input.node.id}`,
        started.errorSummary,
      ]
        .filter(Boolean)
        .join(": ");
      return {
        ok: false,
        result: {
          status: "failed",
          error: message,
          evidence,
          details: buildFailureDetails({
            node: input.node,
            runtimeName: input.runtimeName,
            runtimeRunRef: started.runtimeRunRef,
            runId: started.runId,
            runtimeSessionKey: started.runtimeSessionKey,
            errorSummary: started.errorSummary,
            message,
          }),
        },
      };
    }

    const payload = structuredPayload<T>({
      featureSpec: input.featureSpec,
      response: started.response,
    });
    if (!payload.ok) {
      await db.run.update({
        where: { id: started.runId },
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

    return { ok: true, parsed: payload.parsed, evidence };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to run node AI capability";
    const fullMessage = `Failed to execute AI capability for node ${input.node.id}: ${message}`;
    return {
      ok: false,
      result: {
        status: "failed",
        error: fullMessage,
        evidence: { sessionId: input.mainSession.id, runtimeName: input.runtimeName },
        details: buildFailureDetails({
          node: input.node,
          runtimeName: input.runtimeName,
          runtimeSessionKey: input.mainSession.sessionKey,
          errorSummary: message,
          message: fullMessage,
        }),
      },
    };
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
    prompt: featureSpec.inputText ?? instructions,
  });
  if (!result.ok) return result.result;

  switch (result.parsed.outcome) {
    case "completed":
      return {
        status: "done",
        summary: result.parsed.summary,
        output: result.parsed.output,
        evidence: result.evidence,
      };
    case "external_running":
      return {
        status: "started",
        summary: result.parsed.summary,
        output: result.parsed.output,
        evidence: result.evidence,
      };
    case "needs_input":
      return {
        status: "waiting_for_user",
        prompt: result.parsed.prompt ?? result.parsed.reason ?? "Input required",
        reason: result.parsed.reason ?? result.parsed.summary,
        evidence: result.evidence,
      };
    case "blocked":
      return {
        status: "blocked",
        reason: result.parsed.reason ?? result.parsed.summary,
        evidence: result.evidence,
      };
    case "failed":
      return {
        status: "failed",
        error: result.parsed.reason ?? result.parsed.summary,
        evidence: result.evidence,
      };
  }
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
    prompt: featureSpec.inputText ?? instructions,
  });
  if (!result.ok) return result.result;

  const branch = config.branches.find(
    (candidate) => candidate.label === result.parsed.selectedBranchLabel,
  );
  if (!branch) {
    return {
      status: "failed",
      error: `AI selected unknown branch '${result.parsed.selectedBranchLabel}' for node ${input.node.id}`,
      evidence: result.evidence,
      details: { availableBranches: config.branches.map((candidate) => candidate.label) },
    };
  }

  return {
    status: "done",
    summary: `Condition resolved to branch: ${branch.label}`,
    evidence: result.evidence,
    output: { reason: result.parsed.reason, confidence: result.parsed.confidence },
    selectedBranch: {
      label: branch.label,
      nextNodeId: input.plan.nodes.find((node) => node.localId === branch.nextNodeId)?.id ?? branch.nextNodeId,
      source: "ai",
    },
  };
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
    prompt: featureSpec.inputText ?? instructions,
  });
  if (!result.ok) return result.result;

  switch (result.parsed.recommendation) {
    case "approve":
      return {
        status: "done",
        summary: result.parsed.summary,
        output: { reason: result.parsed.reason, recommendation: result.parsed.recommendation },
        evidence: result.evidence,
      };
    case "request_changes":
      return {
        status: "waiting_for_user",
        prompt: result.parsed.reason,
        reason: result.parsed.summary,
        evidence: result.evidence,
      };
    case "block":
      return {
        status: "blocked",
        reason: result.parsed.reason,
        evidence: result.evidence,
      };
  }
}
