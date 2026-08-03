import { z } from "zod";
import { latestRecordedTerminalAction } from "./agent-control-store";
import { submitNodeResultActionFromControl } from "@/modules/agent-tools/node-result-action";
import {
  type CheckpointInputFields,
  type EffectivePlanGraph,
  type EffectivePlanNode,
  type NodeAttempt,
  type PlanOutputState,
} from "@chrona/contracts/ai";
import { agentControlActionBodySchema } from "@chrona/contracts/api";
import { usesChronaControlPlane, type AiRuntimeInvocation, type AiRuntimeInvoker } from "../ai-runtime-invoker";
import type { NodeExecutionPlanContext, NodeExecutionResult, NodeExecutionRunContext } from "../node-executors/types";
import type { ProviderJsonValue, ProviderRunEvent, ProviderRunSnapshot } from "@chrona/providers-foundation";
import { buildNodeRuntimePrompt, NODE_RUNTIME_TERMINAL_TOOLS } from "./node-runtime-prompts";
import { branchBindingForRef } from "./node-runtime-refs";

type NodeExecutionEvidence = NonNullable<
  Extract<NodeExecutionResult, { evidence?: unknown }>["evidence"]
>;
const providerJsonValueSchema: z.ZodType<ProviderJsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(providerJsonValueSchema),
    z.record(z.string(), providerJsonValueSchema),
  ]),
);
const nodeCapabilityKindSchema = z.enum(["execute", "evaluate", "review"]);
const nodeCapabilityRequestSchema = z.object({
  protocolVersion: z.literal(1),
  kind: nodeCapabilityKindSchema,
  clientOperationId: z.string().trim().min(1).max(512),
  instructions: z.string().trim().min(1).max(100_000),
  runtimeInput: z.record(z.string(), providerJsonValueSchema),
  terminalToolName: z.string().trim().min(1).max(128),
}).strict();
const nodeCapabilityResponseSchema = z.object({
  status: z.enum(["pending", "running", "completed", "failed", "cancelled"]),
  runId: z.string().trim().min(1).max(512),
  outputText: z.string().nullable().optional(),
  provider: z.string().trim().min(1).max(128),
  structuredPayload: providerJsonValueSchema.optional(),
  terminalTool: z.object({
    name: z.string().trim().min(1).max(128),
    input: z.record(z.string(), providerJsonValueSchema),
  }).optional(),
  error: z.string().nullable().optional(),
}).strict();
export type NodeCapabilityRequest = z.infer<typeof nodeCapabilityRequestSchema>;
type NodeCapabilityResponse = z.infer<typeof nodeCapabilityResponseSchema>;
type NodeRuntimePrompt = {
  instructions: string;
  runtimeInput: Record<string, ProviderJsonValue>;
};

function nodeCapabilityRequest(input: {
  kind: z.infer<typeof nodeCapabilityKindSchema>;
  attempt: NodeAttempt;
  runtime: NodeRuntimePrompt;
  node: EffectivePlanNode;
}): NodeCapabilityRequest {
  return nodeCapabilityRequestSchema.parse({
    protocolVersion: 1,
    kind: input.kind,
    clientOperationId: `node-capability:${input.kind}:${input.attempt.idempotencyKey}`,
    instructions: input.runtime.instructions,
    runtimeInput: input.runtime.runtimeInput,
    terminalToolName: defaultTerminalToolName(input.node.type),
  });
}

function nodeCapabilityResponse(response: ProviderRunSnapshot): NodeCapabilityResponse {
  const raw = providerJsonValueSchema.safeParse(response.raw);
  const structuredPayload = providerJsonValueSchema.safeParse(
    response.structuredPayload,
  );
  const rawRecord = raw.success ? asRecord(raw.data) : undefined;
  const terminal = asRecord(recordValue(rawRecord, "terminalTool"))
    ?? asRecord(recordValue(rawRecord, "terminal_tool"));
  const name = recordValue(terminal, "name")
    ?? recordValue(rawRecord, "terminalToolName")
    ?? recordValue(rawRecord, "terminal_tool_name")
    ?? recordValue(
      asRecord(structuredPayload.success ? structuredPayload.data : undefined),
      "terminalToolName",
    );
  return nodeCapabilityResponseSchema.parse({
    provider: response.provider,
    status: response.status,
    runId: response.runId,
    outputText: response.outputText,
    structuredPayload: structuredPayload.success ? structuredPayload.data : undefined,
    terminalTool: typeof name === "string" && name.trim()
      ? { name: name.trim(), input: asRecord(recordValue(terminal, "input")) ?? {} }
      : undefined,
    error: response.error,
  });
}

