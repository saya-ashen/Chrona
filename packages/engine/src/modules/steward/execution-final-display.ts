import type { ExecutorFinal } from "@chrona/contracts/steward";
import { executionDisplayText } from "./execution-event-projection";

/** Pure display normalization for both server ingress and the database-independent local executor. */
export function canonicalExecutionFinalDisplay(final: Pick<ExecutorFinal, "finalMessage" | "outcome">) {
  return { finalMessage: final.finalMessage ? { ...final.finalMessage, text: executionDisplayText(final.finalMessage.text) } : null,
    outcome: { ...final.outcome, error: final.outcome.error === null ? null : executionDisplayText(final.outcome.error, 1000) } };
}
