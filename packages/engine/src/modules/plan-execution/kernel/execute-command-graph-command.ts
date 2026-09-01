import {
  type GraphExecutionState,
  type GraphRuntimeCommand,
  type GraphSubmittedNodeResult,
} from "@chrona/graph-runtime";
import type {
  CheckpointFieldValue,
  CheckpointInputFields,
  EffectivePlanGraph,
  ExecutionCommand,
  ExecutionTrigger,
  NodeDeliverable,
  NodeDeliverableDeclaration,
  SubmittedNodeResult,
} from "@chrona/contracts/ai";
import { branchBindingForRef, buildSemanticRefHistory } from "../runtime/node-runtime-refs";
import type { ExecutionSessionRow } from "../persistence/execution-session-store";
import type { EngineRuntimeContext } from "./kernel-types";

const EVENT_COMMAND_TYPES: Partial<Record<ExecutionCommand["type"], string>> = {
  block_node: "block_current_node",
  fail_node: "fail_current_node",
  cancel: "cancel_session",
  pause: "pause_session",
};

export function eventCommandType(command: ExecutionCommand): string {
  if (command.type === "submit_node_result") {
    return command.result.kind === "done"
      ? "complete_manual_node"
      : `${command.result.kind}_current_node`;
  }
  return EVENT_COMMAND_TYPES[command.type] ?? command.type;
}

function formatInputFieldValue(value: CheckpointFieldValue): string {
  return Array.isArray(value) ? value.join(", ") : String(value);
}

function formatInputFields(fields: CheckpointInputFields): string {
  return Object.entries(fields)
    .map(([key, value]) => `${key}: ${formatInputFieldValue(value)}`)
    .join("\n");
}

function waitingNode(effective: EffectivePlanGraph) {
  return effective.nodes.find((node) => [
    "waiting_for_user",
    "waiting_for_approval",
    "blocked",
  ].includes(node.status));
}

function currentNode(effective: EffectivePlanGraph) {
  return effective.nodes.find((node) => node.status === "running")
    ?? effective.nodes.find((node) => [
      "waiting_for_user",
      "waiting_for_approval",
      "blocked",
      "failed",
    ].includes(node.status));
}

function resolveSubmittedNodeRef(nodeId: string, effective: EffectivePlanGraph): string {
  const direct = effective.nodes.find((node) => node.id === nodeId || node.localId === nodeId);
  if (direct) return direct.id;
  return buildSemanticRefHistory(effective).nodeRefs.find((candidate) => candidate.ref === nodeId)?.nodeId ?? nodeId;
}

function runtimeRunRefFromAttempt(attempt: GraphExecutionState["attempts"][number]): string | null {
  const output = attempt.runtimeSnapshot?.output;
  if (!output || typeof output !== "object") return null;
  const record = output as Record<string, unknown>;
  return typeof record.runtimeRunRef === "string" ? record.runtimeRunRef : null;
}

function exactAttemptForRuntimeRun(state: GraphExecutionState, runtimeRunRef: string) {
  const matches = state.attempts.filter((attempt) => runtimeRunRefFromAttempt(attempt) === runtimeRunRef);
  if (matches.length !== 1) return null;
  const [attempt] = matches;
  return attempt.status === "running" ? attempt : null;
}

function exactCurrentAttemptForNode(state: GraphExecutionState, nodeId: string) {
  const currentResult = [...state.results].reverse().find(
    (result) => result.nodeId === nodeId && result.status === "current",
  );
  return [...state.attempts].reverse().find(
    (attempt) =>
      attempt.nodeId === nodeId &&
      (attempt.status === "running" || (currentResult?.attemptId === attempt.id && currentResult.waitKind)),
  ) ?? null;
}

