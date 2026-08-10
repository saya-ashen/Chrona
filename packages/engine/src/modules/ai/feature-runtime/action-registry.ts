import type { ActionBinding, AiContractRef } from "@chrona/contracts/ai-feature-runtime";
import type { AiFeatureActionDefinition } from "./define-feature";
import { sameAiContractRef } from "./identifiers";

/** Returns only terminal proposal bindings; invoke bindings are never terminal proposals. */
export function findProposedActionBinding(
  bindings: readonly ActionBinding[],
  action: AiContractRef,
): Extract<ActionBinding, { mode: "propose" }> | undefined {
  return bindings.find((binding): binding is Extract<ActionBinding, { mode: "propose" }> =>
    binding.mode === "propose" && sameAiContractRef(binding.action, action),
  );
}

/** Resolves a declared invoke action; proposal bindings cannot be invoked at runtime. */
export function findInvokeActionDefinition(
  actions: readonly AiFeatureActionDefinition[],
  action: AiContractRef,
): (AiFeatureActionDefinition & { binding: Extract<ActionBinding, { mode: "invoke" }> }) | undefined {
  return actions.find((candidate): candidate is AiFeatureActionDefinition & { binding: Extract<ActionBinding, { mode: "invoke" }> } =>
    candidate.binding.mode === "invoke" && sameAiContractRef(candidate.binding.action, action),
  );
}
