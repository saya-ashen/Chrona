import type { ExecutionFinal } from "@chrona/contracts/steward";
import { executionDisplayText } from "./execution-event-projection";

/** Normalize the display fields before a final result is digested. */
export function canonicalExecutionFinalDisplay(final: ExecutionFinal): ExecutionFinal {
  return { finalMessage: final.finalMessage ? { ...final.finalMessage, text: executionDisplayText(final.finalMessage.text) } : null,
    error: final.error === null ? null : executionDisplayText(final.error, 1000) };
}
