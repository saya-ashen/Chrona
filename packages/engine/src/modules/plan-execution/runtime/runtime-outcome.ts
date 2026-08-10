import type { GraphDispatchOutcome } from "@chrona/graph-runtime";
import type { WaitKind } from "@chrona/contracts/ai";


export function waitKindFromOutcome(outcome: GraphDispatchOutcome): WaitKind {
  if (outcome.waitKind) return outcome.waitKind;
  if (outcome.status === "waiting_for_user") return "user_input";
  if (outcome.status === "waiting_for_approval") return "approval";
  if (outcome.status === "failed") return "manual_action";
  return "manual_action";
}
