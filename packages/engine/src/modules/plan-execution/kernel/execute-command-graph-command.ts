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

function resolveRuntimeResultNodeId(state: GraphExecutionState, runtimeRunRef: string): string | null {
  const result = state.results.find((candidate) => candidate.evidence?.runtimeRunRef === runtimeRunRef);
  if (result?.nodeId) return result.nodeId;
  return [...state.attempts].reverse().find((attempt) => attempt.status === "running")?.nodeId ?? null;
}

function resolveSubmitNodeId(
  command: Extract<ExecutionCommand, { type: "submit_node_result" }>,
  state: GraphExecutionState,
  effective: EffectivePlanGraph,
): string | null {
  if (command.nodeId) return resolveSubmittedNodeRef(command.nodeId, effective);
  if (command.runtimeRunRef) return resolveRuntimeResultNodeId(state, command.runtimeRunRef);
  return effective.nodes.find((node) => node.status === "running")?.id
    ?? waitingNode(effective)?.id
    ?? effective.readyNodeIds[0];
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
  try {
    const binding = branchBindingForRef({ plan: effective, node: conditionNode, branchRef: result.branchRef });
    return { ref: binding.ref, label: binding.label, nextNodeId: binding.nextNodeId!, source: "ai" as const };
  } catch {
    return undefined;
  }
}

function doneNodeResult(
  nodeId: string,
  result: Extract<SubmittedNodeResult, { kind: "done" }>,
  effective?: EffectivePlanGraph,
): GraphSubmittedNodeResult {
  const deliverables = result.deliverables?.filter((deliverable): deliverable is NodeDeliverable =>
    !isDeliverableDeclaration(deliverable));
  if (deliverables?.length !== result.deliverables?.length) {
    throw new Error("Node result deliverables must be registered before graph submission");
  }
  return {
    nodeId,
    status: "done",
    summary: result.summary ?? "",
    evidence: result.evidence,
    output: result.output,
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
    const nodeId = resolveSubmitNodeId(command, state, effective);
    if (!nodeId) return null;
    return {
      type: "submit_node_result",
      ...graphCommandBase(input),
      nodeResult: toSubmittedNodeResult(nodeId, command.result, effective),
      continueExecution: command.continueExecution ?? true,
    };
  }
  if (command.type !== "fail_node" && command.type !== "block_node") return null;
  const nodeId = command.nodeId ?? currentNode(effective)?.id;
  if (!nodeId) return null;
  if (command.type === "fail_node") {
    return { type: "submit_node_result", ...graphCommandBase(input), nodeResult: { nodeId, status: "failed", error: command.error } };
  }
  return {
    type: "submit_node_result",
    ...graphCommandBase(input),
    nodeResult: { nodeId, status: "blocked", reason: command.reason, actionForm: command.actionForm },
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
