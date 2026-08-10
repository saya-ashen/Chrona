import { resolveEffectivePlanGraph } from "../resolve";
import { validatePlanGraph } from "../validation";
import type { GraphDispatchOutcome, GraphRuntimeCommand } from "./types";
import type { GraphExecutionState } from "../types/dispatch-core";
import type { GraphExecutionEvent } from "../types/events";

function validationFailureOutcome(input: {
  command: GraphRuntimeCommand;
  state: GraphExecutionState;
  events: GraphExecutionEvent[];
  issues: string[];
}): GraphDispatchOutcome {
  return {
    status: "blocked",
    currentNodeId: null,
    executedNodeIds: [],
    effective: resolveEffectivePlanGraph(input.state),
    state: input.state,
    events: [
      ...input.events,
      {
        type: "command_validation_failed",
        command: input.command,
        issues: input.issues,
      },
    ],
    message: `Graph validation failed: ${input.issues.join("; ")}`,
  };
}

export function validateCommandGraphState(input: {
  command: GraphRuntimeCommand;
  state: GraphExecutionState;
  events: GraphExecutionEvent[];
}): GraphDispatchOutcome | null {
  const result = validatePlanGraph(input.state.graph);
  const errors = result.issues.filter((issue) => issue.severity === "error");
  if (errors.length === 0) {
    return null;
  }

  return validationFailureOutcome({
    command: input.command,
    state: input.state,
    events: input.events,
    issues: errors.map((issue) => `${issue.code}: ${issue.message}`),
  });
}