export const __nodeAiCapabilityTestHooks = {
  parseRequest: (value: unknown) => nodeCapabilityRequestSchema.parse(value),
  parseResponse: (value: unknown) => nodeCapabilityResponseSchema.parse(value),
};
export type NodeAiCapabilityInput = {
  taskId: string;
  executionEpoch?: number;
  executionSessionId?: string;
  workBlockId?: string | null;
  mainSession: {
    id: string;
    taskId: string;
    sessionKey: string;
  };
  node: EffectivePlanNode;
  plan: EffectivePlanGraph;
  planContext?: NodeExecutionPlanContext;
  runContext?: NodeExecutionRunContext;
  userInput?: string;
  inputFields?: CheckpointInputFields;
  attempt: NodeAttempt;
  planOutput?: PlanOutputState;
  runtimeName: string;
  aiRuntimeInvoker: AiRuntimeInvoker;
  onRuntimeEvent?: (event: ProviderRunEvent) => Promise<void> | void;
  signal?: AbortSignal;
};

function recordValue(
  input: Record<string, ProviderJsonValue> | undefined,
  key: string,
): ProviderJsonValue | undefined {
  return input && Object.prototype.hasOwnProperty.call(input, key)
    ? input[key]
    : undefined;
}
function structuredPayload(
  response: NodeCapabilityResponse,
): Record<string, ProviderJsonValue> | undefined {
  return asRecord(response.structuredPayload);
}


function terminalToolNameFromSnapshot(
  response: NodeCapabilityResponse,
): string | undefined {
  return response.terminalTool?.name;
}

function terminalToolInputFromSnapshot(
  response: NodeCapabilityResponse,
): Record<string, ProviderJsonValue> {
  return response.terminalTool?.input ?? {};
}

function asRecord(
  value: ProviderJsonValue | undefined,
): Record<string, ProviderJsonValue> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

function requiresAiDefinedInput(node: EffectivePlanNode) {
  if (node.type !== "checkpoint") return false;
  const config = node.config as { required?: boolean; interaction?: { schemaSource?: string } };
  return config.required !== false && config.interaction?.schemaSource === "ai";
}


function blockedReasonFromSnapshot(input: {
  response: ProviderRunSnapshot;
  structured: Record<string, ProviderJsonValue> | undefined;
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
  structured: Record<string, ProviderJsonValue> | undefined;
  summary?: string;
}) {
  const structuredError = recordValue(input.structured, "error");
  if (typeof structuredError === "string" && structuredError.trim()) return structuredError.trim();
  const structuredMessage = recordValue(input.structured, "message");
  if (typeof structuredMessage === "string" && structuredMessage.trim()) return structuredMessage.trim();
  return input.summary || `Runtime run ${input.response.runId} failed the node`;
}

function completionOverrideFromStructured(input: {
  response: ProviderRunSnapshot;
  structured: Record<string, ProviderJsonValue> | undefined;
  summary?: string;
  evidence: NodeExecutionEvidence;
}): NodeExecutionResult | null {
  const completed = recordValue(input.structured, "completed");
  const status = recordValue(input.structured, "status");
  if (completed === false || status === "failed" || status === "error") {
    return {
      status: "failed",
      error: failedErrorFromSnapshot(input),
      evidence: input.evidence,
    };
  }
  if (status === "blocked") {
    return {
      status: "blocked",
      reason: blockedReasonFromSnapshot(input),
      evidence: input.evidence,
    };
  }
  return null;
}