export function resolveSubmitAttempt(
  command: Extract<ExecutionCommand, { type: "submit_node_result" }>,
  state: GraphExecutionState,
  effective: EffectivePlanGraph,
) {
  if (command.expectedAttemptId) {
    const nodeId = command.nodeId ? resolveSubmittedNodeRef(command.nodeId, effective) : undefined;
    const attempt = state.attempts.find((candidate) => candidate.id === command.expectedAttemptId) ?? null;
    if (!attempt || (nodeId && attempt.nodeId !== nodeId)) return null;
    if (command.runtimeRunRef && runtimeRunRefFromAttempt(attempt) !== command.runtimeRunRef) return null;
    return attempt;
  }
  if (command.runtimeRunRef) return exactAttemptForRuntimeRun(state, command.runtimeRunRef);
  return null;
}


function withSubmissionIdentity<T extends GraphSubmittedNodeResult>(
  result: T,
  command: Pick<Extract<ExecutionCommand, { type: "submit_node_result" }>, "expectedAttemptId" | "runtimeRunRef" | "providerRunId">,
  attemptId: string,
): T {
  return {
    ...result,
    expectedAttemptId: attemptId,
    ...(command.runtimeRunRef ?? result.evidence?.runtimeRunRef ? { runtimeRunRef: command.runtimeRunRef ?? result.evidence?.runtimeRunRef } : {}),
    ...(command.providerRunId ? { providerRunId: command.providerRunId } : {}),
  };
}

function withDirectCommandIdentity<T extends GraphSubmittedNodeResult>(result: T, state: GraphExecutionState): T {
  const attempt = exactCurrentAttemptForNode(state, result.nodeId);
  return attempt ? { ...result, expectedAttemptId: attempt.id } : result;
}

export function isDeliverableDeclaration(
  deliverable: NodeDeliverableDeclaration | NodeDeliverable,
): deliverable is NodeDeliverableDeclaration {
  return "source" in deliverable;
}

function resolveSelectedBranch(
  nodeId: string,
  result: Extract<SubmittedNodeResult, { kind: "done" }>,
  effective?: EffectivePlanGraph,
) {
  if (result.selectedBranch || !result.branchRef || !effective) return result.selectedBranch;
  const conditionNode = effective.nodes.find((node) => node.id === nodeId);
  if (!conditionNode) return undefined;
  const binding = branchBindingForRef({ plan: effective, node: conditionNode, branchRef: result.branchRef });
  return { ref: binding.ref, label: binding.label, nextNodeId: binding.nextNodeId!, source: "ai" as const };
}

function doneNodeResult(
  nodeId: string,
  result: Extract<SubmittedNodeResult, { kind: "done" }>,
  effective?: EffectivePlanGraph,
): GraphSubmittedNodeResult {
  const deliverables = result.deliverables?.filter((deliverable): deliverable is NodeDeliverable =>
    !isDeliverableDeclaration(deliverable));
  return {
    nodeId,
    status: "done",
    summary: result.summary ?? "",
    evidence: result.evidence,
    output: result.output,
    inputFields: result.inputFields,
    selectedBranch: resolveSelectedBranch(nodeId, result, effective),
    deliverables,
    findings: result.findings,
    decisions: result.decisions,
    caveats: result.caveats,
    nextActions: result.nextActions,
    resultEvidence: result.resultEvidence,
  };
}

export function toSubmittedNodeResult(
  nodeId: string,
  result: SubmittedNodeResult,
  effective?: EffectivePlanGraph,
): GraphSubmittedNodeResult {
  if (result.kind === "done") return doneNodeResult(nodeId, result, effective);
  if (result.kind === "failed") return { nodeId, status: "failed", error: result.error, evidence: result.evidence };
  if (result.kind === "blocked") {
    return { nodeId, status: "blocked", reason: result.reason, actionForm: result.actionForm, evidence: result.evidence };
  }
  return { nodeId, status: "cancelled", reason: result.reason, evidence: result.evidence };
}

type GraphCommandInput = {
  command: ExecutionCommand;
  state: GraphExecutionState;
  effective: EffectivePlanGraph;
  session: ExecutionSessionRow;
  engineContext: EngineRuntimeContext;
  trigger: ExecutionTrigger;
};

type GraphCommandBase = Pick<GraphCommandInput, "state" | "trigger"> & { context: EngineRuntimeContext };

