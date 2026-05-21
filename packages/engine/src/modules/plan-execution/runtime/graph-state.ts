import type { GraphExecutionState } from "@chrona/graph-runtime";
import type { PersistedPlanRun } from "../persistence/plan-runtime-store";

export function toGraphExecutionState(
  persisted: PersistedPlanRun,
): GraphExecutionState {
  if (!persisted.graph) {
    throw new Error("Plan runtime graph missing");
  }

  return {
    graph: structuredClone(persisted.graph),
    attempts: structuredClone(persisted.attempts),
    results: structuredClone(persisted.results),
    executionContextSnapshots: structuredClone(
      persisted.executionContextSnapshots,
    ),
  } as GraphExecutionState;
}