function terminalNodeResultFromSnapshot(input: {
  invocation: AiRuntimeInvocation;
  node: EffectivePlanNode;
  plan: EffectivePlanGraph;
  evidence: NodeExecutionEvidence;
  structured: Record<string, ProviderJsonValue> | undefined;
  summary?: string;
  inputFields?: CheckpointInputFields;
}): NodeExecutionResult | undefined {
  const terminalToolName = terminalToolNameFromSnapshot(
    nodeCapabilityResponse(input.invocation.response),
  );
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
    case "chrona_wait_complete": {
      const override = completionOverrideFromStructured({
        response: input.invocation.response,
        structured: input.structured,
        summary: input.summary,
        evidence: input.evidence,
      });
      if (override) return override;
      if (requiresAiDefinedInput(input.node)) {
        return {
          status: "failed",
          error: `Required AI-defined checkpoint ${input.node.id} completed without chrona_node_request_input`,
          evidence: input.evidence,
        };
      }
      const terminalInput = terminalToolInputFromSnapshot(
        nodeCapabilityResponse(input.invocation.response),
      );
      return {
        status: "done",
        summary:
          (typeof terminalInput.summary === "string" ? terminalInput.summary.trim() : "") ||
          input.summary ||
          `Runtime run ${input.invocation.runtimeRunRef ?? input.invocation.runId} completed`,
        evidence: input.evidence,
        inputFields: input.inputFields,
      };
    }
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
  structured: Record<string, ProviderJsonValue> | undefined;
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
  structured: Record<string, ProviderJsonValue> | undefined;
  summary?: string;
  inputFields?: CheckpointInputFields;
}): Promise<NodeExecutionResult | undefined> {
  return terminalNodeResultFromSnapshot({
    invocation: input.invocation,
    node: input.node,
    plan: input.plan,
    evidence: input.evidence,
    structured: input.structured,
    summary: input.summary,
    inputFields: input.inputFields,
  });
}
export async function runTaskNodeFeature(
  input: NodeAiCapabilityInput & { request: NodeCapabilityRequest },
): Promise<NodeExecutionResult> {
  try {
    const request = nodeCapabilityRequestSchema.parse(input.request);
    const invocation = await input.aiRuntimeInvoker.invoke({
      taskId: input.taskId,
      expectedExecutionEpoch: input.executionEpoch ?? -1,
      expectedExecutionSessionId: input.executionSessionId ?? "",
      workBlockId: input.workBlockId ?? null,
      taskSessionId: input.mainSession.id,
      runtimeName: input.runtimeName,
      runtimeSessionKey: input.mainSession.sessionKey,
      nodeContext: {
        nodeId: input.node.id,
        nodeTitle: input.node.title,
      },
      nodeAttempt: input.attempt,
      clientOperationId: request.clientOperationId,
      runtimeInput: request.runtimeInput,
      instructions: request.instructions,
      terminalToolName: request.terminalToolName,
      toolPolicy: "full",
      onRuntimeEvent: input.onRuntimeEvent,
      signal: input.signal,
    });
    const response = nodeCapabilityResponse(invocation.response);

    const evidence: NodeExecutionEvidence = {
      sessionId: input.mainSession.id,
      runId: invocation.runId,
      runtimeName: input.runtimeName,
      provider: invocation.providerName,
      runtimeRunRef: invocation.runtimeRunRef,
      conversationEntryIds: invocation.conversationEntryIds,
    };

    const recordedTerminalAction = await latestRecordedTerminalAction({
      runId: invocation.runId,
      nodeAttemptId: input.attempt.id,
    });
    if (recordedTerminalAction) {
      const parsedAction = agentControlActionBodySchema.parse({
        kind: recordedTerminalAction.kind,
        payload: recordedTerminalAction.payload,
      });
      const recordedActionWithSession = submitNodeResultActionFromControl({
        body: parsedAction,
        sessionId: input.mainSession.id,
      });
      const recordedAction = recordedActionWithSession
        ? (({ sessionId: _sessionId, ...action }) => action)(recordedActionWithSession)
        : null;
      if (recordedAction?.action === "complete_manual_node") {
        const selectedBranch = recordedAction.branchRef
          ? branchBindingForRef({ plan: input.plan, node: input.node, branchRef: recordedAction.branchRef })
          : null;
        if (requiresAiDefinedInput(input.node)) {
          const protocolFailure: NodeExecutionResult = {
            status: "failed",
            error: `Required AI-defined checkpoint ${input.node.id} completed without chrona_node_request_input`,
            evidence,
          };
          return protocolFailure;
        }
        const completedResult: NodeExecutionResult = {
          status: "done",
          summary: recordedAction.summary ?? "Node completed",
          evidence,
          output: recordedAction.output,
          inputFields: input.inputFields,
          selectedBranch: selectedBranch
            ? { label: selectedBranch.label, nextNodeId: selectedBranch.nextNodeId!, source: "ai" }
            : undefined,
          deliverables: recordedAction.deliverables,
          findings: recordedAction.findings,
          decisions: recordedAction.decisions,
          caveats: recordedAction.caveats,
          nextActions: recordedAction.nextActions,
          resultEvidence: recordedAction.evidenceItems?.map((item) => ({
            ...item,
            sourceNodeRef: "",
          })),
        };
        return completedResult;
      }
      if (parsedAction.kind === "request_input" && recordedAction?.action === "block_current_node") {
        const waitingResult: NodeExecutionResult = {
          status: "waiting_for_user",
          prompt: parsedAction.payload.title,
          reason: parsedAction.payload.instructions,
          evidence,
          actionForm: recordedAction.actionForm,
        };
        return waitingResult;
      }
      if (recordedAction?.action === "block_current_node") {
        const blockedResult: NodeExecutionResult = {
          status: "blocked",
          reason: recordedAction.reason,
          evidence,
        };
        return blockedResult;
      }
      if (recordedAction?.action === "fail_current_node") {
        const failedResult: NodeExecutionResult = {
          status: "failed",
          error: recordedAction.error,
          evidence,
        };
        return failedResult;
      }
    }

    const structured = structuredPayload(response);
    const output = {
      runtimeName: input.runtimeName,
      provider: invocation.providerName,
      outputText: response.outputText ?? undefined,
      structuredPayload: response.structuredPayload,
    };
    const structuredSummary = recordValue(structured, "summary");
    const summary = response.outputText?.trim() ||
      (typeof structuredSummary === "string" ? structuredSummary.trim() : undefined);
    if (response.status === "cancelled") {
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
      return cancelledResult;
    }

    if (response.status === "failed") {
      const errorMessage = response.error
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
      return failedResult;
    }

    const requiresTerminalAction = usesChronaControlPlane(invocation.providerName);
    const terminalNodeResult = response.status === "completed"
      ? await resolveTerminalNodeResult({
          invocation: {
            ...invocation,
            response: {
              ...invocation.response,
              ...response,
              outputText: response.outputText ?? undefined,
            },
          },
          node: input.node,
          plan: input.plan,
          evidence,
          structured,
          summary,
          inputFields: input.inputFields,
        })
      : undefined;
    const nodeResult: NodeExecutionResult = terminalNodeResult ?? (response.status === "completed" && requiresTerminalAction
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




function defaultTerminalToolName(nodeType: EffectivePlanNode["type"]): string {
  return nodeType === "task" ? "chrona_node_complete" : NODE_RUNTIME_TERMINAL_TOOLS[nodeType][0];
}

async function runNodeCapability(
  input: NodeAiCapabilityInput,
  kind: z.infer<typeof nodeCapabilityKindSchema>,
): Promise<NodeExecutionResult> {
  const runtime = buildNodeRuntimePrompt({
    plan: input.plan,
    node: input.node,
    planOutput: input.planOutput,
    planContext: input.planContext,
    runContext: input.runContext,
    userInput: input.userInput,
    inputFields: input.inputFields,
  });
  return runTaskNodeFeature({
    ...input,
    request: nodeCapabilityRequest({
      kind,
      attempt: input.attempt,
      runtime: {
        instructions: runtime.instructions,
        runtimeInput: z.record(z.string(), providerJsonValueSchema).parse(
          JSON.parse(JSON.stringify(runtime.runtimeInput)),
        ),
      },
      node: input.node,
    }),
  });
}

export async function executeTaskNodeCapability(input: NodeAiCapabilityInput): Promise<NodeExecutionResult> {
  return runNodeCapability(input, "execute");
}

export async function evaluateConditionNodeCapability(input: NodeAiCapabilityInput): Promise<NodeExecutionResult> {
  if (input.node.type !== "condition") {
    throw new Error(`Condition capability requires a condition node, received ${input.node.type}`);
  }
  return runNodeCapability(input, "evaluate");
}

export async function reviewCheckpointNodeCapability(input: NodeAiCapabilityInput): Promise<NodeExecutionResult> {
  if (input.node.type !== "checkpoint") {
    throw new Error(`Checkpoint capability requires a checkpoint node, received ${input.node.type}`);
  }
  return runNodeCapability(input, "review");
}