function graphCommandBase(input: GraphCommandInput): GraphCommandBase {
  return { state: input.state, trigger: input.trigger, context: input.engineContext };
}

function inputResumeCommand(input: GraphCommandInput): GraphRuntimeCommand | null {
  const { command, effective, session } = input;
  if (command.type !== "resume_with_input") return null;
  const nodeId = command.nodeId ?? session.currentNodeId ?? waitingNode(effective)?.id;
  if (!nodeId) return null;
  return {
    type: "resume_with_input",
    ...graphCommandBase(input),
    input: { nodeId, value: formatInputFields(command.inputFields), fields: command.inputFields, replaceStatus: "obsolete" },
  };
}

function approvalResumeCommand(input: GraphCommandInput): GraphRuntimeCommand | null {
  const { command, effective, session } = input;
  if (command.type !== "resume_with_approval") return null;
  const nodeId = command.nodeId ?? session.currentNodeId
    ?? effective.nodes.find((node) => node.status === "waiting_for_approval")?.id;
  if (!nodeId) return null;
  return {
    type: "resume_with_approval",
    ...graphCommandBase(input),
    input: { nodeId, approved: command.approved, feedback: command.feedback, userInput: command.feedback },
  };
}

function resultCommand(input: GraphCommandInput): GraphRuntimeCommand | null {
  const { command, state, effective } = input;
  if (command.type === "submit_node_result") {
    const attempt = resolveSubmitAttempt(command, state, effective);
    if (!attempt) return null;
    return {
      type: "submit_node_result",
      ...graphCommandBase(input),
      nodeResult: withSubmissionIdentity(
        toSubmittedNodeResult(attempt.nodeId, command.result, effective),
        command,
        attempt.id,
      ),
      continueExecution: command.continueExecution ?? true,
    };
  }
  if (command.type !== "fail_node" && command.type !== "block_node") return null;
  const nodeId = command.nodeId ?? currentNode(effective)?.id;
  if (!nodeId) return null;
  if (command.type === "fail_node") {
    return {
      type: "submit_node_result",
      ...graphCommandBase(input),
      nodeResult: withDirectCommandIdentity({ nodeId, status: "failed", error: command.error }, state),
    };
  }
  return {
    type: "submit_node_result",
    ...graphCommandBase(input),
    nodeResult: withDirectCommandIdentity({ nodeId, status: "blocked", reason: command.reason, actionForm: command.actionForm }, state),
  };
}

function startGraphCommand(input: GraphCommandInput): GraphRuntimeCommand | null {
  if (input.command.type !== "start" && input.command.type !== "restart_from_beginning") return null;
  return { type: "start", ...graphCommandBase(input) };
}

function unblockGraphCommand(input: GraphCommandInput): GraphRuntimeCommand | null {
  if (input.command.type !== "resume_after_unblock") return null;
  const { command, effective } = input;
  return {
    type: "resume_after_unblock",
    ...graphCommandBase(input),
    nodeId: command.nodeId ?? effective.nodes.find((node) => node.ready)?.id ?? waitingNode(effective)?.id,
  };
}

function directGraphCommand(input: GraphCommandInput): GraphRuntimeCommand | null {
  const { command } = input;
  const base = graphCommandBase(input);
  if (command.type === "retry_node") {
    return { type: "retry_node", ...base, nodeId: command.nodeId, reason: command.reason, userInput: command.userInput };
  }
  if (command.type === "pause") return { type: "pause_session", ...base, reason: command.reason };
  if (command.type === "cancel") return { type: "cancel_session", ...base, reason: command.reason };
  if (command.type === "apply_mutation") {
    return { type: "apply_mutation", ...base, mutation: { operations: command.operations, reason: command.reason, invalidateDownstream: command.invalidateDownstream } };
  }
  return null;
}

export function buildGraphCommand(input: GraphCommandInput): GraphRuntimeCommand | null {
  return startGraphCommand(input)
    ?? inputResumeCommand(input)
    ?? approvalResumeCommand(input)
    ?? unblockGraphCommand(input)
    ?? resultCommand(input)
    ?? directGraphCommand(input);
}
