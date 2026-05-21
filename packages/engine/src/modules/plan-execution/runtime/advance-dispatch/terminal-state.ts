import type { EffectivePlanGraph } from "@chrona/contracts/ai";
import { executionStatusFromEffectiveGraph } from "../../execution-state-machine";

export function isTerminalStatus(effective: EffectivePlanGraph) {
  return executionStatusFromEffectiveGraph(effective) === "completed";
}
