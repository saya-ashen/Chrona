import { appendCurrentResult } from "../execution-state";
import { normalizeResultEvidence } from "../evidence";
import type { EffectivePlanNode, NodeAttempt, NodeResult, NodeResultOutput, WaitKind } from "../types";
import type {
  GraphExecutionEvent,
  GraphExecutionState,
  GraphNodeExecutionResult,
} from "./types";

export function appendCapabilityUnavailableResult(input: {
  taskId: string;
  state: GraphExecutionState;
  node: EffectivePlanNode;
  now: number;
}): NodeResult[] {
  return appendCurrentResult({
    results: input.state.results,
    result: {
      id: `result_${input.state.graph.id}_${input.node.id}_${input.now}`,
      taskId: input.taskId,
      graphId: input.state.graph.id,
      nodeId: input.node.id,
      nodeLayerId: input.node.activeLayerId ?? undefined,
      status: "current",
      waitKind: "capability_unavailable",
      error: `No executor for node type: ${input.node.type}`,
    },
  });
}

export function appendExecutionResult(input: {
  taskId: string;
  state: GraphExecutionState;
  node: EffectivePlanNode;
  attempt: NodeAttempt;
  result: GraphNodeExecutionResult;
  now: number;
}): NodeResult[] {
  const base = {
    id: `result_${input.state.graph.id}_${input.node.id}_${input.now}`,
    taskId: input.taskId,
    graphId: input.state.graph.id,
    nodeId: input.node.id,
    nodeLayerId: input.node.activeLayerId ?? undefined,
    attemptId: input.attempt.id,
  } satisfies NodeResult;
  const evidence = normalizeResultEvidence(input.result.evidence);

  switch (input.result.status) {
    case "done":
      return appendCurrentResult({
        results: input.state.results,
        result: {
          ...base,
          status: "current",
          outputSummary: input.result.summary,
          outputs: normalizeResultOutputs(input.result.output),
          inputFields: input.result.inputFields,
          evidence,
          selectedBranch: input.result.selectedBranch,
        },
      });
    case "started":
      return input.state.results;
    case "waiting_for_user":
      return appendCurrentResult({
        results: input.state.results,
        result: {
          ...base,
          status: "current",
          waitKind: "user_input",
          error: input.result.reason,
          actionForm: input.result.actionForm,
          evidence,
        },
      });
    case "waiting_for_approval":
      return appendCurrentResult({
        results: input.state.results,
        result: {
          ...base,
          status: "current",
          waitKind: "approval",
          error: input.result.reason,
          evidence,
          review: { required: true, status: "pending" },
        },
      });
    case "blocked":
      return appendCurrentResult({
        results: input.state.results,
        result: {
          ...base,
          status: "current",
          waitKind: "manual_action",
          error: input.result.reason,
          actionForm: input.result.actionForm,
          evidence,
        },
      });
    case "failed":
      return appendCurrentResult({
        results: input.state.results,
        result: {
          ...base,
          status: "rejected",
          error: input.result.error,
          errorDetails: input.result.details,
          evidence,
        },
      });
    case "replan_required":
      return appendCurrentResult({
        results: input.state.results,
        result: {
          ...base,
          status: "current",
          waitKind: "replan_required",
          error: input.result.reason,
          evidence,
          review: {
            required: true,
            status: "request_changes",
            feedback: input.result.reason,
          },
        },
      });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isNodeResultOutput(value: unknown): value is NodeResultOutput {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  switch (value.kind) {
    case "text":
    case "markdown":
      return typeof value.content === "string";
    case "json":
      return "value" in value;
    case "file":
      return typeof value.path === "string";
    case "artifact":
      return typeof value.artifactId === "string" && typeof value.title === "string";
    case "command":
      return typeof value.command === "string";
    case "link":
      return typeof value.href === "string" && typeof value.title === "string";
    default:
      return false;
  }
}

export function normalizeResultOutputs(output: unknown): NodeResultOutput[] | undefined {
  if (output === undefined || output === null) return undefined;
  if (Array.isArray(output) && output.every(isNodeResultOutput)) return output;
  if (isRecord(output) && Array.isArray(output.outputs) && output.outputs.every(isNodeResultOutput)) {
    return output.outputs;
  }
  if (isNodeResultOutput(output)) return [output];
  if (typeof output === "string") return [{ kind: "text", content: output }];
  return [{ kind: "json", value: output }];
}

export function getPauseKind(result: GraphNodeExecutionResult): WaitKind | null {
  switch (result.status) {
    case "waiting_for_user":
      return "user_input";
    case "waiting_for_approval":
      return "approval";
    case "replan_required":
      return "replan_required";
    case "blocked":
      return "manual_action";
    case "done":
    case "failed":
    case "started":
      return null;
    default:
      return null;
  }
}

export function getResultMessage(result: GraphNodeExecutionResult): string {
  switch (result.status) {
    case "waiting_for_user":
    case "waiting_for_approval":
      return result.prompt;
    case "done":
    case "started":
      return result.summary;
    case "blocked":
    case "replan_required":
      return result.reason;
    case "failed":
      return result.error;
  }
}

export function getEventType(
  result: GraphNodeExecutionResult,
): GraphExecutionEvent["type"] | null {
  switch (result.status) {
    case "done":
      return "node_completed";
    case "waiting_for_user":
      return "node_waiting_for_user";
    case "waiting_for_approval":
      return "node_waiting_for_approval";
    case "blocked":
      return "node_blocked";
    case "replan_required":
      return "replan_proposed";
    case "failed":
    case "started":
      return null;
    default:
      return null;
  }
}
