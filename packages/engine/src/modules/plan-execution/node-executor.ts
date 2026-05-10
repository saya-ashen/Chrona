import {
  buildNodeExecutionFeatureSpec,
  type ChronaNodeExecutionReturn,
  type EffectivePlanNode,
  type EffectivePlanGraph,
  type PlanPatch,
} from "@chrona/contracts/ai";
import { RunStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { NodeSessionDecision } from "./session-policy";
import {
  startRuntimeRun,
  type OpenClawResponseClient,
} from "@/modules/task-execution/start-runtime-run";
import {
  createOpenClawClient,
  type OpenClawConnectionConfig,
} from "@chrona/openclaw";

type NodeExecutionEvidence = {
  sessionId?: string;
  runId?: string;
  runtimeName?: string;
  runtimeRunRef?: string | null;
  artifactIds?: string[];
  conversationEntryIds?: string[];
  eventIds?: string[];
};

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

export type NodeExecutionResult =
  | {
      status: "started";
      summary: string;
      evidence: NodeExecutionEvidence;
      output?: unknown;
    }
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
  | {
      status: "failed";
      error: string;
      evidence?: NodeExecutionEvidence;
      details?: Record<string, unknown>;
    };

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
  openClawClient?: OpenClawResponseClient;
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

async function loadOpenClawConfig(): Promise<OpenClawConnectionConfig> {
  const client = await db.aiClient.findFirst({
    where: { type: "openclaw", isDefault: true, enabled: true },
  });
  const config = client?.config as Record<string, unknown> | null | undefined;
  const bridgeUrl = typeof config?.bridgeUrl === "string" ? config.bridgeUrl : "";
  const bridgeToken =
    typeof config?.bridgeToken === "string" ? config.bridgeToken : undefined;
  const timeoutSeconds =
    typeof config?.timeoutSeconds === "number" ? config.timeoutSeconds : undefined;
  if (!bridgeUrl.trim()) {
    throw new Error("OpenClaw bridgeUrl is required");
  }
  return { bridgeUrl, bridgeToken, timeoutSeconds };
}

function buildAttemptId(input: NodeExecutorInput): string {
  return `${input.plan.graphId}:${input.node.id}:${input.node.attempts + 1}`;
}

function buildContextSnapshotId(input: NodeExecutorInput): string {
  return `${input.plan.graphId}:${input.plan.resolvedVersion}:${input.node.id}`;
}

function mergeEvidence(input: {
  base: NodeExecutionEvidence;
  returned?: ChronaNodeExecutionReturn["evidence"];
}): NodeExecutionEvidence {
  return {
    ...input.base,
    sessionId: input.returned?.sessionId ?? input.base.sessionId,
    runId: input.returned?.runId ?? input.base.runId,
    artifactIds: input.returned?.artifactIds ?? input.base.artifactIds,
    conversationEntryIds:
      input.returned?.conversationEntryIds ?? input.base.conversationEntryIds,
    eventIds: input.returned?.eventIds ?? input.base.eventIds,
  };
}

function mapStructuredNodeResult(input: {
  returned: ChronaNodeExecutionReturn;
  evidence: NodeExecutionEvidence;
}): NodeExecutionResult {
  const { returned } = input;
  const evidence = mergeEvidence({ base: input.evidence, returned: returned.evidence });
  switch (returned.status) {
    case "completed":
      return {
        status: "done",
        summary: returned.result?.summary ?? returned.ui?.userMessage ?? "Node completed",
        evidence,
        output: returned.result?.outputData,
        selectedBranch: returned.branch,
      };
    case "waiting":
      if (returned.wait?.kind === "approval") {
        return {
          status: "waiting_for_approval",
          prompt: returned.wait.prompt ?? returned.wait.reason,
          reason: returned.wait.reason,
          evidence,
        };
      }
      return {
        status: "waiting_for_user",
        prompt: returned.wait?.prompt ?? returned.wait?.reason ?? "Input required",
        reason: returned.wait?.reason ?? "Input required",
        evidence,
      };
    case "blocked":
      return {
        status: "blocked",
        reason: returned.wait?.reason ?? returned.ui?.userMessage ?? "Node blocked",
        evidence,
      };
    case "replan_required":
      return {
        status: "replan_required",
        reason: returned.replan?.reason ?? "Replan required",
        evidence,
      };
    case "external_running":
      return {
        status: "started",
        summary: returned.result?.summary ?? "External node work started",
        evidence,
        output: returned.result?.outputData,
      };
    case "failed":
      return {
        status: "failed",
        error: returned.error?.message ?? returned.ui?.userMessage ?? "Node execution failed",
        evidence,
        details: returned.error,
      };
  }
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
      const attemptId = buildAttemptId(input);
      const contextSnapshotId = buildContextSnapshotId(input);

      try {
        const client =
          input.openClawClient ??
          (await createOpenClawClient(await loadOpenClawConfig()));
        const featureSpec = buildNodeExecutionFeatureSpec({
          graphId: input.plan.graphId,
          nodeId: node.id,
          nodeLayerId: node.activeLayerId ?? node.id,
          attemptId,
          contextSnapshotId,
          taskId: input.taskId,
          planTitle: input.plan.planId,
          nodeTitle: node.title,
          nodeType: node.type,
          nodeObjective: getNodeObjective(node),
          completedNodeTitles: input.plan.nodes
            .filter((n) => n.status === "completed" || n.status === "skipped")
            .map((n) => n.title),
          instructions,
        });

        const started = await startRuntimeRun({
          taskId: input.taskId,
          taskSessionId: input.mainSession.id,
          runtimeName,
          runtimeSessionKey: input.mainSession.sessionKey,
          runtimeInput: {},
          prompt: featureSpec.inputText ?? instructions,
          triggeredBy: "system",
          mode: "require_sync_output",
          client,
        });

        if (!started.runStarted) {
          const message = [
            `Runtime refused to start main session run for node ${node.id}`,
            started.errorSummary,
          ]
            .filter(Boolean)
            .join(": ");
          return {
            status: "failed",
            error: message,
            evidence: {
              sessionId: input.mainSession.id,
              runId: started.runId,
              runtimeName,
              runtimeRunRef: started.runtimeRunRef,
            },
            details: buildFailureDetails({
              node,
              runtimeName,
              runtimeRunRef: started.runtimeRunRef,
              runId: started.runId,
              runtimeSessionKey: started.runtimeSessionKey,
              errorSummary: started.errorSummary,
              message,
            }),
          };
        }

        if (started.status === "Failed") {
          const message = [
            `Runtime failed while starting main session run for node ${node.id}`,
            started.errorSummary,
          ]
            .filter(Boolean)
            .join(": ");
          return {
            status: "failed",
            error: message,
            evidence: {
              sessionId: input.mainSession.id,
              runId: started.runId,
              runtimeName,
              runtimeRunRef: started.runtimeRunRef,
            },
            details: buildFailureDetails({
              node,
              runtimeName,
              runtimeRunRef: started.runtimeRunRef,
              runId: started.runId,
              runtimeSessionKey: started.runtimeSessionKey,
              errorSummary: started.errorSummary,
              message,
            }),
          };
        }

        const structured = started.response.structured as {
          ok?: boolean;
          parsed?: ChronaNodeExecutionReturn | null;
          error?: string | null;
          validationIssues?: unknown;
        } | null;
        const evidence: NodeExecutionEvidence = {
          sessionId: input.mainSession.id,
          runId: started.runId,
          runtimeName,
          runtimeRunRef: started.runtimeRunRef,
          conversationEntryIds: started.conversationEntryIds,
        };

        if (!structured?.ok || !structured.parsed) {
          const message =
            structured?.error ??
            `OpenClaw did not return ${featureSpec.requiredTool.name}`;
          await db.run.update({
            where: { id: started.runId },
            data: { status: RunStatus.Failed, errorSummary: message },
          });
          return {
            status: "failed",
            error: message,
            evidence,
            details: { validationIssues: structured?.validationIssues },
          };
        }

        return mapStructuredNodeResult({ returned: structured.parsed, evidence });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to start main session run";
        const fullMessage = `Failed to start main session execution for node ${node.id}: ${message}`;
        return {
          status: "failed",
          error: fullMessage,
          evidence: { sessionId: input.mainSession.id, runtimeName },
          details: buildFailureDetails({
            node,
            runtimeName,
            runtimeSessionKey: input.mainSession.sessionKey,
            errorSummary: message,
            message: fullMessage,
          }),
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
