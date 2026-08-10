import type { AiContractRef } from "@chrona/contracts/ai-feature-runtime";

/** Formats a versioned contract reference without making callers parse IDs. */
export function formatAiContractRef(reference: AiContractRef): string {
  return `${reference.id}.v${reference.version}`;
}

/** Compares contract references by both their stable ID and semantic version. */
export function sameAiContractRef(left: AiContractRef, right: AiContractRef): boolean {
  return left.id === right.id && left.version === right.version;
}
