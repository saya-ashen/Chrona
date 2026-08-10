import type { CompletionValidation } from "@chrona/contracts/ai-feature-runtime";

/** Completion validators return data only; the runner owns all terminal writes. */
export function completionIsValid(validation: CompletionValidation): boolean {
  return validation.valid && validation.issues.length === 0;
}
